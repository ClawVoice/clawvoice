import { ClawVoiceConfig } from "../config";

export class WebSocketRelayService {
  private running = false;

  public constructor(private readonly config: ClawVoiceConfig) {}

  public async start(): Promise<void> {
    this.running = this.config.mode === "managed";
  }

  public async stop(): Promise<void> {
    this.running = false;
  }

  public isRunning(): boolean {
    return this.running;
  }
}
