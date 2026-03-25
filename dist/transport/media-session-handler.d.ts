import { VoiceProviderClient } from "./voice-provider-bridge";
import { VoiceBridgeService, VoiceWebSocket } from "../voice/bridge";
export type TwilioWebSocket = VoiceWebSocket & {
    close(code?: number, reason?: string): void;
};
interface TwilioMediaSessionHandlerOptions {
    bridge: VoiceBridgeService;
    voiceProviderClient: VoiceProviderClient;
    resolveCallIdByProviderCallId: (providerCallId: string) => string | null;
    workspacePath?: string;
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
