import { createServer, IncomingMessage, ServerResponse, Server } from "http";
import { WebSocketServer } from "ws";
import { TwilioMediaSessionHandler, TwilioWebSocket } from "./media-session-handler";

export interface HttpRouteEntry {
  method: string;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

interface MediaStreamServerOptions {
  host: string;
  port: number;
  path: string;
  sessionHandler: TwilioMediaSessionHandler;
  httpRoutes?: HttpRouteEntry[];
}

export class MediaStreamServer {
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;

  public constructor(private readonly options: MediaStreamServerOptions) {}

  public async start(): Promise<void> {
    if (this.httpServer) {
      return;
    }

    const httpServer = createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({
      server: httpServer,
      path: this.options.path,
    });

    this.wss.on("connection", (socket) => {
      const twilioSocket = socket as unknown as TwilioWebSocket;
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

    this.httpServer = httpServer;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.httpServer = null;
        this.wss = null;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EADDRINUSE") {
          console.warn(
            `[clawvoice] Media stream port ${this.options.port} already in use — another agent instance owns it. This instance will skip media streaming.`,
          );
          resolve();
          return;
        }
        reject(error);
      };
      httpServer.once("error", onError);
      httpServer.once("listening", () => {
        httpServer.removeListener("error", onError);
        resolve();
      });
      httpServer.listen(this.options.port, this.options.host);
    });
  }

  public async stop(): Promise<void> {
    const wss = this.wss;
    const http = this.httpServer;
    this.wss = null;
    this.httpServer = null;

    if (wss) {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    if (http) {
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const routes = this.options.httpRoutes;
    if (!routes || routes.length === 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
      return;
    }

    const method = (req.method ?? "GET").toUpperCase();
    const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
    const urlPath = normalize((req.url ?? "/").split("?")[0]);

    const match = routes.find(
      (r) => r.method.toUpperCase() === method && normalize(r.path) === urlPath,
    );

    if (!match) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
      return;
    }

    match.handler(req, res).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
  }
}
