"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostCallService = void 0;
/**
 * Handles post-call transcript persistence and summary delivery.
 */
class PostCallService {
    constructor(config) {
        this.config = config;
        this.memoryWriter = null;
        this.notificationSender = null;
        this.systemEventEmitter = null;
        this.processedCalls = new Set();
    }
    setMemoryWriter(writer) {
        this.memoryWriter = writer;
    }
    setNotificationSender(sender) {
        this.notificationSender = sender;
    }
    setSystemEventEmitter(emitter) {
        this.systemEventEmitter = emitter;
    }
    /**
     * Process a completed call: persist transcript and deliver summary.
     * Idempotent — skips calls already processed.
     */
    async processCompletedCall(summary, transcript, recordingUrl, meta) {
        if (this.processedCalls.has(summary.callId)) {
            return { persisted: false, notified: false };
        }
        this.processedCalls.add(summary.callId);
        if (this.processedCalls.size > PostCallService.MAX_PROCESSED) {
            const oldest = this.processedCalls.values().next().value;
            if (oldest) {
                this.processedCalls.delete(oldest);
            }
        }
        const persisted = await this.persistCallRecord(summary, transcript);
        const notified = await this.deliverSummary(summary, transcript, recordingUrl, meta);
        return { persisted, notified };
    }
    async persistCallRecord(summary, transcript) {
        if (!this.memoryWriter) {
            return false;
        }
        const record = {
            callId: summary.callId,
            outcome: summary.outcome,
            durationMs: summary.durationMs,
            transcript,
            failures: summary.failures,
            pendingActions: summary.pendingActions,
            retryContext: summary.retryContext,
            completedAt: summary.completedAt,
            persistedAt: new Date().toISOString(),
        };
        await this.memoryWriter("voice-memory", `calls/${summary.callId}`, record);
        return true;
    }
    async deliverSummary(summary, transcript, recordingUrl, meta) {
        const extracted = this.extractCallerDetails(transcript);
        let delivered = false;
        // Deliver via system event (immediate in-conversation delivery) —
        // includes a follow-up prompt for the agent to review and act on
        if (this.systemEventEmitter) {
            try {
                const systemText = this.formatSystemEventText(summary, transcript, recordingUrl, meta, extracted);
                this.systemEventEmitter(systemText, { source: "clawvoice" });
                delivered = true;
            }
            catch {
                // System event delivery is best-effort
            }
        }
        // Deliver via notification channels (Telegram, Discord, Slack)
        if (this.notificationSender) {
            const text = this.formatNotificationText(summary, transcript, recordingUrl, meta, extracted);
            const transcriptFile = this.formatTranscriptFile(summary, transcript, meta, extracted);
            const channels = this.getConfiguredChannels();
            for (const channel of channels) {
                await this.notificationSender({
                    channel,
                    text,
                    callId: summary.callId,
                    file: transcriptFile,
                });
                delivered = true;
            }
        }
        return delivered;
    }
    /**
     * Extract caller details (name, company, phone, reason) from transcript.
     */
    extractCallerDetails(transcript) {
        const callerText = transcript
            .filter((e) => e.speaker === "user")
            .map((e) => e.text)
            .join(" ");
        const agentText = transcript
            .filter((e) => e.speaker === "agent")
            .map((e) => e.text)
            .join(" ");
        const allText = callerText + " " + agentText;
        // Extract caller's name from THEIR turns only (not agent turns, which contain
        // the agent's own name like "my name is Jessica").
        // Fallback: check agent turns for "your name is X" confirmations (agent repeating caller's name).
        const nameMatch = callerText.match(/(?:my name is|this is|I'm|I am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i) ??
            agentText.match(/(?:your name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        const callerName = nameMatch?.[1]?.trim();
        // Extract company
        const companyMatch = allText.match(/(?:company is|from|with|at)\s+([A-Z][A-Za-z\s]+?(?:Inc|LLC|Corp|Co|Ltd|Incorporated|Services)?)\b/i);
        const company = companyMatch?.[1]?.trim();
        // Extract callback number — look for digit sequences
        const phoneMatch = allText.match(/(?:call\s*(?:me\s*)?(?:back\s*)?(?:at|on)?|number\s*(?:is)?|reach\s*(?:me\s*)?(?:at)?)\s*[,:]?\s*([\d\s\-().]{7,})/i);
        const callbackNumber = phoneMatch?.[1]?.replace(/[\s\-().]/g, "").trim();
        // Extract reason — from agent's summary or caller's first substantive turn
        const reasonMatch = agentText.match(/(?:calling about|regarding|about)\s+(.{10,80}?)(?:\.|,|\?|$)/i) ??
            callerText.match(/(?:I(?:'m| am) calling|I need|I want|looking for|about)\s+(.{10,80}?)(?:\.|,|\?|$)/i);
        const reason = reasonMatch?.[1]?.trim();
        return { callerName, company, callbackNumber, reason };
    }
    /**
     * Format a rich Telegram/Discord/Slack notification.
     */
    formatNotificationText(summary, transcript, recordingUrl, meta, extracted) {
        const dir = meta?.direction === "inbound" ? "Inbound" : "Outbound";
        const duration = this.formatDuration(summary.durationMs);
        const time = new Date(summary.completedAt).toLocaleString("en-US", {
            timeZone: this.config.notificationTimezone,
            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        });
        const lines = [];
        lines.push(`<b>${dir} Call Summary</b>`);
        lines.push("");
        // M1: Mask phone numbers in notifications
        const maskPhone = (num) => num.length > 4 ? num.slice(0, -4).replace(/./g, "*") + num.slice(-4) : "****";
        // Caller identification — name if extracted, phone number always masked
        if (extracted?.callerName) {
            const nameLine = extracted.company
                ? `${extracted.callerName} (${extracted.company})`
                : extracted.callerName;
            lines.push(`<b>Caller:</b> ${nameLine}`);
        }
        if (meta?.callerPhone) {
            lines.push(`<b>Phone:</b> ${maskPhone(meta.callerPhone)}`);
        }
        else {
            lines.push(`<b>Phone:</b> Unknown`);
        }
        if (extracted?.callbackNumber && extracted.callbackNumber !== meta?.callerPhone?.replace(/\D/g, "")) {
            lines.push(`<b>Callback #:</b> ${maskPhone(extracted.callbackNumber)}`);
        }
        lines.push(`<b>Time:</b> ${time}`);
        lines.push(`<b>Duration:</b> ${duration} | ${transcript.length} turns`);
        // Agent details
        const voiceProvider = this.config.voiceProvider === "elevenlabs-conversational" ? "ElevenLabs" : "Deepgram";
        const agentName = transcript.find((e) => e.speaker === "agent")?.text.match(/(?:my name is|I'm|I am)\s+([A-Z][a-z]+)/i)?.[1] ?? "Voice Agent";
        lines.push(`<b>Agent:</b> ${agentName} (${voiceProvider})`);
        if (extracted?.reason) {
            lines.push(`<b>Reason:</b> ${extracted.reason}`);
        }
        // Brief conversation summary (last 3 agent turns)
        const agentTurns = transcript.filter((e) => e.speaker === "agent");
        const lastAgent = agentTurns.slice(-2);
        if (lastAgent.length > 0) {
            lines.push("");
            lines.push("<b>Key points:</b>");
            for (const turn of lastAgent) {
                const text = turn.text.length > 120 ? turn.text.slice(0, 117) + "..." : turn.text;
                lines.push(`- ${text}`);
            }
        }
        if (summary.failures.length > 0) {
            lines.push(`\n<b>Issues:</b> ${summary.failures.map((f) => f.description).join("; ")}`);
        }
        if (recordingUrl) {
            lines.push(`\n<a href="${recordingUrl}">Recording</a>`);
        }
        // Transcript file reference
        lines.push(`\n<i>Transcript: voice-memory/calls/${summary.callId}.json</i>`);
        return lines.join("\n");
    }
    /**
     * Format a detailed summary for system event delivery (shown in-conversation).
     * Includes a follow-up prompt for the agent to review and potentially act on.
     */
    formatSystemEventText(summary, transcript, recordingUrl, meta, extracted) {
        const lines = [];
        const dir = meta?.direction === "inbound" ? "Inbound" : "Outbound";
        // M1: Mask phone numbers in system event text
        const maskPhone = (num) => num.length > 4 ? num.slice(0, -4).replace(/./g, "*") + num.slice(-4) : "****";
        lines.push(`--- CALL COMPLETED (${dir}) ---`);
        if (meta?.callerPhone)
            lines.push(`Phone: ${maskPhone(meta.callerPhone)}`);
        if (extracted?.callerName)
            lines.push(`Caller: ${extracted.callerName}${extracted.company ? ` (${extracted.company})` : ""}`);
        if (extracted?.callbackNumber)
            lines.push(`Callback: ${maskPhone(extracted.callbackNumber)}`);
        if (extracted?.reason)
            lines.push(`Reason: ${extracted.reason}`);
        lines.push(`Duration: ${this.formatDuration(summary.durationMs)} | Turns: ${transcript.length}`);
        lines.push(`Outcome: ${summary.outcome}`);
        // M5: Limit system event transcript to last 5 turns instead of up to 20
        if (transcript.length > 0) {
            lines.push(`\nTranscript (last ${Math.min(transcript.length, 5)} of ${transcript.length} turns):`);
            for (const entry of transcript.slice(-5)) {
                const role = entry.speaker === "agent" ? "Agent" : "Caller";
                lines.push(`${role}: ${entry.text}`);
            }
        }
        if (recordingUrl) {
            lines.push(`\nRecording: ${recordingUrl}`);
        }
        // Follow-up prompt for the OpenClaw agent
        lines.push("\n--- ACTION REQUIRED ---");
        lines.push("Review the transcript above. If there is a follow-up needed (callback, scheduling, information to relay to the owner, etc.), take appropriate action or notify the owner with a clear summary and recommended next steps.");
        return lines.join("\n");
    }
    /**
     * Format a human-readable summary for notifications (legacy).
     */
    formatSummaryText(summary, transcript) {
        return this.formatNotificationText(summary, transcript);
    }
    /**
     * Format a readable transcript file for attachment to notifications.
     */
    formatTranscriptFile(summary, transcript, meta, extracted) {
        const dir = meta?.direction === "inbound" ? "Inbound" : "Outbound";
        const time = new Date(summary.completedAt).toLocaleString("en-US", {
            timeZone: this.config.notificationTimezone,
            weekday: "short", month: "short", day: "numeric", year: "numeric",
            hour: "numeric", minute: "2-digit",
        });
        const lines = [];
        lines.push(`CALL TRANSCRIPT — ${dir}`);
        lines.push("=".repeat(40));
        // M1: Mask phone numbers in transcript file
        const maskPhone = (num) => num.length > 4 ? num.slice(0, -4).replace(/./g, "*") + num.slice(-4) : "****";
        lines.push(`Date:     ${time}`);
        lines.push(`Duration: ${this.formatDuration(summary.durationMs)}`);
        lines.push(`Outcome:  ${summary.outcome}`);
        if (meta?.callerPhone)
            lines.push(`Phone:    ${maskPhone(meta.callerPhone)}`);
        if (extracted?.callerName) {
            lines.push(`Caller:   ${extracted.callerName}${extracted.company ? ` (${extracted.company})` : ""}`);
        }
        if (extracted?.callbackNumber)
            lines.push(`Callback: ${maskPhone(extracted.callbackNumber)}`);
        if (extracted?.reason)
            lines.push(`Reason:   ${extracted.reason}`);
        lines.push("=".repeat(40));
        lines.push("");
        for (const entry of transcript) {
            const role = entry.speaker === "agent" ? "Agent" : "Caller";
            const ts = new Date(entry.timestamp).toLocaleTimeString("en-US", {
                timeZone: this.config.notificationTimezone,
                hour: "numeric", minute: "2-digit", second: "2-digit",
            });
            lines.push(`[${ts}] ${role}:`);
            lines.push(`  ${entry.text}`);
            lines.push("");
        }
        if (summary.failures.length > 0) {
            lines.push("--- Issues ---");
            for (const f of summary.failures) {
                lines.push(`- ${f.type}: ${f.description}`);
            }
        }
        // Date-based filename for easy sorting
        const dateStr = new Date(summary.completedAt).toISOString().slice(0, 10);
        const shortId = summary.callId.slice(-8);
        const name = `call-${dateStr}-${shortId}.txt`;
        return { name, content: lines.join("\n"), mimeType: "text/plain" };
    }
    formatDuration(ms) {
        const totalSec = Math.round(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    }
    getConfiguredChannels() {
        const channels = [];
        if (this.config.notifyTelegram)
            channels.push("telegram");
        if (this.config.notifyDiscord)
            channels.push("discord");
        if (this.config.notifySlack)
            channels.push("slack");
        return channels;
    }
    isProcessed(callId) {
        return this.processedCalls.has(callId);
    }
    getProcessedCount() {
        return this.processedCalls.size;
    }
}
exports.PostCallService = PostCallService;
PostCallService.MAX_PROCESSED = 1000;
