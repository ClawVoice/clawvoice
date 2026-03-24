"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepgramBridgeClient = void 0;
const ws_1 = __importDefault(require("ws"));
const OPEN_SOCKET = 1;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
class DeepgramBridgeClient {
    constructor(options) {
        this.apiKey = options.apiKey;
        this.url = options.url ?? "wss://agent.deepgram.com/v1/agent/converse";
        this.connectTimeoutMs =
            typeof options.connectTimeoutMs === "number" && options.connectTimeoutMs > 0
                ? options.connectTimeoutMs
                : DEFAULT_CONNECT_TIMEOUT_MS;
        this.webSocketFactory =
            options.webSocketFactory ??
                ((url, protocols) => new ws_1.default(url, protocols));
    }
    async connect(options) {
        const settings = options.buildSettings(options.sessionConfig);
        return this.connectDirect({
            callId: options.callId,
            settings,
            onMessage: options.onMessage,
            onClose: options.onClose,
            onError: options.onError,
        });
    }
    async connectDirect(options) {
        const ws = this.webSocketFactory(this.url, ["token", this.apiKey]);
        return new Promise((resolve, reject) => {
            let opened = false;
            let settled = false;
            let parseErrorReported = false;
            const fail = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(connectTimeout);
                reject(error);
            };
            const succeed = (session) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(connectTimeout);
                resolve(session);
            };
            const connectTimeout = setTimeout(() => {
                const timeoutError = new Error(`Deepgram WS connect timeout for callId=${options.callId}`);
                options.onError?.(timeoutError);
                try {
                    ws.close();
                }
                catch {
                }
                fail(timeoutError);
            }, this.connectTimeoutMs);
            ws.on("open", () => {
                opened = true;
                ws.send(JSON.stringify(options.settings));
                succeed({
                    sendAudio(chunk) {
                        if (ws.readyState === OPEN_SOCKET) {
                            ws.send(chunk);
                        }
                    },
                    sendControl(message) {
                        if (ws.readyState === OPEN_SOCKET) {
                            ws.send(JSON.stringify(message));
                        }
                    },
                    close() {
                        ws.close();
                    },
                });
            });
            ws.on("message", (payload) => {
                let text = "";
                if (typeof payload === "string") {
                    text = payload;
                }
                else if (Buffer.isBuffer(payload)) {
                    text = payload.toString("utf8");
                }
                else if (payload instanceof ArrayBuffer) {
                    text = Buffer.from(payload).toString("utf8");
                }
                if (!text) {
                    return;
                }
                try {
                    const message = JSON.parse(text);
                    options.onMessage(message);
                }
                catch {
                    if (!parseErrorReported) {
                        parseErrorReported = true;
                        options.onError?.(new Error(`Invalid Deepgram message JSON for callId=${options.callId}`));
                    }
                }
            });
            ws.on("error", (error) => {
                options.onError?.(error);
                if (!opened) {
                    fail(error);
                }
            });
            ws.on("close", (code, reason) => {
                const closeCode = typeof code === "number" ? code : 1000;
                const closeReason = typeof reason === "string"
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
exports.DeepgramBridgeClient = DeepgramBridgeClient;
