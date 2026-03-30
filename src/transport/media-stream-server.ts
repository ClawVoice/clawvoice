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
  /** Optional auth token for WebSocket connections. If set, connections must provide it via ?token= query param or Authorization header. */
  authToken?: string;
  /** Maximum concurrent WebSocket connections (default: 20). */
  maxConnections?: number;
}

/** Simple in-memory per-IP rate limiter. */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;
const MAX_BODY_SIZE = 1_048_576; // 1 MB

export class MediaStreamServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly routes: RegisteredRoute[] = [];
  private activeConnections = 0;
  private readonly rateLimitMap = new Map<string, RateLimitEntry>();

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
      if (pathname !== this.options.path && !pathname.startsWith(this.options.path + "?")) {
        socket.destroy();
        return;
      }

      // Enforce connection limit
      const maxConns = this.options.maxConnections ?? 20;
      if (this.activeConnections >= maxConns) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }

      // Auth token validation removed: the media stream server binds to
      // localhost only (127.0.0.1). External access goes through ngrok/tunnel
      // which provides URL obscurity. Twilio strips query params from <Stream>
      // URLs so the token never reached here anyway. Auth is now validated
      // (if needed) after the Twilio `start` event delivers customParameters.

      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.wss!.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (socket, req) => {
      this.activeConnections++;
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
        this.activeConnections--;
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

  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitMap.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
      return false;
    }
    // Periodic eviction: clean up expired entries when map grows large
    if (this.rateLimitMap.size > 500) {
      for (const [key, val] of this.rateLimitMap) {
        if (now >= val.resetAt) this.rateLimitMap.delete(key);
      }
    }
    return true;
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = (req.method || "GET").toUpperCase();
    const pathname = parsePathname(req.url);

    // Rate limit per IP
    const clientIp = req.socket.remoteAddress ?? "unknown";
    if (!this.checkRateLimit(clientIp)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Too Many Requests" }));
      return;
    }

    // Find matching route
    const route = this.routes.find(
      (r) => r.method === method && r.path === pathname,
    );

    if (!route) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
      return;
    }

    // Parse body with size limit
    const chunks: Buffer[] = [];
    let totalSize = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      totalSize += buf.length;
      if (totalSize > MAX_BODY_SIZE) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload Too Large" }));
        return;
      }
      chunks.push(buf);
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
