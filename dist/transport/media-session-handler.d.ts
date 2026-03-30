import { VoiceProviderClient } from "./voice-provider-bridge";
import { VoiceBridgeService, VoiceWebSocket } from "../voice/bridge";
export type TwilioWebSocket = VoiceWebSocket & {
    close(code?: number, reason?: string): void;
    /** Query params from the WebSocket upgrade request URL (set by media-stream-server). */
    _queryParams?: Record<string, string>;
};
/** Resolved call context from the pending call context store (C2). */
interface ResolvedCallContext {
    purpose?: string;
    greeting?: string;
    callId?: string;
}
interface TwilioMediaSessionHandlerOptions {
    bridge: VoiceBridgeService;
    voiceProviderClient: VoiceProviderClient;
    resolveCallIdByProviderCallId: (providerCallId: string) => string | null;
    workspacePath?: string;
    /** Default voice provider WebSocket URL for auto-created bridge sessions. */
    voiceProviderUrl?: string;
    /** Default voice provider auth for auto-created bridge sessions. */
    voiceProviderAuth?: string;
    /** Default voice model for auto-created bridge sessions. */
    voiceModel?: string;
    /** Default voice system prompt for auto-created bridge sessions. */
    voiceSystemPrompt?: string;
    authToken?: string;
    allowAutoAccept?: boolean;
    /** Resolver for pending call context by reference ID (C2). */
    resolveCallContext?: (refId: string) => ResolvedCallContext | null;
    /** Called when a media session closes (for post-call processing). */
    onCallCompleted?: (callId: string, summary: import("../voice/types").CallSummary | null, transcript: import("../voice/types").TranscriptEntry[], meta?: {
        callerPhone?: string;
        direction?: "inbound" | "outbound";
    }) => void;
}
export declare class TwilioMediaSessionHandler {
    private readonly options;
    private readonly sessionsBySocket;
    private readonly localCloses;
    private static readonly MAX_COMPLETED;
    private readonly completedCallIds;
    constructor(options: TwilioMediaSessionHandlerOptions);
    handleMessage(socket: TwilioWebSocket, payload: string): Promise<void>;
    handleClose(socket: TwilioWebSocket): void;
    private handleStart;
    private handleMedia;
}
export {};
