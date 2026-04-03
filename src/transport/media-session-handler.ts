import { randomUUID } from "crypto";
import { OUTBOUND_CALL_INSTRUCTIONS } from "../services/call-instructions";
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
  callerPhone?: string;
  direction: "inbound" | "outbound";
  silenceTimer?: NodeJS.Timeout;
}

/** Resolved call context from the pending call context store (C2). */
interface ResolvedCallContext {
  purpose?: string;
  greeting?: string;
  callId?: string;
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
  /** Silence timeout in seconds — hangs up if no callee interaction. */
  silenceTimeoutSeconds?: number;
  authToken?: string;
  allowAutoAccept?: boolean;
  /** Resolver for pending call context by reference ID (C2). */
  resolveCallContext?: (refId: string) => ResolvedCallContext | null;
  /** Called when a media session closes (for post-call processing). */
  onCallCompleted?: (callId: string, summary: import("../voice/types").CallSummary | null, transcript: import("../voice/types").TranscriptEntry[], meta?: { callerPhone?: string; direction?: "inbound" | "outbound" }) => void;
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
  private static readonly MAX_COMPLETED = 1000;
  private readonly completedCallIds = new Set<string>();

  public constructor(private readonly options: TwilioMediaSessionHandlerOptions) {}

  /** Start (or restart) the silence timer for a session. */
  private startSilenceTimer(
    socket: TwilioWebSocket,
    session: StreamSession,
    teardownFn: (detail: string) => void,
    purpose?: string,
  ): void {
    const timeoutSec = this.options.silenceTimeoutSeconds ?? 30;
    if (timeoutSec <= 0) return;

    // Skip silence timeout only when the call PURPOSE specifically mentions
    // hold/wait phrases.
    const purposeLower = (purpose ?? "").toLowerCase();
    const holdPhrases = ["on hold", "hold music", "please hold", "stay on hold", "wait on the line", "remain on hold"];
    const shouldSkipTimeout = holdPhrases.some(phrase => purposeLower.includes(phrase));
    if (shouldSkipTimeout) return;

    this.clearSilenceTimer(session);
    session.silenceTimer = setTimeout(() => {
      teardownFn("No response from callee — silence timeout");
    }, timeoutSec * 1000);
    session.silenceTimer.unref?.();
  }

  /** Reset the silence timer (called when meaningful activity occurs). */
  private resetSilenceTimer(
    socket: TwilioWebSocket,
    session: StreamSession,
    teardownFn: (detail: string) => void,
    purpose?: string,
  ): void {
    this.startSilenceTimer(socket, session, teardownFn, purpose);
  }

  /** Clear the silence timer for a session. */
  private clearSilenceTimer(session: StreamSession): void {
    if (session.silenceTimer) {
      clearTimeout(session.silenceTimer);
      session.silenceTimer = undefined;
    }
  }

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

    this.clearSilenceTimer(session);
    this.localCloses.add(socket);
    session.voiceSession.close();
    this.sessionsBySocket.delete(socket);

    // Trigger post-call processing only once per callId (idempotent)
    if (this.options.onCallCompleted && !this.completedCallIds.has(session.callId)) {
      this.completedCallIds.add(session.callId);
      if (this.completedCallIds.size > TwilioMediaSessionHandler.MAX_COMPLETED) {
        const oldest = this.completedCallIds.values().next().value;
        if (oldest) {
          this.completedCallIds.delete(oldest);
        }
      }
      const transcript = this.options.bridge.getTranscript(session.callId);
      const summary = this.options.bridge.generateCallSummary(session.callId);
      try {
        this.options.onCallCompleted(session.callId, summary, transcript, {
          callerPhone: session.callerPhone,
          direction: session.direction,
        });
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

    // Resolve purpose/greeting from in-memory store via reference ID.
    // Twilio delivers ref and token as customParameters (from TwiML <Parameter> elements)
    // since <Stream> URLs strip query params.
    const cp = message.start?.customParameters ?? {};
    const qp = socket._queryParams ?? {};
    const expectedToken = this.options.authToken;
    const receivedToken = cp.clawvoice_token || cp.token || qp.token || "";
    if (expectedToken && receivedToken !== expectedToken) {
      socket.close(1008, "Invalid media-stream token");
      return;
    }
    const refId = cp.clawvoice_ref || cp.ref || qp.ref || "";
    const resolvedContext = refId && this.options.resolveCallContext
      ? this.options.resolveCallContext(refId)
      : null;
    const urlPurpose = resolvedContext?.purpose || cp.purpose || "";
    const urlGreeting = resolvedContext?.greeting || cp.greeting || "";
    // For outbound: "to" = the number being called. For inbound: "from" = the caller's number.
    const outboundTo = cp.to || qp.to || "";
    const inboundFrom = cp.from || qp.from || "";
    const callerPhone = inboundFrom || outboundTo;
    const isInbound = !!inboundFrom || (!urlPurpose && !outboundTo);

    // Auto-accept unknown callSids: the call may have been placed by one
    // plugin instance while the media stream arrives at another.
    let callId = this.options.resolveCallIdByProviderCallId(providerCallId);
    if (!callId) {
      const allowAutoAccept = this.options.allowAutoAccept ?? false;
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

      // Build system prompt from user profile + purpose (stated once, not duplicated).
      // buildCallPrompt already includes "Call purpose: ..." when purpose is provided.
      const parts: string[] = [];

      // For inbound calls (no purpose specified), prepend inbound-specific instructions
      if (!urlPurpose) {
        parts.push(
          "You are answering an inbound phone call. The caller dialed your number.\n" +
          "Greet them warmly, determine who they are and what they need, and handle\n" +
          "the conversation according to your context and instructions below."
        );
      }

      if (this.options.workspacePath) {
        const voiceMemoryDir = path.join(this.options.workspacePath, "voice-memory");
        const profile = readUserProfile(voiceMemoryDir);
        if (profile.ownerName || profile.contextBlock) {
          parts.push(buildCallPrompt(profile, urlPurpose || undefined));
        }
      }
      // Only add purpose separately if user profile didn't already include it
      if (urlPurpose && parts.length === 0) {
        parts.push(`Call purpose: ${urlPurpose}`);
      }
      if (this.options.voiceSystemPrompt) {
        parts.push(this.options.voiceSystemPrompt);
      }
      // Append voicemail and IVR handling instructions for outbound calls
      if (!isInbound) {
        parts.push(OUTBOUND_CALL_INSTRUCTIONS);
      }
      const systemPrompt = parts.join("\n\n");

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

    // Track whether the voice session has closed so readyState reflects reality.
    // Must be declared before connect() so the onClose callback can capture it.
    let sessionClosed = false;

    let voiceSession: VoiceProviderSession;
    try {
      voiceSession = await this.options.voiceProviderClient.connect({
        callId,
        sessionConfig: effectiveConfig,
        buildSettings: (cfg) => this.options.bridge.buildSettingsMessage(cfg),
        onMessage: (voiceMessage) => {
          const action = this.options.bridge.handleVoiceAgentMessage(callId, voiceMessage);

          // Reset silence timer on meaningful voice provider events
          const msgType = (voiceMessage as Record<string, unknown>).type as string | undefined;
          if (msgType === "ConversationText" || msgType === "AgentAudio" ||
              msgType === "Audio" || msgType === "UserStartedSpeaking" ||
              msgType === "AgentStartedSpeaking") {
            const sess = this.sessionsBySocket.get(socket);
            if (sess) {
              this.resetSilenceTimer(socket, sess, teardownFromVoiceProvider, urlPurpose);
            }
          }

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
          sessionClosed = true;
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

    const origOnClose = voiceSession.close.bind(voiceSession);
    voiceSession.close = () => {
      sessionClosed = true;
      origOnClose();
    };

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
      get readyState() { return sessionClosed ? 3 : 1; },
    });

    const streamSession: StreamSession = {
      callId,
      streamSid: message.streamSid ?? "",
      voiceSession,
      callerPhone: callerPhone || undefined,
      direction: isInbound ? "inbound" : "outbound",
    };
    this.sessionsBySocket.set(socket, streamSession);

    // Start silence timeout — hangs up if no callee interaction within threshold
    this.startSilenceTimer(socket, streamSession, teardownFromVoiceProvider, urlPurpose);
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

    // Reset silence timer on inbound audio — Twilio frames indicate the call
    // is still active even when the voice provider hasn't responded yet.
    if (session.silenceTimer) {
      const teardown = (_detail: string) => {
        session.voiceSession.close();
        socket.close(1000, "Silence timeout");
      };
      this.resetSilenceTimer(socket, session, teardown);
    }
  }
}
