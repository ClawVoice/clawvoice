import { randomUUID } from "crypto";
import { VoiceProviderClient, VoiceProviderSession } from "./voice-provider-bridge";
import { VoiceBridgeService, VoiceWebSocket } from "../voice/bridge";
import { readUserProfile, buildCallPrompt } from "../services/user-profile";
import * as path from "path";

export type TwilioWebSocket = VoiceWebSocket & {
  close(code?: number, reason?: string): void;
  /** Query params from the WebSocket upgrade request URL (set by media-stream-server). */
  _queryParams?: Record<string, string>;
};

interface StreamSession {
  callId: string;
  streamSid: string;
  voiceSession: VoiceProviderSession;
}

interface TwilioMediaSessionHandlerOptions {
  bridge: VoiceBridgeService;
  voiceProviderClient: VoiceProviderClient;
  resolveCallIdByProviderCallId: (providerCallId: string) => string | null;
  workspacePath?: string;
  /** Default voice provider WebSocket URL for auto-created bridge sessions. */
  voiceProviderUrl?: string;
  /** Default voice provider auth for auto-created bridge sessions. */
  voiceProviderAuth?: string;
  /** Default voice model for auto-created bridge sessions. */
  voiceModel?: string;
  /** Default voice system prompt for auto-created bridge sessions. */
  voiceSystemPrompt?: string;
  /** Whether to auto-accept unknown callSids from cross-instance media streams. Defaults to true. */
  allowAutoAccept?: boolean;
  /** Called when a media session closes (for post-call processing). */
  onCallCompleted?: (callId: string, summary: import("../voice/types").CallSummary | null, transcript: import("../voice/types").TranscriptEntry[]) => void;
}

interface TwilioStartMessage {
  event: "start";
  streamSid?: string;
  start?: {
    callSid?: string;
    customParameters?: Record<string, string>;
  };
}

interface TwilioMediaMessage {
  event: "media";
  streamSid?: string;
  media?: { payload?: string };
}

interface TwilioStopMessage {
  event: "stop";
  streamSid?: string;
}

type TwilioMessage = TwilioStartMessage | TwilioMediaMessage | TwilioStopMessage | { event: string };

export class TwilioMediaSessionHandler {
  private readonly sessionsBySocket = new Map<TwilioWebSocket, StreamSession>();
  private readonly localCloses = new Set<TwilioWebSocket>();
  private readonly completedCallIds = new Set<string>();

  public constructor(private readonly options: TwilioMediaSessionHandlerOptions) {}

  public async handleMessage(socket: TwilioWebSocket, payload: string): Promise<void> {
    let message: TwilioMessage;
    try {
      message = JSON.parse(payload) as TwilioMessage;
    } catch {
      return;
    }

    if (message.event === "start") {
      await this.handleStart(socket, message as TwilioStartMessage);
      return;
    }

    if (message.event === "media") {
      this.handleMedia(socket, message as TwilioMediaMessage);
      return;
    }

    if (message.event === "stop") {
      this.handleClose(socket);
    }
  }

  public handleClose(socket: TwilioWebSocket): void {
    const session = this.sessionsBySocket.get(socket);
    if (!session) {
      return;
    }

    this.localCloses.add(socket);
    session.voiceSession.close();
    this.sessionsBySocket.delete(socket);

    // Trigger post-call processing only once per callId (idempotent)
    if (this.options.onCallCompleted && !this.completedCallIds.has(session.callId)) {
      this.completedCallIds.add(session.callId);
      const transcript = this.options.bridge.getTranscript(session.callId);
      const summary = this.options.bridge.generateCallSummary(session.callId);
      try {
        this.options.onCallCompleted(session.callId, summary, transcript);
      } catch { /* post-call is best-effort */ }
    }
  }

  private async handleStart(socket: TwilioWebSocket, message: TwilioStartMessage): Promise<void> {
    const existingSession = this.sessionsBySocket.get(socket);
    if (existingSession) {
      this.handleClose(socket);
    }

    const providerCallId = message.start?.callSid;

    if (!providerCallId) {
      socket.close(1008, "Missing callSid");
      return;
    }

    // Read purpose/greeting from Twilio start message customParameters
    // (set via <Parameter> elements in TwiML) or URL query params as fallback.
    const cp = message.start?.customParameters ?? {};
    const qp = socket._queryParams ?? {};
    const urlPurpose = cp.purpose || qp.purpose || "";
    const urlGreeting = cp.greeting || qp.greeting || "";

    // Auto-accept unknown callSids: the call may have been placed by one
    // plugin instance while the media stream arrives at another.
    let callId = this.options.resolveCallIdByProviderCallId(providerCallId);
    if (!callId) {
      const allowAutoAccept = this.options.allowAutoAccept ?? true;
      if (!allowAutoAccept || !this.options.voiceProviderUrl) {
        socket.close(1008, "Unknown callSid and auto-accept is disabled or misconfigured");
        return;
      }
      callId = `auto-${randomUUID()}`;
    }

    let sessionConfig = this.options.bridge.getSessionConfig(callId);
    if (!sessionConfig) {
      // Auto-create a bridge session with default config for auto-accepted calls.
      // Read voice provider URL/auth/model from handler options.
      const defaultGreeting = urlGreeting || "Hello, this is an AI assistant.";
      let systemPrompt = this.options.voiceSystemPrompt || "";
      if (urlPurpose) {
        systemPrompt = systemPrompt
          ? `${systemPrompt}\n\nCall purpose: ${urlPurpose}`
          : `Call purpose: ${urlPurpose}`;
      }

      // Enrich with user profile before creating session
      if (this.options.workspacePath) {
        const voiceMemoryDir = path.join(this.options.workspacePath, "voice-memory");
        const profile = readUserProfile(voiceMemoryDir);
        if (profile.ownerName || profile.contextBlock) {
          const profilePrompt = buildCallPrompt(profile, urlPurpose || undefined);
          systemPrompt = systemPrompt
            ? `${profilePrompt}\n\n${systemPrompt}`
            : profilePrompt;
        }
      }

      const autoConfig = {
        callId,
        providerCallId,
        voiceProviderUrl: this.options.voiceProviderUrl ?? "",
        voiceProviderAuth: this.options.voiceProviderAuth ?? "",
        telephonyCodec: "mulaw" as const,
        voiceProviderCodec: "mulaw" as const,
        sampleRate: 8000,
        greeting: defaultGreeting,
        systemPrompt,
        voiceModel: this.options.voiceModel ?? "",
        keepAliveIntervalMs: 5000,
        greetingGracePeriodMs: 3000,
      };
      this.options.bridge.createSession(autoConfig);
      this.options.bridge.startKeepAlive(callId, 5000);
      setTimeout(() => this.options.bridge.endGreetingGrace(callId), 3000).unref?.();
      sessionConfig = this.options.bridge.getSessionConfig(callId);
    }

    if (!sessionConfig) {
      socket.close(1011, "Missing bridge session");
      return;
    }

    // Clone sessionConfig.systemPrompt before enriching to avoid mutating the
    // shared config object (addresses review: systemPrompt mutation in-place).
    let enrichedSystemPrompt = sessionConfig.systemPrompt || "";

    // Enrich systemPrompt with user profile context if workspace is available
    // (for pre-existing sessions that weren't auto-created above)
    if (this.options.workspacePath && !callId.startsWith("auto-")) {
      const voiceMemoryDir = path.join(this.options.workspacePath, "voice-memory");
      const profile = readUserProfile(voiceMemoryDir);
      if (profile.ownerName || profile.contextBlock) {
        const profilePrompt = buildCallPrompt(profile);
        enrichedSystemPrompt = enrichedSystemPrompt
          ? `${profilePrompt}\n\n${enrichedSystemPrompt}`
          : profilePrompt;
      }
    }

    // Create a shallow clone with the enriched prompt so we don't mutate the original config
    const effectiveConfig = { ...sessionConfig, systemPrompt: enrichedSystemPrompt };

    let teardownTriggered = false;
    const teardownFromVoiceProvider = (detail: string): void => {
      if (teardownTriggered) {
        return;
      }
      teardownTriggered = true;
      this.options.bridge.reportDisconnection(callId, "voice_provider_error", detail);
      this.handleClose(socket);
      socket.close(1011, detail);
    };

    let voiceSession: VoiceProviderSession;
    try {
      voiceSession = await this.options.voiceProviderClient.connect({
        callId,
        sessionConfig: effectiveConfig,
        buildSettings: (cfg) => this.options.bridge.buildSettingsMessage(cfg),
        onMessage: (voiceMessage) => {
          const action = this.options.bridge.handleVoiceAgentMessage(callId, voiceMessage);
          if (action.action !== "audio") {
            return;
          }

          socket.send(
            JSON.stringify({
              event: "media",
              streamSid: message.streamSid ?? "",
              media: { payload: action.data.toString("base64") },
            }),
          );
        },
        onClose: (_code, reason) => {
          if (this.localCloses.delete(socket)) return;
          teardownFromVoiceProvider(reason || "Voice provider stream closed");
        },
        onError: () => {
          teardownFromVoiceProvider("Voice provider stream error");
        },
      });
    } catch {
      this.options.bridge.reportDisconnection(callId, "voice_provider_error", "Voice provider connect failed");
      socket.close(1011, "Voice provider connect failed");
      return;
    }

    if (socket.readyState !== 1) {
      voiceSession.close();
      this.options.bridge.reportDisconnection(
        callId,
        "telephony_provider_error",
        "Twilio media socket closed before voice provider session was attached",
      );
      return;
    }

    this.options.bridge.setVoiceSocket(callId, {
      send: (data) => {
        if (Buffer.isBuffer(data)) {
          voiceSession.sendAudio(data);
          return;
        }

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          if (parsed.type === "KeepAlive") {
            voiceSession.sendControl?.(parsed);
            return;
          }
        } catch {
          return;
        }
      },
      close: () => voiceSession.close(),
      readyState: 1,
    });

    this.sessionsBySocket.set(socket, {
      callId,
      streamSid: message.streamSid ?? "",
      voiceSession,
    });

    this.options.bridge.startHeartbeatMonitor(callId);
  }

  private handleMedia(socket: TwilioWebSocket, message: TwilioMediaMessage): void {
    const session = this.sessionsBySocket.get(socket);
    if (!session) {
      return;
    }

    if (!message.media?.payload) {
      return;
    }

    const chunk = Buffer.from(message.media.payload, "base64");
    session.voiceSession.sendAudio(chunk);
    this.options.bridge.recordActivity(session.callId);
  }
}
