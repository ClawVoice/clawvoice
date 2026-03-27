/**
 * Supported audio codecs for telephony ↔ voice provider bridging.
 */
export type AudioCodec = "mulaw" | "pcm16";
/**
 * Audio format negotiation result.
 */
export interface AudioFormat {
    codec: AudioCodec;
    sampleRate: number;
    channels: number;
}
/**
 * Configuration for a voice bridge session.
 */
export interface BridgeSessionConfig {
    callId: string;
    providerCallId: string;
    voiceProviderUrl: string;
    voiceProviderAuth: string;
    telephonyCodec: AudioCodec;
    voiceProviderCodec: AudioCodec;
    sampleRate: number;
    greeting: string;
    systemPrompt?: string;
    voiceModel: string;
    keepAliveIntervalMs: number;
    greetingGracePeriodMs: number;
}
/**
 * Events emitted by a VoiceBridge session.
 */
export type BridgeEventType = "connected" | "audio_from_agent" | "transcript" | "agent_speaking" | "user_speaking" | "function_call" | "error" | "disconnected";
export interface BridgeEvent {
    type: BridgeEventType;
    callId: string;
    timestamp: string;
    data?: Record<string, unknown>;
}
/**
 * Transcript entry for a voice bridge session.
 */
export interface TranscriptEntry {
    speaker: "user" | "agent";
    text: string;
    timestamp: string;
}
/**
 * Turn-taking state for a voice bridge session.
 */
export type TurnState = "idle" | "agent_speaking" | "user_speaking";
/**
 * Reasons a voice bridge session can disconnect.
 */
export type DisconnectionReason = "heartbeat_timeout" | "voice_provider_error" | "telephony_provider_error" | "agent_ended" | "user_hangup" | "max_duration" | "unknown";
/**
 * Disconnection event data logged when a call terminates unexpectedly.
 */
export interface DisconnectionRecord {
    callId: string;
    reason: DisconnectionReason;
    detail: string;
    detectedAt: string;
    callDurationMs: number;
    transcriptLength: number;
}
/**
 * Inbound function call request from the voice agent.
 */
export interface FunctionCallRequest {
    id: string;
    name: string;
    input: Record<string, unknown>;
}
/**
 * Outbound function call response back to the voice agent.
 */
export interface FunctionCallResponse {
    id: string;
    name: string;
    output: string;
}
/**
 * Result from processing a voice agent message through the bridge.
 */
export type VoiceAgentMessageResult = {
    action: "audio";
    data: Buffer;
} | {
    action: "function_call";
    request: FunctionCallRequest;
} | {
    action: "function_call_denied";
    request: FunctionCallRequest;
    reason: string;
} | {
    action: "barge_in";
    duringGrace: boolean;
} | {
    action: "transcript";
    entry: TranscriptEntry;
} | {
    action: "turn_change";
    state: TurnState;
} | {
    action: "settings_applied";
} | {
    action: "error";
    error: string;
} | {
    action: "disconnection";
    record: DisconnectionRecord;
} | {
    action: "none";
};
/**
 * Completion status of a call.
 */
export type CallOutcome = "completed" | "partial" | "failed";
/**
 * Specific failure that occurred during a call.
 */
export interface CallFailure {
    type: "tool_failure" | "missing_data" | "timeout" | "disconnection" | "agent_error";
    description: string;
    timestamp: string;
    functionCallId?: string;
}
/**
 * Post-call summary including outcome, failures, and retry context.
 */
export interface CallSummary {
    callId: string;
    outcome: CallOutcome;
    durationMs: number;
    transcriptLength: number;
    failures: CallFailure[];
    pendingActions: string[];
    retryContext: RetryContext | null;
    completedAt: string;
}
/**
 * Context for retrying a call that was incomplete or failed.
 */
export interface RetryContext {
    originalCallId: string;
    failureReasons: string[];
    uncompletedActions: string[];
    previousTranscriptSummary: string;
    suggestedApproach: string;
}
/**
 * Codec negotiation result — either success or actionable diagnostic.
 */
export type CodecNegotiationResult = {
    ok: true;
    telephonyCodec: AudioCodec;
    voiceProviderCodec: AudioCodec;
    sampleRate: number;
} | {
    ok: false;
    error: string;
    suggestion: string;
};
/**
 * Negotiate audio codec between telephony provider and voice provider.
 *
 * Telephony side (Twilio/Telnyx) sends mulaw 8kHz.
 * Deepgram Voice Agent accepts mulaw 8kHz for input and produces mulaw 8kHz output.
 * If codecs don't match, return actionable diagnostic.
 */
export declare function negotiateCodec(telephonyCodec: AudioCodec, voiceProviderCodec: AudioCodec, sampleRate: number): CodecNegotiationResult;
