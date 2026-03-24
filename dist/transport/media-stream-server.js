"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaStreamServer = void 0;
const http_1 = require("http");
const ws_1 = require("ws");
class MediaStreamServer {
    constructor(options) {
        this.options = options;
        this.httpServer = null;
        this.wss = null;
    }
    async start() {
        if (this.httpServer) {
            return;
        }
        const httpServer = (0, http_1.createServer)((req, res) => {
            this.handleHttpRequest(req, res);
        });
        this.wss = new ws_1.WebSocketServer({
            server: httpServer,
            path: this.options.path,
        });
        this.wss.on("connection", (socket) => {
            const twilioSocket = socket;
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
        await new Promise((resolve, reject) => {
            const onError = (error) => {
                this.httpServer = null;
                this.wss = null;
                const code = error.code;
                if (code === "EADDRINUSE") {
                    console.warn(`[clawvoice] Media stream port ${this.options.port} already in use — another agent instance owns it. This instance will skip media streaming.`);
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
    async stop() {
        const wss = this.wss;
        const http = this.httpServer;
        this.wss = null;
        this.httpServer = null;
        if (wss) {
            await new Promise((resolve) => wss.close(() => resolve()));
        }
        if (http) {
            await new Promise((resolve) => http.close(() => resolve()));
        }
    }
    handleHttpRequest(req, res) {
        const routes = this.options.httpRoutes;
        if (!routes || routes.length === 0) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not Found" }));
            return;
        }
        const method = (req.method ?? "GET").toUpperCase();
        const urlPath = (req.url ?? "/").split("?")[0];
        const match = routes.find((r) => r.method.toUpperCase() === method && r.path === urlPath);
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
exports.MediaStreamServer = MediaStreamServer;
