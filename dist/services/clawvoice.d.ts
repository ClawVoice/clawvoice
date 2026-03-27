import { ClawVoiceConfig } from "../config";
import { InboundCallRecord } from "../inbound/types";
import { VoiceBridgeService } from "../voice/bridge";
import { CallSummary } from "../voice/types";
import { PostCallService } from "./post-call";
export type SystemEventEmitter = (text: string, options?: {
    source?: string;
}) => void;
export interface CallRecord {
    callId: string;
    providerCallId: string;
    to: string;
    provider: "telnyx" | "twilio";
    purpose?: string;
    greeting: string;
    startedAt: string;
    endedAt?: string;
    status: "in-progress" | "completed";
    summary?: CallSummary;
    recordingUrl?: string;
}
export interface StartCallRequest {
    phoneNumber: string;
    purpose?: string;
    greeting?: string;
}
export interface StartCallResponse {
    callId: string;
    to: string;
    openingGreeting: string;
    message: string;
}
export interface HangupResponse {
    callId: string;
    message: string;
}
export interface SendTextRequest {
    phoneNumber: string;
    message: string;
}
export interface SendTextResponse {
    messageId: string;
    to: string;
    message: string;
}
export interface TextMessageRecord {
    id: string;
    direction: "outbound" | "inbound";
    provider: "telnyx" | "twilio";
    from: string;
    to: string;
    body: string;
    createdAt: string;
}
/** Pending call context stored in-memory instead of URL query params (C2). */
interface PendingCallContextEntry {
    purpose?: string;
    greeting?: string;
    callId?: string;
    createdAt: number;
}
export declare class ClawVoiceService {
    private readonly config;
    private running;
    private readonly activeCalls;
    private readonly callIdByProviderCallId;
    private readonly recentCalls;
    private readonly inboundRecords;
    private readonly textMessages;
    private readonly callTimers;
    private readonly telephonyAdapter;
    private dailyCallCount;
    private dailyResetDate;
    private systemEventEmitter;
    private readonly smsReplyTimestamps;
    /** In-memory map for passing call context via short reference IDs instead of URL query params. */
    readonly pendingCallContext: Map<string, PendingCallContextEntry>;
    private pendingContextCleanupTimer;
    /** Auth token for WebSocket connections, derived from Twilio auth token. */
    private readonly mediaStreamAuthToken;
    readonly bridge: VoiceBridgeService;
    readonly postCall: PostCallService;
    private readonly voiceProviderClient;
    private readonly mediaSessionHandler;
    private mediaStreamServer;
    private readonly workspacePath;
    getWorkspacePath(): string | undefined;
    constructor(config: ClawVoiceConfig, fetchFn?: typeof globalThis.fetch, workspacePath?: string);
    private createVoiceProviderClient;
    private reaperTimer;
    private static readonly REAPER_INTERVAL_MS;
    private static readonly REAPER_GRACE_MS;
    start(): Promise<void>;
    stop(): Promise<void>;
    private startStandaloneTransport;
    private stopStandaloneTransport;
    private startReaper;
    private stopReaper;
    private reapStaleCalls;
    isRunning(): boolean;
    getProviderSummary(): string;
    private createCallId;
    private findInternalCallIdByProviderCallId;
    private checkDailyLimit;
    private validateCallReadiness;
    startCall(request: StartCallRequest): Promise<StartCallResponse>;
    hangup(callId?: string): Promise<HangupResponse>;
    getActiveCalls(): CallRecord[];
    /**
     * Force-clear a stuck call record without contacting the provider.
     * Use when a call slot is held by a dead session (e.g. after 31920 or network drop).
     */
    forceClear(callId?: string): string[];
    private cleanupCall;
    private scheduleAutoHangup;
    private autoHangup;
    trackInboundCall(record: InboundCallRecord): void;
    getInboundRecords(): InboundCallRecord[];
    setRecordingUrl(providerCallId: string, recordingUrl: string): void;
    getCallSummary(callId: string): CallSummary | null;
    sendText(request: SendTextRequest): Promise<SendTextResponse>;
    trackInboundText(from: string, to: string, body: string, providerMessageId?: string): void;
    setSystemEventEmitter(emitter: SystemEventEmitter): void;
    /**
     * Handle an inbound SMS: record it, send auto-reply, and notify owner agent.
     */
    handleInboundSms(from: string, to: string, body: string, messageId?: string): Promise<void>;
    /**
     * Emit a system event when an inbound call arrives.
     */
    notifyInboundCall(record: InboundCallRecord): void;
    /**
     * Wait for a call to complete (status changes from in-progress to completed).
     * Resolves with the call summary, or null if the call wasn't found.
     * Times out after maxWaitMs (default: maxCallDuration + 30s buffer).
     */
    waitForCallCompletion(callId: string, maxWaitMs?: number): Promise<CallSummary | null>;
    getRecentTexts(): TextMessageRecord[];
    private completeCall;
}
export {};
