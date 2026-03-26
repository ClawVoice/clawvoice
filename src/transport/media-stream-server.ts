import { WebSocketServer } from "ws";
import { URL } from "url";
import { TwilioMediaSessionHandler, TwilioWebSocket } from "./media-session-handler";

interface MediaStreamServerOptions {
  host: string;
  port: number;
  path: string;
  sessionHandler: TwilioMediaSessionHandler;
}

export class MediaStreamServer {
  private wss: WebSocketServer | null = null;

  public constructor(private readonly options: MediaStreamServerOptions) {}

  public async start(): Promise<void> {
    if (this.wss) {
      return;
    }

    this.wss = new WebSocketServer({
      host: this.options.host,
      port: this.options.port,
      path: this.options.path,
    });

    this.wss.on("connection", (socket, req) => {
      const twilioSocket = socket as unknown as TwilioWebSocket;

      // Attach URL query params from the WebSocket upgrade request so the
      // session handler can read purpose/greeting context set by the Twilio adapter.
      if (req.url) {
        try {
          const parsed = new URL(req.url, "http://localhost");
          twilioSocket._queryParams = Object.fromEntries(parsed.searchParams.entries());
        } catch { /* ignore malformed URLs */ }
      }
      socket.on("message", (payload) => {
        const text = typeof payload === "string" ? payload : payload.toString("utf8");
        void this.options.sessionHandler.handleMessage(twilioSocket, text).catch(() => {
          twilioSocket.close(1011, "Invalid media stream message");
        });
      });

      socket.on("close", () => {
        this.options.sessionHandler.handleClose(twilioSocket);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.wss?.once("listening", () => resolve());
      this.wss?.once("error", (error) => reject(error));
    });
  }

  public async stop(): Promise<void> {
    if (!this.wss) {
      return;
    }

    const current = this.wss;
    this.wss = null;
    await new Promise<void>((resolve) => {
      current.close(() => resolve());
    });
  }
}
