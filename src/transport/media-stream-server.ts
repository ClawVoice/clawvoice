import { WebSocketServer } from "ws";
import { TwilioMediaSessionHandler } from "./media-session-handler";

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

    this.wss.on("connection", (socket) => {
      socket.on("message", (payload) => {
        const text = typeof payload === "string" ? payload : payload.toString("utf8");
        void this.options.sessionHandler.handleMessage(socket as never, text);
      });

      socket.on("close", () => {
        this.options.sessionHandler.handleClose(socket as never);
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
