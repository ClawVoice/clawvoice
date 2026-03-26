import { ClawVoiceConfig } from "../config";
import { CallSummary, TranscriptEntry } from "../voice/types";

/**
 * Structured call record persisted to voice-memory/calls/.
 */
export interface PersistedCallRecord {
  callId: string;
  outcome: string;
  durationMs: number;
  transcript: TranscriptEntry[];
  failures: CallSummary["failures"];
  pendingActions: string[];
  retryContext: CallSummary["retryContext"];
  completedAt: string;
  persistedAt: string;
}

/**
 * Notification payload sent to integrations after a call.
 */
export interface CallNotification {
  channel: "telegram" | "discord" | "slack";
  text: string;
  callId: string;
  /** Optional file attachment (e.g., transcript). */
  file?: {
    name: string;
    content: string;
    mimeType: string;
  };
}

export type MemoryWriter = (
  namespace: string,
  key: string,
  value: unknown,
) => Promise<void>;

export type NotificationSender = (
  notification: CallNotification,
) => Promise<void>;

export type SystemEventEmitter = (
  text: string,
  options?: { source?: string },
) => void;

/**
 * Handles post-call transcript persistence and summary delivery.
 */
export class PostCallService {
  private memoryWriter: MemoryWriter | null = null;
  private notificationSender: NotificationSender | null = null;
  private systemEventEmitter: SystemEventEmitter | null = null;
  private static readonly MAX_PROCESSED = 1000;
  private readonly processedCalls = new Set<string>();

  public constructor(private readonly config: ClawVoiceConfig) {}

  public setMemoryWriter(writer: MemoryWriter): void {
    this.memoryWriter = writer;
  }

  public setNotificationSender(sender: NotificationSender): void {
    this.notificationSender = sender;
  }

  public setSystemEventEmitter(emitter: SystemEventEmitter): void {
    this.systemEventEmitter = emitter;
  }

  /**
   * Process a completed call: persist transcript and deliver summary.
   * Idempotent — skips calls already processed.
   */
  public async processCompletedCall(
    summary: CallSummary,
    transcript: TranscriptEntry[],
    recordingUrl?: string,
    meta?: { callerPhone?: string; direction?: "inbound" | "outbound" },
  ): Promise<{ persisted: boolean; notified: boolean }> {
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

  private async persistCallRecord(
    summary: CallSummary,
    transcript: TranscriptEntry[],
  ): Promise<boolean> {
    if (!this.memoryWriter) {
      return false;
    }

    const record: PersistedCallRecord = {
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

    await this.memoryWriter(
      "voice-memory",
      `calls/${summary.callId}`,
      record,
    );

    return true;
  }

  private async deliverSummary(
    summary: CallSummary,
    transcript: TranscriptEntry[],
    recordingUrl?: string,
    meta?: { callerPhone?: string; direction?: "inbound" | "outbound" },
  ): Promise<boolean> {
    const extracted = this.extractCallerDetails(transcript);
    let delivered = false;

    // Deliver via system event (immediate in-conversation delivery) —
    // includes a follow-up prompt for the agent to review and act on
    if (this.systemEventEmitter) {
      try {
        const systemText = this.formatSystemEventText(summary, transcript, recordingUrl, meta, extracted);
        this.systemEventEmitter(systemText, { source: "clawvoice" });
        delivered = true;
      } catch {
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
  private extractCallerDetails(transcript: TranscriptEntry[]): {
    callerName?: string;
    company?: string;
    callbackNumber?: string;
    reason?: string;
  } {
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
    const nameMatch =
      callerText.match(/(?:my name is|this is|I'm|I am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i) ??
      agentText.match(/(?:your name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    const callerName = nameMatch?.[1]?.trim();

    // Extract company
    const companyMatch =
      allText.match(/(?:company is|from|with|at)\s+([A-Z][A-Za-z\s]+?(?:Inc|LLC|Corp|Co|Ltd|Incorporated|Services)?)\b/i);
    const company = companyMatch?.[1]?.trim();

    // Extract callback number — look for digit sequences
    const phoneMatch = allText.match(/(?:call\s*(?:me\s*)?(?:back\s*)?(?:at|on)?|number\s*(?:is)?|reach\s*(?:me\s*)?(?:at)?)\s*[,:]?\s*([\d\s\-().]{7,})/i);
    const callbackNumber = phoneMatch?.[1]?.replace(/[\s\-().]/g, "").trim();

    // Extract reason — from agent's summary or caller's first substantive turn
    const reasonMatch =
      agentText.match(/(?:calling about|regarding|about)\s+(.{10,80}?)(?:\.|,|\?|$)/i) ??
      callerText.match(/(?:I(?:'m| am) calling|I need|I want|looking for|about)\s+(.{10,80}?)(?:\.|,|\?|$)/i);
    const reason = reasonMatch?.[1]?.trim();

    return { callerName, company, callbackNumber, reason };
  }

  /**
   * Format a rich Telegram/Discord/Slack notification.
   */
  private formatNotificationText(
    summary: CallSummary,
    transcript: TranscriptEntry[],
    recordingUrl?: string,
    meta?: { callerPhone?: string; direction?: "inbound" | "outbound" },
    extracted?: { callerName?: string; company?: string; callbackNumber?: string; reason?: string },
  ): string {
    const dir = meta?.direction === "inbound" ? "Inbound" : "Outbound";
    const duration = this.formatDuration(summary.durationMs);
    const time = new Date(summary.completedAt).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });

    const lines: string[] = [];
    lines.push(`*${dir} Call Summary*`);
    lines.push("");

    // Caller identification — name if extracted, phone number always shown
    if (extracted?.callerName) {
      const nameLine = extracted.company
        ? `${extracted.callerName} (${extracted.company})`
        : extracted.callerName;
      lines.push(`*Caller:* ${nameLine}`);
    }
    if (meta?.callerPhone) {
      lines.push(`*Phone:* ${meta.callerPhone}`);
    } else {
      lines.push(`*Phone:* Unknown`);
    }
    if (extracted?.callbackNumber && extracted.callbackNumber !== meta?.callerPhone?.replace(/\D/g, "")) {
      lines.push(`*Callback #:* ${extracted.callbackNumber}`);
    }
    lines.push(`*Time:* ${time}`);
    lines.push(`*Duration:* ${duration} | ${transcript.length} turns`);

    // Agent details
    const voiceProvider = this.config.voiceProvider === "elevenlabs-conversational" ? "ElevenLabs" : "Deepgram";
    const agentName = transcript.find((e) => e.speaker === "agent")?.text.match(/(?:my name is|I'm|I am)\s+([A-Z][a-z]+)/i)?.[1] ?? "Voice Agent";
    lines.push(`*Agent:* ${agentName} (${voiceProvider})`);

    if (extracted?.reason) {
      lines.push(`*Reason:* ${extracted.reason}`);
    }

    // Brief conversation summary (last 3 agent turns)
    const agentTurns = transcript.filter((e) => e.speaker === "agent");
    const lastAgent = agentTurns.slice(-2);
    if (lastAgent.length > 0) {
      lines.push("");
      lines.push("*Key points:*");
      for (const turn of lastAgent) {
        const text = turn.text.length > 120 ? turn.text.slice(0, 117) + "..." : turn.text;
        lines.push(`- ${text}`);
      }
    }

    if (summary.failures.length > 0) {
      lines.push(`\n*Issues:* ${summary.failures.map((f) => f.description).join("; ")}`);
    }

    if (recordingUrl) {
      lines.push(`\n[Recording](${recordingUrl})`);
    }

    // Transcript file reference
    lines.push(`\n_Transcript: voice-memory/calls/${summary.callId}.json_`);

    return lines.join("\n");
  }

  /**
   * Format a detailed summary for system event delivery (shown in-conversation).
   * Includes a follow-up prompt for the agent to review and potentially act on.
   */
  private formatSystemEventText(
    summary: CallSummary,
    transcript: TranscriptEntry[],
    recordingUrl?: string,
    meta?: { callerPhone?: string; direction?: "inbound" | "outbound" },
    extracted?: { callerName?: string; company?: string; callbackNumber?: string; reason?: string },
  ): string {
    const lines: string[] = [];
    const dir = meta?.direction === "inbound" ? "Inbound" : "Outbound";
    lines.push(`--- CALL COMPLETED (${dir}) ---`);
    if (meta?.callerPhone) lines.push(`Phone: ${meta.callerPhone}`);
    if (extracted?.callerName) lines.push(`Caller: ${extracted.callerName}${extracted.company ? ` (${extracted.company})` : ""}`);
    if (extracted?.callbackNumber) lines.push(`Callback: ${extracted.callbackNumber}`);
    if (extracted?.reason) lines.push(`Reason: ${extracted.reason}`);
    lines.push(`Duration: ${this.formatDuration(summary.durationMs)} | Turns: ${transcript.length}`);
    lines.push(`Outcome: ${summary.outcome}`);

    if (transcript.length > 0) {
      lines.push("\nTranscript:");
      for (const entry of transcript.slice(0, 20)) {
        const role = entry.speaker === "agent" ? "Agent" : "Caller";
        lines.push(`${role}: ${entry.text}`);
      }
      if (transcript.length > 20) {
        lines.push(`... (${transcript.length - 20} more turns)`);
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
  public formatSummaryText(
    summary: CallSummary,
    transcript: TranscriptEntry[],
  ): string {
    return this.formatNotificationText(summary, transcript);
  }

  /**
   * Format a readable transcript file for attachment to notifications.
   */
  private formatTranscriptFile(
    summary: CallSummary,
    transcript: TranscriptEntry[],
    meta?: { callerPhone?: string; direction?: "inbound" | "outbound" },
    extracted?: { callerName?: string; company?: string; callbackNumber?: string; reason?: string },
  ): { name: string; content: string; mimeType: string } {
    const dir = meta?.direction === "inbound" ? "Inbound" : "Outbound";
    const time = new Date(summary.completedAt).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "short", month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });

    const lines: string[] = [];
    lines.push(`CALL TRANSCRIPT — ${dir}`);
    lines.push("=".repeat(40));
    lines.push(`Date:     ${time}`);
    lines.push(`Duration: ${this.formatDuration(summary.durationMs)}`);
    lines.push(`Outcome:  ${summary.outcome}`);
    if (meta?.callerPhone) lines.push(`Phone:    ${meta.callerPhone}`);
    if (extracted?.callerName) {
      lines.push(`Caller:   ${extracted.callerName}${extracted.company ? ` (${extracted.company})` : ""}`);
    }
    if (extracted?.callbackNumber) lines.push(`Callback: ${extracted.callbackNumber}`);
    if (extracted?.reason) lines.push(`Reason:   ${extracted.reason}`);
    lines.push("=".repeat(40));
    lines.push("");

    for (const entry of transcript) {
      const role = entry.speaker === "agent" ? "Agent" : "Caller";
      const ts = new Date(entry.timestamp).toLocaleTimeString("en-US", {
        timeZone: "America/Chicago",
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

  private formatDuration(ms: number): string {
    const totalSec = Math.round(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  }

  private getConfiguredChannels(): Array<"telegram" | "discord" | "slack"> {
    const channels: Array<"telegram" | "discord" | "slack"> = [];
    if (this.config.notifyTelegram) channels.push("telegram");
    if (this.config.notifyDiscord) channels.push("discord");
    if (this.config.notifySlack) channels.push("slack");
    return channels;
  }

  public isProcessed(callId: string): boolean {
    return this.processedCalls.has(callId);
  }

  public getProcessedCount(): number {
    return this.processedCalls.size;
  }
}
