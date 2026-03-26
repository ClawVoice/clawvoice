import * as http from "http";
import { WebSocketServer } from "ws";
import { URL } from "url";
import { TwilioMediaSessionHandler, TwilioWebSocket } from "./media-session-handler";

type HttpHandler = (
  req: http.IncomingMessage & { body: Record<string, unknown>; protocol: string },
  res: HttpResponse,
) => void | Promise<void>;

interface HttpResponse {
  _statusCode: number;
  _headers: Record<string, string>;
  status(code: number): HttpResponse;
  type(contentType: string): HttpResponse;
  json(data: unknown): void;
  send(data: string): void;
}

interface RegisteredRoute {
  method: string;
  path: string;
  handler: HttpHandler;
}

interface MediaStreamServerOptions {
  host: string;
  port: number;
  path: string;
  sessionHandler: TwilioMediaSessionHandler;
}

export class MediaStreamServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly routes: RegisteredRoute[] = [];

  public constructor(private readonly options: MediaStreamServerOptions) {}

  /**
   * Register an HTTP route on the standalone server.
   * Handlers receive Express-like req/res shims (req.body, res.status().json(), etc.).
   */
  public registerHttpRoute(method: string, path: string, handler: HttpHandler): void {
    this.routes.push({ method: method.toUpperCase(), path, handler });
  }

  public async start(): Promise<void> {
    if (this.httpServer) {
      return;
    }

    this.httpServer = http.createServer(async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({
      noServer: true,
    });

    // Handle WebSocket upgrades only for the media-stream path
    this.httpServer.on("upgrade", (req, socket, head) => {
      const pathname = parsePathname(req.url);
      if (pathname === this.options.path || pathname.startsWith(this.options.path + "?")) {
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wss!.emit("connection", ws, req);
        });
      } else {
        socket.destroy();
      }
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
      this.httpServer!.listen(this.options.port, this.options.host, () => resolve());
      this.httpServer!.once("error", (error) => reject(error));
    });
  }

  public async stop(): Promise<void> {
    if (!this.httpServer) {
      return;
    }

    const server = this.httpServer;
    const wss = this.wss;
    this.httpServer = null;
    this.wss = null;

    if (wss) {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = (req.method || "GET").toUpperCase();
    const pathname = parsePathname(req.url);

    // Find matching route
    const route = this.routes.find(
      (r) => r.method === method && r.path === pathname,
    );

    if (!route) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
      return;
    }

    // Parse body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");

    let parsedBody: Record<string, unknown> = {};
    const ct = req.headers["content-type"] || "";
    if (ct.includes("application/json")) {
      try { parsedBody = JSON.parse(rawBody); } catch { /* ignore */ }
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      parsedBody = Object.fromEntries(new URLSearchParams(rawBody));
    }

    // Build Express-like req shim
    const expressReq = Object.assign(req, {
      body: parsedBody,
      protocol: req.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim() || "https",
    });

    // Build Express-like res shim
    let headersSent = false;
    const expressRes: HttpResponse = {
      _statusCode: 200,
      _headers: {} as Record<string, string>,
      status(code: number) { this._statusCode = code; return this; },
      type(t: string) { this._headers["Content-Type"] = t; return this; },
      json(data: unknown) {
        if (headersSent) return;
        headersSent = true;
        res.writeHead(this._statusCode, { ...this._headers, "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      },
      send(data: string) {
        if (headersSent) return;
        headersSent = true;
        res.writeHead(this._statusCode, this._headers);
        res.end(data);
      },
    };

    try {
      await route.handler(expressReq as typeof expressReq & { body: Record<string, unknown>; protocol: string }, expressRes);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[clawvoice] standalone route handler error:", msg);
      if (!headersSent && !res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      }
    }
  }
}

function parsePathname(url: string | undefined): string {
  if (!url) return "/";
  const qIdx = url.indexOf("?");
  return qIdx >= 0 ? url.slice(0, qIdx) : url;
}
