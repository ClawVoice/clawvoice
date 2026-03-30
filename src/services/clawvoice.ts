import * as path from "path";
import { createHash, randomBytes } from "crypto";
import { ClawVoiceConfig } from "../config";

import { InboundCallRecord } from "../inbound/types";
import { registerStandaloneWebhookRoutes } from "../routes";
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
import { OUTBOUND_CALL_INSTRUCTIONS } from "./call-instructions";
import { PostCallService } from "./post-call";
import { readUserProfile } from "./user-profile";

export type SystemEventEmitter = (
  text: string,
  options?: { source?: string },
) => void;

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

/** Pending call context stored in-memory instead of URL query params (C2). */
interface PendingCallContextEntry {
  purpose?: string;
  greeting?: string;
  callId?: string;
  createdAt: number;
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
  private systemEventEmitter: SystemEventEmitter | null = null;
  private readonly smsReplyTimestamps = new Map<string, number>();
  /** In-memory map for passing call context via short reference IDs instead of URL query params. */
  public readonly pendingCallContext = new Map<string, PendingCallContextEntry>();
  private pendingContextCleanupTimer: NodeJS.Timeout | null = null;
  /** Auth token for WebSocket connections, derived from Twilio auth token. */
  private readonly mediaStreamAuthToken: string | undefined;
  public readonly bridge: VoiceBridgeService;
  public readonly postCall: PostCallService;
  private readonly voiceProviderClient: VoiceProviderClient | null;
  private readonly mediaSessionHandler: TwilioMediaSessionHandler | null;
  private mediaStreamServer: MediaStreamServer | null = null;
  private readonly workspacePath: string | undefined;

  public getWorkspacePath(): string | undefined {
    return this.workspacePath;
  }

  public constructor(
    private readonly config: ClawVoiceConfig,
    fetchFn?: typeof globalThis.fetch,
    workspacePath?: string,
  ) {
    this.workspacePath = workspacePath;
    // Generate a deterministic auth token from the Twilio auth token (C1)
    if (config.twilioAuthToken) {
      this.mediaStreamAuthToken = createHash("sha256")
        .update(`clawvoice-media-stream:${config.twilioAuthToken}`)
        .digest("hex")
        .slice(0, 32);
    }
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
        voiceProviderUrl: config.voiceProvider === "deepgram-agent"
          ? "wss://agent.deepgram.com/v1/agent/converse"
          : `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${config.elevenlabsAgentId ?? ""}`,
        voiceProviderAuth: config.voiceProvider === "elevenlabs-conversational"
          ? (config.elevenlabsApiKey ?? "")
          : (config.deepgramApiKey ?? ""),
        voiceModel: config.voiceProvider === "elevenlabs-conversational"
          ? (config.elevenlabsVoiceId ?? "")
          : config.deepgramVoice,
        voiceSystemPrompt: config.voiceSystemPrompt,
        allowAutoAccept: true,
        /** Resolver for pending call context references (C2). */
        resolveCallContext: (refId: string) => this.pendingCallContext.get(refId) ?? null,
        silenceTimeoutSeconds: config.silenceTimeoutSeconds,
        onCallCompleted: (callId, summary, transcript, meta) => {
          if (!summary) return;
          void this.postCall.processCompletedCall(summary, transcript, undefined, meta).catch(() => undefined);
        },
      })
      : null;
    // Start periodic cleanup of expired pending call context entries (5 min TTL)
    this.pendingContextCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.pendingCallContext) {
        if (now - entry.createdAt > 300_000) {
          this.pendingCallContext.delete(key);
        }
      }
    }, 60_000);
    this.pendingContextCleanupTimer.unref?.();
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
    try {
      await this.startStandaloneTransport();
    } catch (error) {
      // EADDRINUSE is expected in multi-instance environments — another instance
      // already owns the media stream port. Call placement still works via Twilio API;
      // only the media stream server is unavailable in this instance.
      const isPortConflict = error instanceof Error && (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (isPortConflict) {
        console.warn("[clawvoice] Media stream port already in use — media stream server not started. Call placement still works via Twilio API.");
      } else {
        throw error;
      }
    }
    this.startReaper();
    this.running = true;
  }

  public async stop(): Promise<void> {
    await this.stopStandaloneTransport();
    this.stopReaper();
    for (const timer of this.callTimers.values()) {
      clearTimeout(timer);
    }
    this.callTimers.clear();
    if (this.pendingContextCleanupTimer) {
      clearInterval(this.pendingContextCleanupTimer);
      this.pendingContextCleanupTimer = null;
    }
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
      authToken: this.mediaStreamAuthToken,
    });

    // Register webhook routes on the standalone server so they work
    // even when the OpenClaw gateway doesn't dispatch plugin routes.
    registerStandaloneWebhookRoutes(this.mediaStreamServer, this.config, {
      onInbound: (record) => this.notifyInboundCall(record),
      onInboundText: (from, to, body, messageId) => {
        void this.handleInboundSms(from, to, body, messageId).catch((e) => {
          console.error("[clawvoice] handleInboundSms error:", e instanceof Error ? e.message : String(e));
        });
      },
      onRecording: (providerCallId, recordingUrl) => {
        this.setRecordingUrl(providerCallId, recordingUrl);
      },
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

    // Store purpose/greeting in-memory and pass only a short reference ID (C2)
    const refId = randomBytes(16).toString("hex");
    this.pendingCallContext.set(refId, {
      purpose: request.purpose,
      greeting,
      createdAt: Date.now(),
    });

    const providerResult = await this.telephonyAdapter.startCall({
      to: request.phoneNumber,
      from:
        this.config.telephonyProvider === "twilio"
          ? this.config.twilioPhoneNumber
          : this.config.telnyxPhoneNumber,
      greeting,
      purpose: request.purpose,
      refId,
      mediaStreamAuthToken: this.mediaStreamAuthToken,
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
      systemPrompt: this.buildSystemPrompt(request.purpose),
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

  public setSystemEventEmitter(emitter: SystemEventEmitter): void {
    this.systemEventEmitter = emitter;
  }

  /**
   * Handle an inbound SMS: record it, send auto-reply, and notify owner agent.
   */
  public async handleInboundSms(from: string, to: string, body: string, messageId?: string): Promise<void> {
    // Record the inbound text
    this.trackInboundText(from, to, body, messageId);

    // Don't auto-reply to own number (prevent loops)
    const ownNumber = this.config.telephonyProvider === "twilio"
      ? this.config.twilioPhoneNumber
      : this.config.telnyxPhoneNumber;
    if (ownNumber && from === ownNumber) {
      return;
    }

    // Load user profile for the owner name
    let ownerName = "the owner";
    if (this.workspacePath) {
      try {
        const voiceMemoryDir = path.join(this.workspacePath, "voice-memory");
        const profile = readUserProfile(voiceMemoryDir);
        if (profile.ownerName) {
          ownerName = profile.ownerName;
        }
      } catch { /* best-effort */ }
    }

    // Send auto-reply with rate limiting (1 reply per number per 60 seconds)
    if (this.config.smsAutoReply) {
      const now = Date.now();
      const lastReply = this.smsReplyTimestamps.get(from) ?? 0;
      if (now - lastReply >= 60_000) {
        try {
          const replyBody = `Hi, this is ${ownerName}'s assistant. I've received your message and will relay it.`;
          await this.telephonyAdapter.sendSms({
            to: from,
            from: ownNumber || "",
            body: replyBody,
          });
          this.smsReplyTimestamps.set(from, now);

          // Clean up old timestamps (keep map bounded)
          if (this.smsReplyTimestamps.size > 500) {
            const cutoff = now - 120_000;
            for (const [key, ts] of this.smsReplyTimestamps) {
              if (ts < cutoff) this.smsReplyTimestamps.delete(key);
            }
          }
        } catch (e) {
          console.error("[clawvoice] SMS auto-reply failed:", e instanceof Error ? e.message : String(e));
        }
      }
    }

    // Notify owner agent via system event emitter
    if (this.systemEventEmitter) {
      const maskPhone = (num: string): string => num.length > 4 ? num.slice(0, -4).replace(/./g, "*") + num.slice(-4) : "****";
      const autoReplied = this.config.smsAutoReply ? " (auto-reply sent)" : "";
      this.systemEventEmitter(
        `Inbound SMS from ${maskPhone(from)}: "${body}"${autoReplied}`,
        { source: "clawvoice" },
      );
    }
  }

  /**
   * Emit a system event when an inbound call arrives.
   */
  public notifyInboundCall(record: InboundCallRecord): void {
    this.trackInboundCall(record);

    if (this.systemEventEmitter) {
      const maskPhone = (num: string): string => num.length > 4 ? num.slice(0, -4).replace(/./g, "*") + num.slice(-4) : "****";
      this.systemEventEmitter(
        `Incoming call from ${maskPhone(record.from)} to ${maskPhone(record.to)} (${record.provider}, action: ${record.decision.action})`,
        { source: "clawvoice" },
      );
    }
  }

  /**
   * Wait for a call to complete (status changes from in-progress to completed).
   * Resolves with the call summary, or null if the call wasn't found.
   * Times out after maxWaitMs (default: maxCallDuration + 30s buffer).
   */
  public waitForCallCompletion(callId: string, maxWaitMs?: number): Promise<CallSummary | null> {
    const timeout = maxWaitMs ?? (this.config.maxCallDuration * 1000 + 30_000);
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = (): void => {
        const call = this.activeCalls.get(callId);
        // Call no longer active — it completed
        if (!call) {
          const summary = this.getCallSummary(callId);
          resolve(summary);
          return;
        }
        if (Date.now() - startedAt > timeout) {
          resolve(null);
          return;
        }
        const timer = setTimeout(check, 2000);
        timer.unref?.();
      };
      // First check after 5s (calls need time to connect)
      const timer = setTimeout(check, 5000);
      timer.unref?.();
    });
  }

  public getRecentTexts(): TextMessageRecord[] {
    return [...this.textMessages];
  }

  private buildSystemPrompt(purpose?: string): string {
    const parts: string[] = [];
    if (this.config.voiceSystemPrompt) {
      parts.push(purpose
        ? `${this.config.voiceSystemPrompt}\n\nCall purpose: ${purpose}`
        : this.config.voiceSystemPrompt);
    } else if (purpose) {
      parts.push(purpose);
    }

    parts.push(OUTBOUND_CALL_INSTRUCTIONS);

    return parts.join("\n\n");
  }

  private async completeCall(callId: string, providerCallId: string): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) {
      return;
    }

    const transcript = this.bridge.getTranscript(callId);
    const summary = this.bridge.generateCallSummary(callId);
    call.summary = summary ?? undefined;

    // Hang up first, then destroy session — ensures telephony provider
    // receives the hangup before we tear down the local bridge session.
    await this.telephonyAdapter.hangup(providerCallId);
    this.bridge.destroySession(callId);
    call.status = "completed";
    call.endedAt = new Date().toISOString();
    this.activeCalls.delete(callId);
    this.callIdByProviderCallId.delete(call.providerCallId);

    if (summary) {
      await this.postCall.processCompletedCall(summary, transcript, call.recordingUrl, {
        callerPhone: call.to,
        direction: "outbound",
      }).catch(() => undefined);
    }

    const timer = this.callTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.callTimers.delete(callId);
    }
  }
}
