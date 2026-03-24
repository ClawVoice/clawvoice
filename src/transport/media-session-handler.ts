import { VoiceProviderClient, VoiceProviderSession } from "./voice-provider-bridge";
import { VoiceBridgeService, VoiceWebSocket } from "../voice/bridge";

export type TwilioWebSocket = VoiceWebSocket & {
  close(code?: number, reason?: string): void;
};

interface StreamSession {
  callId: string;
  streamSid: string;
  voiceSession: VoiceProviderSession;
  localClose: boolean;
}

interface TwilioMediaSessionHandlerOptions {
  bridge: VoiceBridgeService;
  voiceProviderClient: VoiceProviderClient;
  resolveCallIdByProviderCallId: (providerCallId: string) => string | null;
}

interface TwilioStartMessage {
  event: "start";
  streamSid?: string;
  start?: { callSid?: string };
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

    session.localClose = true;
    session.voiceSession.close();
    this.sessionsBySocket.delete(socket);
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

    const callId = this.options.resolveCallIdByProviderCallId(providerCallId);
    if (!callId) {
      socket.close(1008, "Unknown callSid");
      return;
    }

    const sessionConfig = this.options.bridge.getSessionConfig(callId);
    if (!sessionConfig) {
      socket.close(1011, "Missing bridge session");
      return;
    }

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
        sessionConfig,
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
          const session = this.sessionsBySocket.get(socket);
          if (session?.localClose) return;
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
      localClose: false,
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
