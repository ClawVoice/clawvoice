import { AudioCodec, BridgeEvent, BridgeSessionConfig, CallFailure, CallSummary, CodecNegotiationResult, DisconnectionReason, DisconnectionRecord, FunctionCallRequest, FunctionCallResponse, TranscriptEntry, TurnState, VoiceAgentMessageResult } from "./types";
import { ClawVoiceConfig } from "../config";
export interface VoiceWebSocket {
    send(data: string | Buffer): void;
    close(): void;
    readyState: number;
}
export type DisconnectionHandler = (record: DisconnectionRecord) => void;
export declare class VoiceBridgeService {
    private readonly config;
    private readonly bridges;
    private readonly sessionConfigs;
    private disconnectionHandler;
    constructor(config: ClawVoiceConfig);
    onDisconnection(handler: DisconnectionHandler): void;
    negotiateAndValidate(telephonyCodec?: AudioCodec, voiceProviderCodec?: AudioCodec, sampleRate?: number): CodecNegotiationResult;
    createSession(sessionConfig: BridgeSessionConfig): BridgeEvent;
    buildSettingsMessage(sessionConfig: BridgeSessionConfig): Record<string, unknown>;
    setVoiceSocket(callId: string, socket: VoiceWebSocket): void;
    getSessionConfig(callId: string): BridgeSessionConfig | null;
    getVoiceSocket(callId: string): VoiceWebSocket | null;
    startKeepAlive(callId: string, intervalMs: number): void;
    recordActivity(callId: string): void;
    startHeartbeatMonitor(callId: string, timeoutMs?: number): void;
    stopHeartbeatMonitor(callId: string): void;
    reportDisconnection(callId: string, reason: DisconnectionReason, detail: string): DisconnectionRecord | null;
    getDisconnectionRecord(callId: string): DisconnectionRecord | null;
    endGreetingGrace(callId: string): void;
    isGreetingGraceActive(callId: string): boolean;
    bufferTelephonyAudio(callId: string, chunk: Buffer): Buffer | null;
    flushAudioBuffer(callId: string): Buffer | null;
    addTranscriptEntry(callId: string, entry: TranscriptEntry): void;
    getTranscript(callId: string): TranscriptEntry[];
    destroySession(callId: string): BridgeEvent;
    handleVoiceAgentMessage(callId: string, message: Record<string, unknown>): VoiceAgentMessageResult;
    handleBargeIn(callId: string): VoiceAgentMessageResult;
    completeFunctionCall(callId: string, response: FunctionCallResponse): boolean;
    getTurnState(callId: string): TurnState;
    setTurnState(callId: string, state: TurnState): void;
    getPendingFunctionCalls(callId: string): FunctionCallRequest[];
    recordFailure(callId: string, failure: CallFailure): void;
    getFailures(callId: string): CallFailure[];
    generateCallSummary(callId: string): CallSummary | null;
    private determineOutcome;
    private buildRetryContext;
    getActiveBridgeCount(): number;
    hasActiveBridge(callId: string): boolean;
    stopAll(): Promise<void>;
}
