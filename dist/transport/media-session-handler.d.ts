import { DeepgramBridgeClient } from "./deepgram-bridge";
import { VoiceBridgeService, VoiceWebSocket } from "../voice/bridge";
export type TwilioWebSocket = VoiceWebSocket & {
    close(code?: number, reason?: string): void;
};
interface TwilioMediaSessionHandlerOptions {
    bridge: VoiceBridgeService;
    deepgramClient: DeepgramBridgeClient;
    resolveCallIdByProviderCallId: (providerCallId: string) => string | null;
}
export declare class TwilioMediaSessionHandler {
    private readonly options;
    private readonly sessionsBySocket;
    constructor(options: TwilioMediaSessionHandlerOptions);
    handleMessage(socket: TwilioWebSocket, payload: string): Promise<void>;
    handleClose(socket: TwilioWebSocket): void;
    private handleStart;
    private handleMedia;
}
export {};
