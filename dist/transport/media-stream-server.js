"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaStreamServer = void 0;
const ws_1 = require("ws");
class MediaStreamServer {
    constructor(options) {
        this.options = options;
        this.wss = null;
    }
    async start() {
        if (this.wss) {
            return;
        }
        this.wss = new ws_1.WebSocketServer({
            host: this.options.host,
            port: this.options.port,
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
        await new Promise((resolve, reject) => {
            this.wss?.once("listening", () => resolve());
            this.wss?.once("error", (error) => {
                this.wss?.close();
                this.wss = null;
                reject(error);
            });
        });
    }
    async stop() {
        if (!this.wss) {
            return;
        }
        const current = this.wss;
        this.wss = null;
        await new Promise((resolve) => {
            current.close(() => resolve());
        });
    }
}
exports.MediaStreamServer = MediaStreamServer;
