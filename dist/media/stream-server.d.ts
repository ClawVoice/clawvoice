import { VoiceBridgeService } from "../voice/bridge";
import { ClawVoiceConfig } from "../config";
export declare class MediaStreamServer {
    private readonly config;
    private readonly bridge;
    private server;
    private readonly connections;
    constructor(config: ClawVoiceConfig, bridge: VoiceBridgeService);
    start(port: number): Promise<number>;
    stop(): Promise<void>;
    getPort(): number | null;
    getConnectionCount(): number;
    private handleUpgrade;
    private handleWsData;
    private handleTextFrame;
    private handleBinaryFrame;
    private forwardToVoiceProvider;
    sendAudioToTwilio(callSid: string, audioPayload: Buffer): void;
    private extractCallSid;
    private sendWsFrame;
    private decodeWsFrames;
}
