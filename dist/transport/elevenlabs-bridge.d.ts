import type { VoiceProviderClient, VoiceProviderConnectOptions, VoiceProviderSession } from "./voice-provider-bridge";
type ElevenLabsSocket = {
    readyState: number;
    on(event: "open" | "message" | "error" | "close", handler: (...args: unknown[]) => void): void;
    send(data: string): void;
    close(): void;
};
interface ElevenLabsBridgeClientOptions {
    connectTimeoutMs?: number;
    webSocketFactory?: (url: string) => ElevenLabsSocket;
}
export declare class ElevenLabsBridgeClient implements VoiceProviderClient {
    private readonly connectTimeoutMs;
    private readonly webSocketFactory;
    constructor(options?: ElevenLabsBridgeClientOptions);
    connect(options: VoiceProviderConnectOptions): Promise<VoiceProviderSession>;
}
export {};
