import { DeepgramBridgeClient, DeepgramBridgeSession } from "./deepgram-bridge";
import { VoiceBridgeService, VoiceWebSocket } from "../voice/bridge";

type TwilioWebSocket = VoiceWebSocket & {
  close(code?: number, reason?: string): void;
};

interface StreamSession {
  callId: string;
  streamSid: string;
  deepgram: DeepgramBridgeSession;
}

interface TwilioMediaSessionHandlerOptions {
  bridge: VoiceBridgeService;
  deepgramClient: DeepgramBridgeClient;
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

    session.deepgram.close();
    this.sessionsBySocket.delete(socket);
  }

  private async handleStart(socket: TwilioWebSocket, message: TwilioStartMessage): Promise<void> {
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

    const deepgramSession = await this.options.deepgramClient.connect({
      callId,
      settings: this.options.bridge.buildSettingsMessage(sessionConfig),
      onMessage: (deepgramMessage) => {
        const action = this.options.bridge.handleVoiceAgentMessage(callId, deepgramMessage);
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
      onClose: () => {
        this.options.bridge.reportDisconnection(callId, "voice_provider_error", "Deepgram stream closed");
      },
      onError: () => {
        this.options.bridge.reportDisconnection(callId, "voice_provider_error", "Deepgram stream error");
      },
    });

    this.options.bridge.setVoiceSocket(callId, {
      send: (data) => {
        if (Buffer.isBuffer(data)) {
          deepgramSession.sendAudio(data);
          return;
        }

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          if (parsed.type === "KeepAlive") {
            return;
          }
        } catch {
          return;
        }
      },
      close: () => deepgramSession.close(),
      readyState: socket.readyState,
    });

    this.sessionsBySocket.set(socket, {
      callId,
      streamSid: message.streamSid ?? "",
      deepgram: deepgramSession,
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
    session.deepgram.sendAudio(chunk);
    this.options.bridge.recordActivity(session.callId);
  }
}
