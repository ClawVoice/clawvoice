import { ClawVoiceConfig } from "../config";
import { InboundCallRecord } from "../inbound/types";
import { TelnyxTelephonyAdapter } from "../telephony/telnyx";
import { TelephonyProviderAdapter } from "../telephony/types";
import { TwilioTelephonyAdapter } from "../telephony/twilio";
import { VoiceBridgeService } from "../voice/bridge";
import { CallSummary } from "../voice/types";
import { PostCallService } from "./post-call";

export interface CallRecord {
  callId: string;
  providerCallId: string;
  to: string;
  provider: "telnyx" | "twilio";
  purpose?: string;
  greeting: string;
  startedAt: string;
  endedAt?: string;
  status: "in-progress" | "completed";
  summary?: CallSummary;
}

export interface StartCallRequest {
  phoneNumber: string;
  purpose?: string;
  greeting?: string;
}

export interface StartCallResponse {
  callId: string;
  to: string;
  openingGreeting: string;
  message: string;
}

export interface HangupResponse {
  callId: string;
  message: string;
}

export class VoiceCallService {
  private running = false;
  private readonly activeCalls = new Map<string, CallRecord>();
  private readonly recentCalls: CallRecord[] = [];
  private readonly inboundRecords: InboundCallRecord[] = [];
  private readonly callTimers = new Map<string, NodeJS.Timeout>();
  private readonly telephonyAdapter: TelephonyProviderAdapter;
  public readonly bridge: VoiceBridgeService;
  public readonly postCall: PostCallService;

  public constructor(private readonly config: ClawVoiceConfig) {
    this.telephonyAdapter =
      config.telephonyProvider === "twilio"
        ? new TwilioTelephonyAdapter(config)
        : new TelnyxTelephonyAdapter(config);
    this.bridge = new VoiceBridgeService(config);
    this.postCall = new PostCallService(config);
  }

  public async start(): Promise<void> {
    this.running = true;
  }

  public async stop(): Promise<void> {
    for (const timer of this.callTimers.values()) {
      clearTimeout(timer);
    }
    this.callTimers.clear();
    await this.bridge.stopAll();
    this.running = false;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getProviderSummary(): string {
    return `${this.config.telephonyProvider}:${this.config.voiceProvider}`;
  }

  private createCallId(): string {
    const now = Date.now();
    const random = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0");
    return `call-${now}-${random}`;
  }

  public async startCall(
    request: StartCallRequest,
  ): Promise<StartCallResponse> {
    const baseGreeting =
      request.greeting?.trim() ||
      "Hello, this is an AI assistant calling on behalf of my user.";
    const disclosure = this.config.disclosureEnabled
      ? this.config.disclosureStatement.trim()
      : "";
    const greeting = disclosure.length > 0
      ? `${disclosure} ${baseGreeting}`
      : baseGreeting;

    const providerResult = await this.telephonyAdapter.startCall({
      to: request.phoneNumber,
      from:
        this.config.telephonyProvider === "twilio"
          ? this.config.twilioPhoneNumber
          : this.config.telnyxPhoneNumber,
      greeting,
      purpose: request.purpose,
    });

    const callId = this.createCallId();
    const record: CallRecord = {
      callId,
      providerCallId: providerResult.providerCallId,
      to: providerResult.normalizedTo,
      provider: this.config.telephonyProvider,
      purpose: request.purpose,
      greeting,
      startedAt: new Date().toISOString(),
      status: "in-progress",
    };

    this.activeCalls.set(callId, record);
    this.recentCalls.unshift(record);
    this.recentCalls.splice(20);
    this.scheduleAutoHangup(callId);

    const bridgeEvent = this.bridge.createSession({
      callId,
      providerCallId: providerResult.providerCallId,
      voiceProviderUrl: this.config.voiceProvider === "deepgram-agent"
        ? "wss://agent.deepgram.com/v1/agent/converse"
        : `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${this.config.elevenlabsAgentId ?? ""}`,
      voiceProviderAuth: this.config.deepgramApiKey ?? "",
      telephonyCodec: "mulaw",
      voiceProviderCodec: "mulaw",
      sampleRate: 8000,
      greeting,
      systemPrompt: request.purpose,
      voiceModel: this.config.deepgramVoice,
      keepAliveIntervalMs: 5000,
      greetingGracePeriodMs: 3000,
    });

    if (bridgeEvent.type === "connected") {
      this.bridge.startKeepAlive(callId, 5000);
      setTimeout(() => this.bridge.endGreetingGrace(callId), 3000);
    }

    return {
      callId,
      to: providerResult.normalizedTo,
      openingGreeting: greeting,
      message: `Outbound call initiated via ${this.config.telephonyProvider}.`,
    };
  }

  public async hangup(callId?: string): Promise<HangupResponse> {
    const selectedCallId = callId ?? this.activeCalls.keys().next().value;
    if (typeof selectedCallId !== "string") {
      throw new Error("No active call found to hang up.");
    }

    const call = this.activeCalls.get(selectedCallId);
    if (!call) {
      throw new Error(`Call not found: ${selectedCallId}`);
    }

    await this.completeCall(selectedCallId, call.providerCallId);

    return {
      callId: selectedCallId,
      message:
        "Call ended with a polite closing and clean connection termination.",
    };
  }

  public getActiveCalls(): CallRecord[] {
    return Array.from(this.activeCalls.values());
  }

  private scheduleAutoHangup(callId: string): void {
    const durationMs = Math.floor(this.config.maxCallDuration * 1000);
    const timer = setTimeout(() => {
      void this.autoHangup(callId);
    }, durationMs);
    timer.unref?.();
    this.callTimers.set(callId, timer);
  }

  private async autoHangup(callId: string): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) {
      return;
    }

    await this.completeCall(callId, call.providerCallId);
  }

  public trackInboundCall(record: InboundCallRecord): void {
    this.inboundRecords.unshift(record);
    this.inboundRecords.splice(50);
  }

  public getInboundRecords(): InboundCallRecord[] {
    return [...this.inboundRecords];
  }

  public getCallSummary(callId: string): CallSummary | null {
    const call = this.recentCalls.find((c) => c.callId === callId);
    return call?.summary ?? null;
  }

  private async completeCall(callId: string, providerCallId: string): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) {
      return;
    }

    const transcript = this.bridge.getTranscript(callId);
    const summary = this.bridge.generateCallSummary(callId);
    call.summary = summary ?? undefined;

    this.bridge.destroySession(callId);
    await this.telephonyAdapter.hangup(providerCallId);
    call.status = "completed";
    call.endedAt = new Date().toISOString();
    this.activeCalls.delete(callId);

    if (summary) {
      await this.postCall.processCompletedCall(summary, transcript).catch(() => undefined);
    }

    const timer = this.callTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.callTimers.delete(callId);
    }
  }
}
