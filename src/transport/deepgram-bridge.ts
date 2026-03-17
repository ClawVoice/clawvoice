import WebSocket from "ws";

type DeepgramSocket = {
  readyState: number;
  on(event: "open" | "message" | "error" | "close", handler: (...args: unknown[]) => void): void;
  send(data: string | Buffer): void;
  close(): void;
};

export interface DeepgramBridgeSession {
  sendAudio(chunk: Buffer): void;
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
  webSocketFactory?: (url: string, protocols: string[]) => DeepgramSocket;
}

const OPEN_SOCKET = 1;

export class DeepgramBridgeClient {
  private readonly apiKey: string;
  private readonly url: string;
  private readonly webSocketFactory: (url: string, protocols: string[]) => DeepgramSocket;

  public constructor(options: DeepgramBridgeClientOptions) {
    this.apiKey = options.apiKey;
    this.url = options.url ?? "wss://agent.deepgram.com/v1/agent/converse";
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url: string, protocols: string[]) => new WebSocket(url, protocols) as unknown as DeepgramSocket);
  }

  public async connect(options: DeepgramConnectOptions): Promise<DeepgramBridgeSession> {
    const ws = this.webSocketFactory(this.url, ["token", this.apiKey]);

    return new Promise<DeepgramBridgeSession>((resolve, reject) => {
      let opened = false;

      ws.on("open", () => {
        opened = true;
        ws.send(JSON.stringify(options.settings));
        resolve({
          sendAudio(chunk: Buffer) {
            if (ws.readyState === OPEN_SOCKET) {
              ws.send(chunk);
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
          return;
        }
      });

      ws.on("error", (error: unknown) => {
        options.onError?.(error);
        if (!opened) {
          reject(error);
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
      });
    });
  }
}
