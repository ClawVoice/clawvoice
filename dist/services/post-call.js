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
    async processCompletedCall(summary, transcript, recordingUrl) {
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
        const notified = await this.deliverSummary(summary, transcript, recordingUrl);
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
    async deliverSummary(summary, transcript, recordingUrl) {
        const text = this.formatSummaryText(summary, transcript);
        let delivered = false;
        // Deliver via system event (immediate in-conversation delivery)
        if (this.systemEventEmitter) {
            try {
                const systemText = this.formatSystemEventText(summary, transcript, recordingUrl);
                this.systemEventEmitter(systemText, { source: "clawvoice" });
                delivered = true;
            }
            catch {
                // System event delivery is best-effort
            }
        }
        // Deliver via notification channels (Telegram, Discord, Slack)
        if (this.notificationSender) {
            const channels = this.getConfiguredChannels();
            for (const channel of channels) {
                await this.notificationSender({
                    channel,
                    text,
                    callId: summary.callId,
                });
                delivered = true;
            }
        }
        return delivered;
    }
    /**
     * Format a detailed summary for system event delivery (shown in-conversation).
     */
    formatSystemEventText(summary, transcript, recordingUrl) {
        const lines = [];
        lines.push(`📞 Call Summary — ${summary.callId}`);
        lines.push(`Duration: ${Math.round(summary.durationMs / 1000)}s | Turns: ${transcript.length}`);
        lines.push(`Outcome: ${summary.outcome}`);
        if (transcript.length > 0) {
            lines.push("");
            lines.push("Transcript:");
            for (const entry of transcript.slice(0, 20)) {
                const role = entry.speaker === "agent" ? "Agent" : "Callee";
                lines.push(`> ${role}: ${entry.text}`);
            }
            if (transcript.length > 20) {
                lines.push(`> ... (${transcript.length - 20} more turns)`);
            }
        }
        if (summary.failures.length > 0) {
            lines.push("");
            lines.push(`Failures: ${summary.failures.map((f) => f.description).join("; ")}`);
        }
        if (summary.pendingActions.length > 0) {
            lines.push(`Pending: ${summary.pendingActions.join(", ")}`);
        }
        if (recordingUrl) {
            lines.push(`Recording: ${recordingUrl}`);
        }
        return lines.join("\n");
    }
    /**
     * Format a human-readable summary for notifications.
     */
    formatSummaryText(summary, transcript) {
        const lines = [];
        lines.push(`Call ${summary.callId} — ${summary.outcome}`);
        lines.push(`Duration: ${Math.round(summary.durationMs / 1000)}s`);
        lines.push(`Transcript: ${transcript.length} turns`);
        if (summary.failures.length > 0) {
            lines.push(`Failures: ${summary.failures.map((f) => f.description).join("; ")}`);
        }
        if (summary.pendingActions.length > 0) {
            lines.push(`Pending: ${summary.pendingActions.join(", ")}`);
        }
        if (summary.retryContext) {
            lines.push(`Retry: ${summary.retryContext.suggestedApproach}`);
        }
        return lines.join("\n");
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
