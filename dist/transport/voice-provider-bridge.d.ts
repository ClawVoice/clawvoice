import { BridgeSessionConfig } from "../voice/types";
export interface VoiceProviderSession {
    sendAudio(chunk: Buffer): void;
    sendControl?(message: Record<string, unknown>): void;
    close(): void;
}
export interface VoiceProviderConnectOptions {
    callId: string;
    sessionConfig: BridgeSessionConfig;
    buildSettings: (config: BridgeSessionConfig) => Record<string, unknown>;
    onMessage: (message: Record<string, unknown>) => void;
    onClose?: (code: number, reason: string) => void;
    onError?: (error: unknown) => void;
}
export interface VoiceProviderClient {
    connect(options: VoiceProviderConnectOptions): Promise<VoiceProviderSession>;
}
