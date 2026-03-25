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
    const notified = await this.deliverSummary(summary, transcript);

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
  ): Promise<boolean> {
    const text = this.formatSummaryText(summary, transcript);
    let delivered = false;

    // Deliver via system event (immediate in-conversation delivery)
    if (this.systemEventEmitter) {
      try {
        const systemText = this.formatSystemEventText(summary, transcript);
        this.systemEventEmitter(systemText, { source: "clawvoice" });
        delivered = true;
      } catch {
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
  private formatSystemEventText(
    summary: CallSummary,
    transcript: TranscriptEntry[],
  ): string {
    const lines: string[] = [];
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

    return lines.join("\n");
  }

  /**
   * Format a human-readable summary for notifications.
   */
  public formatSummaryText(
    summary: CallSummary,
    transcript: TranscriptEntry[],
  ): string {
    const lines: string[] = [];
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
