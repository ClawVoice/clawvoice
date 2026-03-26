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
export type MemoryWriter = (namespace: string, key: string, value: unknown) => Promise<void>;
export type NotificationSender = (notification: CallNotification) => Promise<void>;
export type SystemEventEmitter = (text: string, options?: {
    source?: string;
}) => void;
/**
 * Handles post-call transcript persistence and summary delivery.
 */
export declare class PostCallService {
    private readonly config;
    private memoryWriter;
    private notificationSender;
    private systemEventEmitter;
    private static readonly MAX_PROCESSED;
    private readonly processedCalls;
    constructor(config: ClawVoiceConfig);
    setMemoryWriter(writer: MemoryWriter): void;
    setNotificationSender(sender: NotificationSender): void;
    setSystemEventEmitter(emitter: SystemEventEmitter): void;
    /**
     * Process a completed call: persist transcript and deliver summary.
     * Idempotent — skips calls already processed.
     */
    processCompletedCall(summary: CallSummary, transcript: TranscriptEntry[], recordingUrl?: string, meta?: {
        callerPhone?: string;
        direction?: "inbound" | "outbound";
    }): Promise<{
        persisted: boolean;
        notified: boolean;
    }>;
    private persistCallRecord;
    private deliverSummary;
    /**
     * Extract caller details (name, company, phone, reason) from transcript.
     */
    private extractCallerDetails;
    /**
     * Format a rich Telegram/Discord/Slack notification.
     */
    private formatNotificationText;
    /**
     * Format a detailed summary for system event delivery (shown in-conversation).
     * Includes a follow-up prompt for the agent to review and potentially act on.
     */
    private formatSystemEventText;
    /**
     * Format a human-readable summary for notifications (legacy).
     */
    formatSummaryText(summary: CallSummary, transcript: TranscriptEntry[]): string;
    /**
     * Format a readable transcript file for attachment to notifications.
     */
    private formatTranscriptFile;
    private formatDuration;
    private getConfiguredChannels;
    isProcessed(callId: string): boolean;
    getProcessedCount(): number;
}
