import type { VoiceProviderClient, VoiceProviderConnectOptions, VoiceProviderSession } from "./voice-provider-bridge";
type DeepgramSocket = {
    readyState: number;
    on(event: "open" | "message" | "error" | "close", handler: (...args: unknown[]) => void): void;
    send(data: string | Buffer): void;
    close(): void;
};
export interface DeepgramBridgeSession {
    sendAudio(chunk: Buffer): void;
    sendControl?(message: Record<string, unknown>): void;
    close(): void;
}
export interface DeepgramConnectOptions {
    callId: string;
    settings: Record<string, unknown>;
    onMessage: (message: Record<string, unknown>) => void;
    onClose?: (code: number, reason: string) => void;
    onError?: (error: unknown) => void;
}
interface DeepgramBridgeClientOptions {
    apiKey: string;
    url?: string;
    connectTimeoutMs?: number;
    webSocketFactory?: (url: string, protocols: string[]) => DeepgramSocket;
}
export declare class DeepgramBridgeClient implements VoiceProviderClient {
    private readonly apiKey;
    private readonly url;
    private readonly connectTimeoutMs;
    private readonly webSocketFactory;
    constructor(options: DeepgramBridgeClientOptions);
    connect(options: VoiceProviderConnectOptions): Promise<VoiceProviderSession>;
    connectDirect(options: DeepgramConnectOptions): Promise<DeepgramBridgeSession>;
}
export {};
