"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaStreamServer = void 0;
const http = __importStar(require("http"));
const ws_1 = require("ws");
const url_1 = require("url");
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 100;
const MAX_BODY_SIZE = 1048576; // 1 MB
class MediaStreamServer {
    constructor(options) {
        this.options = options;
        this.httpServer = null;
        this.wss = null;
        this.routes = [];
        this.activeConnections = 0;
        this.rateLimitMap = new Map();
    }
    /**
     * Register an HTTP route on the standalone server.
     * Handlers receive Express-like req/res shims (req.body, res.status().json(), etc.).
     */
    registerHttpRoute(method, path, handler) {
        this.routes.push({ method: method.toUpperCase(), path, handler });
    }
    async start() {
        if (this.httpServer) {
            return;
        }
        this.httpServer = http.createServer(async (req, res) => {
            await this.handleHttpRequest(req, res);
        });
        this.wss = new ws_1.WebSocketServer({
            noServer: true,
        });
        // Handle WebSocket upgrades only for the media-stream path
        this.httpServer.on("upgrade", (req, socket, head) => {
            const pathname = normalizePath(parsePathname(req.url));
            const expectedPath = normalizePath(this.options.path);
            if (pathname !== expectedPath) {
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
            this.wss.handleUpgrade(req, socket, head, (ws) => {
                this.wss.emit("connection", ws, req);
            });
        });
        this.wss.on("connection", (socket, req) => {
            this.activeConnections++;
            const twilioSocket = socket;
            // Attach URL query params from the WebSocket upgrade request so the
            // session handler can read purpose/greeting context set by the Twilio adapter.
            if (req.url) {
                try {
                    const parsed = new url_1.URL(req.url, "http://localhost");
                    twilioSocket._queryParams = Object.fromEntries(parsed.searchParams.entries());
                }
                catch { /* ignore malformed URLs */ }
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
        await new Promise((resolve, reject) => {
            this.httpServer.listen(this.options.port, this.options.host, () => resolve());
            this.httpServer.once("error", (error) => reject(error));
        });
    }
    async stop() {
        if (!this.httpServer) {
            return;
        }
        const server = this.httpServer;
        const wss = this.wss;
        this.httpServer = null;
        this.wss = null;
        if (wss) {
            await new Promise((resolve) => {
                wss.close(() => resolve());
            });
        }
        await new Promise((resolve) => {
            server.close(() => resolve());
        });
    }
    checkRateLimit(ip) {
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
                if (now >= val.resetAt)
                    this.rateLimitMap.delete(key);
            }
        }
        return true;
    }
    async handleHttpRequest(req, res) {
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
        const route = this.routes.find((r) => r.method === method && r.path === pathname);
        if (!route) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not Found" }));
            return;
        }
        // Parse body with size limit
        const chunks = [];
        let totalSize = 0;
        for await (const chunk of req) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalSize += buf.length;
            if (totalSize > MAX_BODY_SIZE) {
                res.writeHead(413, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Payload Too Large" }));
                return;
            }
            chunks.push(buf);
        }
        const rawBody = Buffer.concat(chunks).toString("utf8");
        let parsedBody = {};
        const ct = req.headers["content-type"] || "";
        if (ct.includes("application/json")) {
            try {
                parsedBody = JSON.parse(rawBody);
            }
            catch { /* ignore */ }
        }
        else if (ct.includes("application/x-www-form-urlencoded")) {
            parsedBody = Object.fromEntries(new URLSearchParams(rawBody));
        }
        // Build Express-like req shim
        const expressReq = Object.assign(req, {
            body: parsedBody,
            protocol: req.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim() || "https",
        });
        // Build Express-like res shim
        let headersSent = false;
        const expressRes = {
            _statusCode: 200,
            _headers: {},
            status(code) { this._statusCode = code; return this; },
            type(t) { this._headers["Content-Type"] = t; return this; },
            json(data) {
                if (headersSent)
                    return;
                headersSent = true;
                res.writeHead(this._statusCode, { ...this._headers, "Content-Type": "application/json" });
                res.end(JSON.stringify(data));
            },
            send(data) {
                if (headersSent)
                    return;
                headersSent = true;
                res.writeHead(this._statusCode, this._headers);
                res.end(data);
            },
        };
        try {
            await route.handler(expressReq, expressRes);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[clawvoice] standalone route handler error:", msg);
            if (!headersSent && !res.headersSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal Server Error" }));
            }
        }
    }
}
exports.MediaStreamServer = MediaStreamServer;
function parsePathname(url) {
    if (!url)
        return "/";
    const qIdx = url.indexOf("?");
    return qIdx >= 0 ? url.slice(0, qIdx) : url;
}
function normalizePath(pathname) {
    if (pathname === "/")
        return "/";
    return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
