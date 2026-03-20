import { ClawVoiceConfig } from "../config";
export declare class WebSocketRelayService {
    private readonly config;
    private running;
    constructor(config: ClawVoiceConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    isRunning(): boolean;
}
