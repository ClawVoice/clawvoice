import {
  AudioCodec,
  BridgeEvent,
  BridgeSessionConfig,
  CallFailure,
  CallOutcome,
  CallSummary,
  CodecNegotiationResult,
  DisconnectionReason,
  DisconnectionRecord,
  FunctionCallRequest,
  FunctionCallResponse,
  RetryContext,
  TranscriptEntry,
  TurnState,
  VoiceAgentMessageResult,
  negotiateCodec,
} from "./types";
import { ClawVoiceConfig } from "../config";

const TWILIO_CHUNK_SIZE = 160;
const BUFFER_CHUNKS = 20;
const BUFFER_SIZE = TWILIO_CHUNK_SIZE * BUFFER_CHUNKS;
const HEARTBEAT_TIMEOUT_MS = 15000;

export interface VoiceWebSocket {
  send(data: string | Buffer): void;
  close(): void;
  readyState: number;
}

interface ActiveBridge {
  callId: string;
  providerCallId: string;
  codecResult: CodecNegotiationResult & { ok: true };
  transcript: TranscriptEntry[];
  keepAliveTimer: ReturnType<typeof setInterval> | null;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  lastActivityAt: number;
  greetingGraceActive: boolean;
  audioBuffer: Buffer;
  audioBufferOffset: number;
  connected: boolean;
  startedAt: string;
  turnState: TurnState;
  pendingFunctionCalls: Map<string, FunctionCallRequest>;
  disconnectionRecord: DisconnectionRecord | null;
  failures: CallFailure[];
  voiceSocket: VoiceWebSocket | null;
}

export type DisconnectionHandler = (record: DisconnectionRecord) => void;

export class VoiceBridgeService {
  private readonly bridges = new Map<string, ActiveBridge>();
  private readonly sessionConfigs = new Map<string, BridgeSessionConfig>();
  private disconnectionHandler: DisconnectionHandler | null = null;

  public constructor(private readonly config: ClawVoiceConfig) {}

  public onDisconnection(handler: DisconnectionHandler): void {
    this.disconnectionHandler = handler;
  }

  public negotiateAndValidate(
    telephonyCodec: AudioCodec = "mulaw",
    voiceProviderCodec: AudioCodec = "mulaw",
    sampleRate = 8000,
  ): CodecNegotiationResult {
    return negotiateCodec(telephonyCodec, voiceProviderCodec, sampleRate);
  }

  public createSession(sessionConfig: BridgeSessionConfig): BridgeEvent {
    const codecResult = this.negotiateAndValidate(
      sessionConfig.telephonyCodec,
      sessionConfig.voiceProviderCodec,
      sessionConfig.sampleRate,
    );

    if (!codecResult.ok) {
      return {
        type: "error",
        callId: sessionConfig.callId,
        timestamp: new Date().toISOString(),
        data: {
          error: codecResult.error,
          suggestion: codecResult.suggestion,
        },
      };
    }

    const bridge: ActiveBridge = {
      callId: sessionConfig.callId,
      providerCallId: sessionConfig.providerCallId,
      codecResult,
      transcript: [],
      keepAliveTimer: null,
      heartbeatTimer: null,
      lastActivityAt: Date.now(),
      greetingGraceActive: true,
      audioBuffer: Buffer.alloc(BUFFER_SIZE),
      audioBufferOffset: 0,
      connected: false,
      startedAt: new Date().toISOString(),
      turnState: "idle",
      pendingFunctionCalls: new Map(),
      disconnectionRecord: null,
      failures: [],
      voiceSocket: null,
    };

    this.bridges.set(sessionConfig.callId, bridge);
    this.sessionConfigs.set(sessionConfig.callId, sessionConfig);

    return {
      type: "connected",
      callId: sessionConfig.callId,
      timestamp: bridge.startedAt,
      data: {
        codec: codecResult.telephonyCodec,
        sampleRate: codecResult.sampleRate,
        voiceModel: sessionConfig.voiceModel,
      },
    };
  }

  public buildSettingsMessage(sessionConfig: BridgeSessionConfig): Record<string, unknown> {
    return {
      type: "Settings",
      audio: {
        input: {
          encoding: sessionConfig.telephonyCodec === "mulaw" ? "mulaw" : "linear16",
          sample_rate: sessionConfig.sampleRate,
        },
        output: {
          encoding: sessionConfig.voiceProviderCodec === "mulaw" ? "mulaw" : "linear16",
          sample_rate: sessionConfig.sampleRate,
          container: "none",
        },
      },
      agent: {
        listen: { model: "nova-3" },
        speak: { model: sessionConfig.voiceModel },
        think: {
          provider: { type: "open_ai" },
          model: this.config.analysisModel,
          instructions: sessionConfig.systemPrompt ?? "",
        },
        greeting: { text: sessionConfig.greeting },
      },
    };
  }

  public setVoiceSocket(callId: string, socket: VoiceWebSocket): void {
    const bridge = this.bridges.get(callId);
    if (bridge) {
      bridge.voiceSocket = socket;
    }
  }

  public getSessionConfig(callId: string): BridgeSessionConfig | null {
    return this.sessionConfigs.get(callId) ?? null;
  }

  public getVoiceSocket(callId: string): VoiceWebSocket | null {
    return this.bridges.get(callId)?.voiceSocket ?? null;
  }

  public startKeepAlive(callId: string, intervalMs: number): void {
    const bridge = this.bridges.get(callId);
    if (!bridge) {
      return;
    }
    bridge.connected = true;

    if (bridge.keepAliveTimer) {
      clearInterval(bridge.keepAliveTimer);
    }

    bridge.keepAliveTimer = setInterval(() => {
      if (bridge.voiceSocket && bridge.voiceSocket.readyState === 1) {
        bridge.voiceSocket.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, intervalMs);
    bridge.keepAliveTimer.unref?.();
  }

  public recordActivity(callId: string): void {
    const bridge = this.bridges.get(callId);
    if (bridge) {
      bridge.lastActivityAt = Date.now();
    }
  }

  public startHeartbeatMonitor(callId: string, timeoutMs: number = HEARTBEAT_TIMEOUT_MS): void {
    const bridge = this.bridges.get(callId);
    if (!bridge) {
      return;
    }

    this.stopHeartbeatMonitor(callId);
    bridge.lastActivityAt = Date.now();

    const check = (): void => {
      const b = this.bridges.get(callId);
      if (!b || !b.connected) {
        return;
      }

      const elapsed = Date.now() - b.lastActivityAt;
      if (elapsed >= timeoutMs) {
        this.reportDisconnection(callId, "heartbeat_timeout", `No activity for ${elapsed}ms (threshold: ${timeoutMs}ms)`);
        return;
      }

      b.heartbeatTimer = setTimeout(check, Math.max(timeoutMs - elapsed, 100));
      b.heartbeatTimer.unref?.();
    };

    bridge.heartbeatTimer = setTimeout(check, timeoutMs);
    bridge.heartbeatTimer.unref?.();
  }

  public stopHeartbeatMonitor(callId: string): void {
    const bridge = this.bridges.get(callId);
    if (bridge?.heartbeatTimer) {
      clearTimeout(bridge.heartbeatTimer);
      bridge.heartbeatTimer = null;
    }
  }

  public reportDisconnection(
    callId: string,
    reason: DisconnectionReason,
    detail: string,
  ): DisconnectionRecord | null {
    const bridge = this.bridges.get(callId);
    if (!bridge) {
      return null;
    }

    const startMs = new Date(bridge.startedAt).getTime();
    const record: DisconnectionRecord = {
      callId,
      reason,
      detail,
      detectedAt: new Date().toISOString(),
      callDurationMs: Date.now() - startMs,
      transcriptLength: bridge.transcript.length,
    };

    bridge.disconnectionRecord = record;
    bridge.connected = false;

    bridge.failures.push({
      type: "disconnection",
      description: `${reason}: ${detail}`,
      timestamp: new Date().toISOString(),
    });

    this.stopHeartbeatMonitor(callId);

    if (this.disconnectionHandler) {
      this.disconnectionHandler(record);
    }

    return record;
  }

  public getDisconnectionRecord(callId: string): DisconnectionRecord | null {
    return this.bridges.get(callId)?.disconnectionRecord ?? null;
  }

  public endGreetingGrace(callId: string): void {
    const bridge = this.bridges.get(callId);
    if (bridge) {
      bridge.greetingGraceActive = false;
    }
  }

  public isGreetingGraceActive(callId: string): boolean {
    return this.bridges.get(callId)?.greetingGraceActive ?? false;
  }

  public bufferTelephonyAudio(callId: string, chunk: Buffer): Buffer | null {
    const bridge = this.bridges.get(callId);
    if (!bridge) {
      return null;
    }

    bridge.lastActivityAt = Date.now();
    const remaining = BUFFER_SIZE - bridge.audioBufferOffset;
    const toCopy = Math.min(chunk.length, remaining);
    chunk.copy(bridge.audioBuffer, bridge.audioBufferOffset, 0, toCopy);
    bridge.audioBufferOffset += toCopy;

    if (bridge.audioBufferOffset >= BUFFER_SIZE) {
      const flushed = Buffer.from(bridge.audioBuffer.subarray(0, BUFFER_SIZE));
      bridge.audioBufferOffset = 0;
      return flushed;
    }

    return null;
  }

  public flushAudioBuffer(callId: string): Buffer | null {
    const bridge = this.bridges.get(callId);
    if (!bridge || bridge.audioBufferOffset === 0) {
      return null;
    }

    const flushed = Buffer.from(
      bridge.audioBuffer.subarray(0, bridge.audioBufferOffset),
    );
    bridge.audioBufferOffset = 0;
    return flushed;
  }

  public addTranscriptEntry(callId: string, entry: TranscriptEntry): void {
    const bridge = this.bridges.get(callId);
    if (bridge) {
      bridge.transcript.push(entry);
    }
  }

  public getTranscript(callId: string): TranscriptEntry[] {
    return this.bridges.get(callId)?.transcript ?? [];
  }

  public destroySession(callId: string): BridgeEvent {
    const bridge = this.bridges.get(callId);
    if (bridge?.keepAliveTimer) {
      clearInterval(bridge.keepAliveTimer);
    }
    if (bridge?.heartbeatTimer) {
      clearTimeout(bridge.heartbeatTimer);
    }
    if (bridge?.voiceSocket) {
      try { bridge.voiceSocket.close(); } catch { /* ignore */ }
    }
    this.bridges.delete(callId);
    this.sessionConfigs.delete(callId);

    return {
      type: "disconnected",
      callId,
      timestamp: new Date().toISOString(),
      data: {
        transcriptLength: bridge?.transcript.length ?? 0,
      },
    };
  }

  public handleVoiceAgentMessage(
    callId: string,
    message: Record<string, unknown>,
  ): VoiceAgentMessageResult {
    const bridge = this.bridges.get(callId);
    if (!bridge) {
      return { action: "none" };
    }

    bridge.lastActivityAt = Date.now();
    const msgType = message.type as string | undefined;

    switch (msgType) {
      case "SettingsApplied":
        bridge.connected = true;
        return { action: "settings_applied" };

      case "UserStartedSpeaking":
        return this.handleBargeIn(callId);

      case "AgentStartedSpeaking":
        bridge.turnState = "agent_speaking";
        return { action: "turn_change", state: "agent_speaking" };

      case "ConversationText": {
        const role = message.role as string;
        const content = message.content as string;
        if (role && content) {
          const speaker: "user" | "agent" = role === "user" ? "user" : "agent";
          const entry: TranscriptEntry = {
            speaker,
            text: content,
            timestamp: new Date().toISOString(),
          };
          bridge.transcript.push(entry);
          return { action: "transcript", entry };
        }
        return { action: "none" };
      }

      case "Audio": {
        const payload = message.data;
        if (Buffer.isBuffer(payload)) {
          return { action: "audio", data: payload };
        }
        if (typeof payload === "string") {
          return { action: "audio", data: Buffer.from(payload, "base64") };
        }
        return { action: "none" };
      }

      case "AgentAudio": {
        const payload = message.data;
        if (Buffer.isBuffer(payload)) {
          return { action: "audio", data: payload };
        }
        if (typeof payload === "string") {
          return { action: "audio", data: Buffer.from(payload, "base64") };
        }
        return { action: "none" };
      }

      case "FunctionCallRequest": {
        const fcReq: FunctionCallRequest = {
          id: message.function_call_id as string,
          name: message.function_name as string,
          input: (message.input as Record<string, unknown>) ?? {},
        };
        // L4: Check function name against denied tools list
        if (this.config.restrictTools && this.config.deniedTools.includes(fcReq.name)) {
          return {
            action: "function_call_denied",
            request: fcReq,
            reason: `Function "${fcReq.name}" is denied by restrictTools policy`,
          } as VoiceAgentMessageResult;
        }
        bridge.pendingFunctionCalls.set(fcReq.id, fcReq);
        return { action: "function_call", request: fcReq };
      }

      case "Error": {
        const errorMsg = (message.message as string) ?? "Unknown voice agent error";
        const record = this.reportDisconnection(callId, "voice_provider_error", errorMsg);
        if (record) {
          return { action: "disconnection", record };
        }
        return { action: "error", error: errorMsg };
      }

      default:
        return { action: "none" };
    }
  }

  public handleBargeIn(callId: string): VoiceAgentMessageResult {
    const bridge = this.bridges.get(callId);
    if (!bridge) {
      return { action: "none" };
    }

    const duringGrace = bridge.greetingGraceActive;
    bridge.turnState = "user_speaking";
    return { action: "barge_in", duringGrace };
  }

  public completeFunctionCall(
    callId: string,
    response: FunctionCallResponse,
  ): boolean {
    const bridge = this.bridges.get(callId);
    if (!bridge) {
      return false;
    }
    bridge.pendingFunctionCalls.delete(response.id);
    return true;
  }

  public getTurnState(callId: string): TurnState {
    return this.bridges.get(callId)?.turnState ?? "idle";
  }

  public setTurnState(callId: string, state: TurnState): void {
    const bridge = this.bridges.get(callId);
    if (bridge) {
      bridge.turnState = state;
    }
  }

  public getPendingFunctionCalls(callId: string): FunctionCallRequest[] {
    const bridge = this.bridges.get(callId);
    if (!bridge) {
      return [];
    }
    return Array.from(bridge.pendingFunctionCalls.values());
  }

  public recordFailure(callId: string, failure: CallFailure): void {
    const bridge = this.bridges.get(callId);
    if (bridge) {
      bridge.failures.push(failure);
    }
  }

  public getFailures(callId: string): CallFailure[] {
    return this.bridges.get(callId)?.failures ?? [];
  }

  public generateCallSummary(callId: string): CallSummary | null {
    const bridge = this.bridges.get(callId);
    if (!bridge) {
      return null;
    }

    const startMs = new Date(bridge.startedAt).getTime();
    const durationMs = Date.now() - startMs;

    const pendingActions = Array.from(bridge.pendingFunctionCalls.values()).map(
      (fc) => `${fc.name}(${JSON.stringify(fc.input)})`,
    );

    let outcome = this.determineOutcome(bridge);

    // Short/unanswered call detection: if duration < 5s and no transcript,
    // mark as "unanswered" instead of generic "failed"
    if (durationMs < 5000 && bridge.transcript.length === 0) {
      outcome = "unanswered";
    }

    const retryContext = outcome !== "completed"
      ? this.buildRetryContext(bridge, pendingActions)
      : null;

    return {
      callId,
      outcome,
      durationMs,
      transcriptLength: bridge.transcript.length,
      failures: [...bridge.failures],
      pendingActions,
      retryContext,
      completedAt: new Date().toISOString(),
    };
  }

  private determineOutcome(bridge: ActiveBridge): CallOutcome {
    if (bridge.failures.length === 0 && bridge.pendingFunctionCalls.size === 0) {
      return "completed";
    }

    const hasHardFailure = bridge.failures.some(
      (f) => f.type === "disconnection" || f.type === "timeout",
    );

    if (hasHardFailure || bridge.transcript.length === 0) {
      return "failed";
    }

    return "partial";
  }

  private buildRetryContext(
    bridge: ActiveBridge,
    pendingActions: string[],
  ): RetryContext {
    const failureReasons = bridge.failures.map((f) => f.description);

    if (bridge.disconnectionRecord) {
      failureReasons.push(`Disconnected: ${bridge.disconnectionRecord.reason} — ${bridge.disconnectionRecord.detail}`);
    }

    const lastEntries = bridge.transcript.slice(-3);
    const previousTranscriptSummary = lastEntries.length > 0
      ? lastEntries.map((e) => `${e.speaker}: ${e.text}`).join(" | ")
      : "No transcript recorded.";

    const suggestedApproach = pendingActions.length > 0
      ? `Retry with pending actions: ${pendingActions.join(", ")}`
      : failureReasons.length > 0
        ? `Address failures: ${failureReasons.join("; ")}`
        : "Retry call with same parameters.";

    return {
      originalCallId: bridge.callId,
      failureReasons,
      uncompletedActions: pendingActions,
      previousTranscriptSummary,
      suggestedApproach,
    };
  }

  public getActiveBridgeCount(): number {
    return this.bridges.size;
  }

  public hasActiveBridge(callId: string): boolean {
    return this.bridges.has(callId);
  }

  public async stopAll(): Promise<void> {
    for (const callId of Array.from(this.bridges.keys())) {
      this.destroySession(callId);
    }
  }
}
