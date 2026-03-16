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

/**
 * Handles post-call transcript persistence and summary delivery.
 */
export class PostCallService {
  private memoryWriter: MemoryWriter | null = null;
  private notificationSender: NotificationSender | null = null;
  private static readonly MAX_PROCESSED = 1000;
  private readonly processedCalls = new Set<string>();

  public constructor(private readonly config: ClawVoiceConfig) {}

  public setMemoryWriter(writer: MemoryWriter): void {
    this.memoryWriter = writer;
  }

  public setNotificationSender(sender: NotificationSender): void {
    this.notificationSender = sender;
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
    if (!this.notificationSender) {
      return false;
    }

    const text = this.formatSummaryText(summary, transcript);

    const channels = this.getConfiguredChannels();
    if (channels.length === 0) {
      return false;
    }

    for (const channel of channels) {
      await this.notificationSender({
        channel,
        text,
        callId: summary.callId,
      });
    }

    return true;
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
