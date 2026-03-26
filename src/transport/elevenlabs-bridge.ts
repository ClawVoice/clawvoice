import WebSocket from "ws";
import { twilioToElevenLabs, elevenLabsToTwilio } from "./audio-convert";
import type { VoiceProviderClient, VoiceProviderConnectOptions, VoiceProviderSession } from "./voice-provider-bridge";

type ElevenLabsSocket = {
  readyState: number;
  on(event: "open" | "message" | "error" | "close", handler: (...args: unknown[]) => void): void;
  send(data: string): void;
  close(): void;
};

interface ElevenLabsBridgeClientOptions {
  apiKey: string;
  connectTimeoutMs?: number;
  webSocketFactory?: (url: string, apiKey: string) => ElevenLabsSocket;
}

const OPEN_SOCKET = 1;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export class ElevenLabsBridgeClient implements VoiceProviderClient {
  private readonly apiKey: string;
  private readonly connectTimeoutMs: number;
  private readonly webSocketFactory: (url: string, apiKey: string) => ElevenLabsSocket;

  public constructor(options: ElevenLabsBridgeClientOptions) {
    this.apiKey = options.apiKey;
    this.connectTimeoutMs =
      typeof options.connectTimeoutMs === "number" && options.connectTimeoutMs > 0
        ? options.connectTimeoutMs
        : DEFAULT_CONNECT_TIMEOUT_MS;
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url: string, apiKey: string) =>
        new WebSocket(url, { headers: { "xi-api-key": apiKey } }) as unknown as ElevenLabsSocket);
  }

  public async connect(options: VoiceProviderConnectOptions): Promise<VoiceProviderSession> {
    const { callId, sessionConfig, onMessage, onClose, onError } = options;
    const ws = this.webSocketFactory(sessionConfig.voiceProviderUrl, this.apiKey);

    return new Promise<VoiceProviderSession>((resolve, reject) => {
      let opened = false;
      let settled = false;
      let parseErrorReported = false;

      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeout);
        reject(error);
      };

      const succeed = (session: VoiceProviderSession): void => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeout);
        resolve(session);
      };

      const connectTimeout = setTimeout(() => {
        const timeoutError = new Error(
          `ElevenLabs WS connect timeout for callId=${callId}`,
        );
        onError?.(timeoutError);
        try { ws.close(); } catch { /* noop */ }
        fail(timeoutError);
      }, this.connectTimeoutMs);

      ws.on("open", () => {
        opened = true;

        // MUST send conversation_initiation_client_data immediately after open.
        // Without this, ElevenLabs ignores all incoming audio.
        // NOTE: Do NOT include prompt overrides in conversation_config_override —
        // the ElevenLabs agent config may disallow them. Instead, pass context
        // via dynamic_variables which the agent prompt uses as {{ var_name }}.
        const initMessage: Record<string, unknown> = {
          type: "conversation_initiation_client_data",
          conversation_config_override: {
            stt: {
              user_input_audio_format: "ulaw_8000",
            },
          },
        };

        // Pass call context as dynamic variables for the agent prompt to use.
        // The ElevenLabs agent prompt uses {{ _system_prompt_ }} placeholder.
        // All overrides (prompt, first_message, llm) are locked — only
        // dynamic_variables can inject per-call context.
        const dynamicVars: Record<string, string> = {};
        if (sessionConfig.systemPrompt) {
          dynamicVars._system_prompt_ = sessionConfig.systemPrompt;
        }
        if (Object.keys(dynamicVars).length > 0) {
          initMessage.dynamic_variables = dynamicVars;
        }

        ws.send(JSON.stringify(initMessage));

        succeed({
          sendAudio(chunk: Buffer) {
            if (ws.readyState !== OPEN_SOCKET) return;
            // Send raw Twilio mulaw — we declare ulaw_8000 input format in the init message
            ws.send(JSON.stringify({
              user_audio_chunk: chunk.toString("base64"),
            }));
          },

          sendControl(message: Record<string, unknown>) {
            if (ws.readyState !== OPEN_SOCKET) return;
            if (message.type === "KeepAlive") {
              ws.send(JSON.stringify({ type: "user_activity" }));
              return;
            }
            if (message.type === "client_tool_result") {
              ws.send(JSON.stringify(message));
            }
          },

          close() {
            ws.close();
          },
        });
      });

      ws.on("message", (payload: unknown) => {
        let text = "";
        if (typeof payload === "string") {
          text = payload;
        } else if (Buffer.isBuffer(payload)) {
          text = payload.toString("utf8");
        } else if (payload instanceof ArrayBuffer) {
          text = Buffer.from(payload).toString("utf8");
        }

        if (!text) return;

        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse(text) as Record<string, unknown>;
        } catch {
          if (!parseErrorReported) {
            parseErrorReported = true;
            onError?.(new Error(`Invalid ElevenLabs message JSON for callId=${callId}`));
          }
          return;
        }

        if (raw.type === "ping") {
          const pingEvent = raw.ping_event as Record<string, unknown> | undefined;
          const eventId = pingEvent?.event_id ?? raw.event_id;
          ws.send(JSON.stringify({ type: "pong", event_id: eventId }));
          return;
        }

        const normalized = normalizeMessage(raw);
        if (normalized) {
          onMessage(normalized);
        }
      });

      ws.on("error", (error: unknown) => {
        onError?.(error);
        if (!opened) fail(error);
      });

      ws.on("close", (code: unknown, reason: unknown) => {
        const closeCode = typeof code === "number" ? code : 1000;
        const closeReason =
          typeof reason === "string"
            ? reason
            : Buffer.isBuffer(reason)
              ? reason.toString("utf8")
              : "";
        onClose?.(closeCode, closeReason);
        if (!opened) {
          fail(new Error(`ElevenLabs stream closed before open for callId=${callId}`));
        }
      });
    });
  }
}

/**
 * Normalize ElevenLabs Conversational AI messages to the format
 * VoiceBridgeService.handleVoiceAgentMessage() expects.
 * Returns null for unrecognized message types.
 */
function normalizeMessage(raw: Record<string, unknown>): Record<string, unknown> | null {
  // ElevenLabs Conversational AI messages use top-level event keys
  // (e.g. "audio_event", "user_transcription_event") rather than a "type" field.
  const type = (raw.type as string | undefined)
    ?? (raw.audio_event ? "audio" : undefined)
    ?? (raw.conversation_initiation_metadata_event ? "conversation_initiation_metadata" : undefined)
    ?? (raw.user_transcription_event ? "user_transcript" : undefined)
    ?? (raw.agent_response_event ? "agent_response" : undefined)
    ?? (raw.client_tool_call ? "client_tool_call" : undefined)
    ?? (raw.ping_event ? "ping" : undefined)
    ?? (raw.interruption ? "interruption" : undefined);

  switch (type) {
    case "conversation_initiation_metadata":
      return { type: "SettingsApplied" };

    case "audio": {
      const audioEvent = raw.audio_event as Record<string, unknown> | undefined;
      const audioBase64 = audioEvent?.audio_base_64 as string | undefined;
      if (!audioBase64) return null;
      try {
        // ElevenLabs Conversational AI sends PCM 16-bit at 16kHz → mulaw 8kHz for Twilio
        const pcm16k = Buffer.from(audioBase64, "base64");
        const mulawBuffer = elevenLabsToTwilio(pcm16k);
        return { type: "Audio", data: mulawBuffer };
      } catch {
        return null; // skip malformed audio frames
      }
    }

    case "user_transcript": {
      const transcript = raw.user_transcription_event as Record<string, unknown> | undefined;
      return { type: "ConversationText", role: "user", content: (transcript?.user_transcript as string) ?? "" };
    }

    case "agent_response": {
      const response = raw.agent_response_event as Record<string, unknown> | undefined;
      return { type: "ConversationText", role: "agent", content: (response?.agent_response as string) ?? "" };
    }

    case "interruption":
      return { type: "UserStartedSpeaking" };

    case "agent_response_correction":
      return null;

    case "client_tool_call": {
      const toolCallId = raw.tool_call_id as string ?? raw.client_tool_call_id as string ?? "";
      const toolName = raw.tool_name as string ?? "";
      const parameters = raw.parameters as Record<string, unknown> ?? {};
      return {
        type: "FunctionCallRequest",
        function_call_id: toolCallId,
        function_name: toolName,
        input: parameters,
      };
    }

    default:
      return null;
  }
}
