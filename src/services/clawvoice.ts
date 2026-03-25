import { ClawVoiceConfig } from "../config";

import { InboundCallRecord } from "../inbound/types";
import { TelnyxTelephonyAdapter } from "../telephony/telnyx";
import { TelephonyProviderAdapter } from "../telephony/types";
import { TwilioTelephonyAdapter } from "../telephony/twilio";
import { DeepgramBridgeClient } from "../transport/deepgram-bridge";
import { ElevenLabsBridgeClient } from "../transport/elevenlabs-bridge";
import { TwilioMediaSessionHandler } from "../transport/media-session-handler";
import { MediaStreamServer } from "../transport/media-stream-server";
import { VoiceProviderClient } from "../transport/voice-provider-bridge";
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
  recordingUrl?: string;
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

export class ClawVoiceService {
  private running = false;
  private readonly activeCalls = new Map<string, CallRecord>();
  private readonly callIdByProviderCallId = new Map<string, string>();
  private readonly recentCalls: CallRecord[] = [];
  private readonly inboundRecords: InboundCallRecord[] = [];
  private readonly textMessages: TextMessageRecord[] = [];
  private readonly callTimers = new Map<string, NodeJS.Timeout>();
  private readonly telephonyAdapter: TelephonyProviderAdapter;
  private dailyCallCount = 0;
  private dailyResetDate = new Date().toISOString().slice(0, 10);
  public readonly bridge: VoiceBridgeService;
  public readonly postCall: PostCallService;
  private readonly voiceProviderClient: VoiceProviderClient | null;
  private readonly mediaSessionHandler: TwilioMediaSessionHandler | null;
  private mediaStreamServer: MediaStreamServer | null = null;
  private readonly workspacePath: string | undefined;

  public constructor(
    private readonly config: ClawVoiceConfig,
    fetchFn?: typeof globalThis.fetch,
    workspacePath?: string,
  ) {
    this.workspacePath = workspacePath;
    this.telephonyAdapter =
      config.telephonyProvider === "twilio"
        ? new TwilioTelephonyAdapter(config, fetchFn)
        : new TelnyxTelephonyAdapter(config, fetchFn);
    this.bridge = new VoiceBridgeService(config);
    this.postCall = new PostCallService(config);
    this.voiceProviderClient = this.createVoiceProviderClient(config);
    this.mediaSessionHandler = this.voiceProviderClient
      ? new TwilioMediaSessionHandler({
        bridge: this.bridge,
        voiceProviderClient: this.voiceProviderClient,
        resolveCallIdByProviderCallId: (providerCallId: string) =>
          this.findInternalCallIdByProviderCallId(providerCallId),
        workspacePath: this.workspacePath,
      })
      : null;
  }

  private createVoiceProviderClient(config: ClawVoiceConfig): VoiceProviderClient | null {
    if (config.voiceProvider === "elevenlabs-conversational") {
      if (!config.elevenlabsApiKey || !config.elevenlabsAgentId) return null;
      return new ElevenLabsBridgeClient({ apiKey: config.elevenlabsApiKey });
    }
    if (!config.deepgramApiKey) return null;
    return new DeepgramBridgeClient({ apiKey: config.deepgramApiKey });
  }

  private reaperTimer: NodeJS.Timeout | null = null;
  private static readonly REAPER_INTERVAL_MS = 30_000; // check every 30s
  private static readonly REAPER_GRACE_MS = 120_000;

  public async start(): Promise<void> {
    await this.startStandaloneTransport();
    try {
      this.startReaper();
      this.running = true;
    } catch (error) {
      await this.stopStandaloneTransport().catch(() => undefined);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    await this.stopStandaloneTransport();
    this.stopReaper();
    for (const timer of this.callTimers.values()) {
      clearTimeout(timer);
    }
    this.callTimers.clear();
    await this.bridge.stopAll();
    this.running = false;
  }

  private async startStandaloneTransport(): Promise<void> {
    if (this.config.telephonyProvider !== "twilio") {
      return;
    }
    if (!this.config.twilioStreamUrl) {
      throw new Error("twilioStreamUrl is required. Set CLAWVOICE_TWILIO_STREAM_URL to your public WSS endpoint.");
    }
    if (!this.mediaSessionHandler) {
      throw new Error("Voice provider credentials are required for Twilio media streaming.");
    }
    if (this.mediaStreamServer) {
      return;
    }

    const streamPath = this.config.mediaStreamPath;
    const streamHost = this.config.mediaStreamBind || "0.0.0.0";
    const streamPort =
      Number.isFinite(this.config.mediaStreamPort) && this.config.mediaStreamPort > 0
        ? this.config.mediaStreamPort
        : 3101;

    this.mediaStreamServer = new MediaStreamServer({
      host: streamHost,
      port: streamPort,
      path: streamPath,
      sessionHandler: this.mediaSessionHandler,
    });
    await this.mediaStreamServer.start();
  }

  private async stopStandaloneTransport(): Promise<void> {
    if (!this.mediaStreamServer) {
      return;
    }
    const server = this.mediaStreamServer;
    this.mediaStreamServer = null;
    await server.stop();
  }

  private startReaper(): void {
    if (this.reaperTimer) {
      return;
    }
    this.reaperTimer = setInterval(() => {
      this.reapStaleCalls();
    }, ClawVoiceService.REAPER_INTERVAL_MS);
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
      const staleAfter = Math.max(maxDurationMs, ClawVoiceService.REAPER_GRACE_MS);
      if (now - started > staleAfter + ClawVoiceService.REAPER_GRACE_MS) {
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

  private findInternalCallIdByProviderCallId(providerCallId: string): string | null {
    return this.callIdByProviderCallId.get(providerCallId) ?? null;
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

  private validateCallReadiness(): void {
    const errors: string[] = [];

    if (this.config.voiceProvider === "deepgram-agent" && !this.config.deepgramApiKey) {
      errors.push("Deepgram API key is not configured. Set DEEPGRAM_API_KEY or run 'clawvoice setup'.");
    }

    if (this.config.voiceProvider === "elevenlabs-conversational") {
      if (!this.config.elevenlabsApiKey) {
        errors.push("ElevenLabs API key is not configured. Set ELEVENLABS_API_KEY or run 'clawvoice setup'.");
      }
      if (!this.config.elevenlabsAgentId) {
        errors.push("ElevenLabs agent ID is not configured. Set ELEVENLABS_AGENT_ID or run 'clawvoice setup'.");
      }
    }

    if (this.config.telephonyProvider === "twilio") {
      if (!this.config.twilioStreamUrl?.trim()) {
        errors.push(
          "Twilio media stream URL is not configured. " +
          "Set CLAWVOICE_TWILIO_STREAM_URL to a public WSS endpoint " +
          "(e.g. wss://your-tunnel.ngrok-free.dev/media-stream). " +
          "You need a tunnel (ngrok, Cloudflare Tunnel) to expose your local media stream server. " +
          "Run 'clawvoice setup' for guided configuration."
        );
      }
    }

    if (errors.length > 0) {
      throw new Error(`Cannot initiate call — missing configuration:\n${errors.join("\n")}`);
    }
  }

  public async startCall(
    request: StartCallRequest,
  ): Promise<StartCallResponse> {
    this.checkDailyLimit();
    this.validateCallReadiness();
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
    this.callIdByProviderCallId.set(record.providerCallId, callId);
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
      voiceProviderAuth: this.config.voiceProvider === "elevenlabs-conversational"
        ? (this.config.elevenlabsApiKey ?? "")
        : (this.config.deepgramApiKey ?? ""),
      telephonyCodec: "mulaw",
      voiceProviderCodec: "mulaw",
      sampleRate: 8000,
      greeting,
      systemPrompt: this.config.voiceSystemPrompt
        ? (request.purpose ? `${this.config.voiceSystemPrompt}\n\nCall purpose: ${request.purpose}` : this.config.voiceSystemPrompt)
        : (request.purpose ?? ""),
      voiceModel: this.config.voiceProvider === "elevenlabs-conversational"
        ? (this.config.elevenlabsVoiceId ?? "")
        : this.config.deepgramVoice,
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
    const providerCallId = call?.providerCallId;
    if (call) {
      call.status = "completed";
      call.endedAt = new Date().toISOString();
    }
    this.activeCalls.delete(callId);
    if (providerCallId) {
      this.callIdByProviderCallId.delete(providerCallId);
    }
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

  public setRecordingUrl(providerCallId: string, recordingUrl: string): void {
    const callId = this.callIdByProviderCallId.get(providerCallId);
    if (!callId) {
      // Call may already be completed — check recent calls
      for (const call of this.recentCalls) {
        if (call.providerCallId === providerCallId) {
          call.recordingUrl = recordingUrl;
          return;
        }
      }
      return;
    }
    const call = this.activeCalls.get(callId);
    if (call) {
      call.recordingUrl = recordingUrl;
    }
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
    this.callIdByProviderCallId.delete(call.providerCallId);

    if (summary) {
      await this.postCall.processCompletedCall(summary, transcript, call.recordingUrl).catch(() => undefined);
    }

    const timer = this.callTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.callTimers.delete(callId);
    }
  }
}
