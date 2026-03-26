import { VoiceProviderClient } from "./voice-provider-bridge";
import { VoiceBridgeService, VoiceWebSocket } from "../voice/bridge";
export type TwilioWebSocket = VoiceWebSocket & {
    close(code?: number, reason?: string): void;
    /** Query params from the WebSocket upgrade request URL (set by media-stream-server). */
    _queryParams?: Record<string, string>;
};
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
    /** Called when a media session closes (for post-call processing). */
    onCallCompleted?: (callId: string, summary: import("../voice/types").CallSummary | null, transcript: import("../voice/types").TranscriptEntry[]) => void;
}
export declare class TwilioMediaSessionHandler {
    private readonly options;
    private readonly sessionsBySocket;
    private readonly localCloses;
    constructor(options: TwilioMediaSessionHandlerOptions);
    handleMessage(socket: TwilioWebSocket, payload: string): Promise<void>;
    handleClose(socket: TwilioWebSocket): void;
    private handleStart;
    private handleMedia;
}
export {};
