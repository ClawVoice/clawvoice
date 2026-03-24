import WebSocket from "ws";
import type { VoiceProviderClient, VoiceProviderConnectOptions, VoiceProviderSession } from "./voice-provider-bridge";

type DeepgramSocket = {
  readyState: number;
  on(event: "open" | "message" | "error" | "close", handler: (...args: unknown[]) => void): void;
  send(data: string | Buffer): void;
  close(): void;
};

export interface DeepgramBridgeSession {
  sendAudio(chunk: Buffer): void;
  sendControl?(message: Record<string, unknown>): void;
  close(): void;
}

export interface DeepgramConnectOptions {
  callId: string;
  settings: Record<string, unknown>;
  onMessage: (message: Record<string, unknown>) => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (error: unknown) => void;
}

interface DeepgramBridgeClientOptions {
  apiKey: string;
  url?: string;
  connectTimeoutMs?: number;
  webSocketFactory?: (url: string, protocols: string[]) => DeepgramSocket;
}

const OPEN_SOCKET = 1;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export class DeepgramBridgeClient implements VoiceProviderClient {
  private readonly apiKey: string;
  private readonly url: string;
  private readonly connectTimeoutMs: number;
  private readonly webSocketFactory: (url: string, protocols: string[]) => DeepgramSocket;

  public constructor(options: DeepgramBridgeClientOptions) {
    this.apiKey = options.apiKey;
    this.url = options.url ?? "wss://agent.deepgram.com/v1/agent/converse";
    this.connectTimeoutMs =
      typeof options.connectTimeoutMs === "number" && options.connectTimeoutMs > 0
        ? options.connectTimeoutMs
        : DEFAULT_CONNECT_TIMEOUT_MS;
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url: string, protocols: string[]) => new WebSocket(url, protocols) as unknown as DeepgramSocket);
  }

  public async connect(options: VoiceProviderConnectOptions): Promise<VoiceProviderSession> {
    const settings = options.buildSettings(options.sessionConfig);
    return this.connectDirect({
      callId: options.callId,
      settings,
      onMessage: options.onMessage,
      onClose: options.onClose,
      onError: options.onError,
    });
  }

  public async connectDirect(options: DeepgramConnectOptions): Promise<DeepgramBridgeSession> {
    const ws = this.webSocketFactory(this.url, ["token", this.apiKey]);

    return new Promise<DeepgramBridgeSession>((resolve, reject) => {
      let opened = false;
      let settled = false;
      let parseErrorReported = false;

      const fail = (error: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectTimeout);
        reject(error);
      };

      const succeed = (session: DeepgramBridgeSession): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectTimeout);
        resolve(session);
      };

      const connectTimeout = setTimeout(() => {
        const timeoutError = new Error(
          `Deepgram WS connect timeout for callId=${options.callId}`,
        );
        options.onError?.(timeoutError);
        try {
          ws.close();
        } catch {
        }
        fail(timeoutError);
      }, this.connectTimeoutMs);

      ws.on("open", () => {
        opened = true;
        ws.send(JSON.stringify(options.settings));
        succeed({
          sendAudio(chunk: Buffer) {
            if (ws.readyState === OPEN_SOCKET) {
              ws.send(chunk);
            }
          },
          sendControl(message: Record<string, unknown>) {
            if (ws.readyState === OPEN_SOCKET) {
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

        if (!text) {
          return;
        }

        try {
          const message = JSON.parse(text) as Record<string, unknown>;
          options.onMessage(message);
        } catch {
          if (!parseErrorReported) {
            parseErrorReported = true;
            options.onError?.(
              new Error(`Invalid Deepgram message JSON for callId=${options.callId}`),
            );
          }
        }
      });

      ws.on("error", (error: unknown) => {
        options.onError?.(error);
        if (!opened) {
          fail(error);
        }
      });

      ws.on("close", (code: unknown, reason: unknown) => {
        const closeCode = typeof code === "number" ? code : 1000;
        const closeReason =
          typeof reason === "string"
            ? reason
            : Buffer.isBuffer(reason)
              ? reason.toString("utf8")
              : "";
        options.onClose?.(closeCode, closeReason);
        if (!opened) {
          fail(new Error(`Deepgram stream closed before open for callId=${options.callId}`));
        }
      });
    });
  }
}
