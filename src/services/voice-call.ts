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

export interface SendTextRequest {
  phoneNumber: string;
  message: string;
}

export interface SendTextResponse {
  messageId: string;
  to: string;
  message: string;
}

export interface TextMessageRecord {
  id: string;
  direction: "outbound" | "inbound";
  provider: "telnyx" | "twilio";
  from: string;
  to: string;
  body: string;
  createdAt: string;
}

export class VoiceCallService {
  private running = false;
  private readonly activeCalls = new Map<string, CallRecord>();
  private readonly recentCalls: CallRecord[] = [];
  private readonly inboundRecords: InboundCallRecord[] = [];
  private readonly textMessages: TextMessageRecord[] = [];
  private readonly callTimers = new Map<string, NodeJS.Timeout>();
  private readonly telephonyAdapter: TelephonyProviderAdapter;
  private dailyCallCount = 0;
  private dailyResetDate = new Date().toISOString().slice(0, 10);
  public readonly bridge: VoiceBridgeService;
  public readonly postCall: PostCallService;

  public constructor(
    private readonly config: ClawVoiceConfig,
    fetchFn?: typeof globalThis.fetch,
  ) {
    this.telephonyAdapter =
      config.telephonyProvider === "twilio"
        ? new TwilioTelephonyAdapter(config, fetchFn)
        : new TelnyxTelephonyAdapter(config, fetchFn);
    this.bridge = new VoiceBridgeService(config);
    this.postCall = new PostCallService(config);
  }

  private reaperTimer: NodeJS.Timeout | null = null;
  private static readonly REAPER_INTERVAL_MS = 30_000; // check every 30s
  private static readonly STALE_THRESHOLD_MS = 120_000; // 2 min with no activity = stale

  public async start(): Promise<void> {
    this.running = true;
    this.startReaper();
  }

  public async stop(): Promise<void> {
    this.stopReaper();
    for (const timer of this.callTimers.values()) {
      clearTimeout(timer);
    }
    this.callTimers.clear();
    await this.bridge.stopAll();
    this.running = false;
  }

  private startReaper(): void {
    this.reaperTimer = setInterval(() => {
      this.reapStaleCalls();
    }, VoiceCallService.REAPER_INTERVAL_MS);
    this.reaperTimer.unref?.();
  }

  private stopReaper(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  private reapStaleCalls(): void {
    const now = Date.now();
    for (const [callId, record] of this.activeCalls) {
      const started = new Date(record.startedAt).getTime();
      const maxDurationMs = Math.floor(this.config.maxCallDuration * 1000);
      const staleAfter = Math.max(maxDurationMs, VoiceCallService.STALE_THRESHOLD_MS);
      if (now - started > staleAfter + VoiceCallService.STALE_THRESHOLD_MS) {
        this.cleanupCall(callId);
      }
    }
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

  private checkDailyLimit(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailyResetDate) {
      this.dailyCallCount = 0;
      this.dailyResetDate = today;
    }
    if (this.config.dailyCallLimit > 0 && this.dailyCallCount >= this.config.dailyCallLimit) {
      throw new Error(`Daily call limit reached (${this.config.dailyCallLimit}). Try again tomorrow.`);
    }
  }

  public async startCall(
    request: StartCallRequest,
  ): Promise<StartCallResponse> {
    this.checkDailyLimit();
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
    this.dailyCallCount++;
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
      systemPrompt: this.config.voiceSystemPrompt
        ? (request.purpose ? `${this.config.voiceSystemPrompt}\n\nCall purpose: ${request.purpose}` : this.config.voiceSystemPrompt)
        : (request.purpose ?? ""),
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

  /**
   * Force-clear a stuck call record without contacting the provider.
   * Use when a call slot is held by a dead session (e.g. after 31920 or network drop).
   */
  public forceClear(callId?: string): string[] {
    const cleared: string[] = [];
    if (callId) {
      const call = this.activeCalls.get(callId);
      if (call) {
        this.cleanupCall(callId);
        cleared.push(callId);
      }
    } else {
      for (const id of this.activeCalls.keys()) {
        this.cleanupCall(id);
        cleared.push(id);
      }
    }
    return cleared;
  }

  private cleanupCall(callId: string): void {
    const call = this.activeCalls.get(callId);
    if (call) {
      call.status = "completed";
      call.endedAt = new Date().toISOString();
    }
    this.activeCalls.delete(callId);
    this.bridge.destroySession(callId);
    const timer = this.callTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.callTimers.delete(callId);
    }
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

  public async sendText(request: SendTextRequest): Promise<SendTextResponse> {
    const body = request.message.trim();
    if (body.length === 0) {
      throw new Error("Text message body must not be empty.");
    }
    if (body.length > 1600) {
      throw new Error(
        `Text message too long (${body.length} chars). Maximum is 1600 characters.`,
      );
    }

    const result = await this.telephonyAdapter.sendSms({
      to: request.phoneNumber,
      from:
        this.config.telephonyProvider === "twilio"
          ? this.config.twilioPhoneNumber
          : this.config.telnyxPhoneNumber,
      body,
    });

    this.textMessages.unshift({
      id: result.providerMessageId,
      direction: "outbound",
      provider: this.config.telephonyProvider,
      from:
        this.config.telephonyProvider === "twilio"
          ? (this.config.twilioPhoneNumber ?? "")
          : (this.config.telnyxPhoneNumber ?? ""),
      to: result.normalizedTo,
      body,
      createdAt: new Date().toISOString(),
    });
    this.textMessages.splice(100);

    return {
      messageId: result.providerMessageId,
      to: result.normalizedTo,
      message: `Outbound text sent via ${this.config.telephonyProvider}.`,
    };
  }

  public trackInboundText(from: string, to: string, body: string, providerMessageId?: string): void {
    this.textMessages.unshift({
      id: providerMessageId ?? `sms-${Date.now()}`,
      direction: "inbound",
      provider: this.config.telephonyProvider,
      from,
      to,
      body,
      createdAt: new Date().toISOString(),
    });
    this.textMessages.splice(100);
  }

  public getRecentTexts(): TextMessageRecord[] {
    return [...this.textMessages];
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
