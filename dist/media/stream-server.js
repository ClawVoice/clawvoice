"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaStreamServer = void 0;
const node_http_1 = require("node:http");
const node_crypto_1 = require("node:crypto");
const WS_MAGIC = "258EAFA5-E914-47DA-95CA-5AB9FE44F713";
class MediaStreamServer {
    constructor(config, bridge) {
        this.config = config;
        this.bridge = bridge;
        this.server = null;
        this.connections = new Map();
    }
    async start(port) {
        return new Promise((resolve, reject) => {
            this.server = (0, node_http_1.createServer)((_req, res) => {
                res.writeHead(426, { "Content-Type": "text/plain" });
                res.end("Upgrade Required");
            });
            this.server.on("upgrade", (req, socket, head) => {
                this.handleUpgrade(req, socket, head);
            });
            this.server.on("error", reject);
            this.server.listen(port, () => {
                const addr = this.server?.address();
                const boundPort = typeof addr === "object" && addr ? addr.port : port;
                resolve(boundPort);
            });
        });
    }
    async stop() {
        for (const conn of this.connections.values()) {
            conn.socket.destroy();
        }
        this.connections.clear();
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => resolve());
            }
            else {
                resolve();
            }
        });
    }
    getPort() {
        const addr = this.server?.address();
        return typeof addr === "object" && addr ? addr.port : null;
    }
    getConnectionCount() {
        return this.connections.size;
    }
    handleUpgrade(req, socket, head) {
        const wsKey = req.headers["sec-websocket-key"];
        if (!wsKey) {
            socket.destroy();
            return;
        }
        const acceptKey = (0, node_crypto_1.createHash)("sha1")
            .update(wsKey + WS_MAGIC)
            .digest("base64");
        socket.write("HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
            "\r\n");
        const callSid = this.extractCallSid(req.url ?? "");
        const conn = {
            callSid: callSid || `unknown-${Date.now()}`,
            socket,
            alive: true,
        };
        this.connections.set(conn.callSid, conn);
        if (head.length > 0) {
            this.handleWsData(conn, head);
        }
        socket.on("data", (data) => {
            this.handleWsData(conn, data);
        });
        socket.on("close", () => {
            this.connections.delete(conn.callSid);
        });
        socket.on("error", () => {
            this.connections.delete(conn.callSid);
            socket.destroy();
        });
    }
    handleWsData(conn, raw) {
        const frames = this.decodeWsFrames(raw);
        for (const frame of frames) {
            if (frame.opcode === 0x01) {
                this.handleTextFrame(conn, frame.payload.toString("utf8"));
            }
            else if (frame.opcode === 0x02) {
                this.handleBinaryFrame(conn, frame.payload);
            }
            else if (frame.opcode === 0x08) {
                conn.socket.destroy();
                this.connections.delete(conn.callSid);
            }
            else if (frame.opcode === 0x09) {
                this.sendWsFrame(conn.socket, 0x0a, frame.payload);
            }
        }
    }
    handleTextFrame(conn, text) {
        let msg;
        try {
            msg = JSON.parse(text);
        }
        catch {
            return;
        }
        const event = msg.event;
        if (event === "connected") {
            conn.alive = true;
        }
        else if (event === "start") {
            const start = msg.start;
            if (start?.callSid && typeof start.callSid === "string") {
                const oldKey = conn.callSid;
                conn.callSid = start.callSid;
                this.connections.delete(oldKey);
                this.connections.set(conn.callSid, conn);
            }
        }
        else if (event === "media") {
            const media = msg.media;
            if (media?.payload && typeof media.payload === "string") {
                const audioData = Buffer.from(media.payload, "base64");
                const flushed = this.bridge.bufferTelephonyAudio(conn.callSid, audioData);
                if (flushed) {
                    this.forwardToVoiceProvider(conn.callSid, flushed);
                }
            }
        }
        else if (event === "stop") {
            this.bridge.destroySession(conn.callSid);
            conn.socket.destroy();
            this.connections.delete(conn.callSid);
        }
    }
    handleBinaryFrame(_conn, _payload) {
        // Twilio media stream uses JSON text frames, not binary
    }
    forwardToVoiceProvider(callId, audioBuffer) {
        const ws = this.bridge.getVoiceSocket(callId);
        if (ws && ws.readyState === 1) {
            ws.send(audioBuffer);
        }
    }
    sendAudioToTwilio(callSid, audioPayload) {
        const conn = this.connections.get(callSid);
        if (!conn || !conn.alive)
            return;
        const b64 = audioPayload.toString("base64");
        const msg = JSON.stringify({
            event: "media",
            streamSid: callSid,
            media: { payload: b64 },
        });
        this.sendWsFrame(conn.socket, 0x01, Buffer.from(msg, "utf8"));
    }
    extractCallSid(url) {
        const match = url.match(/[?&]callSid=([^&]+)/);
        return match ? decodeURIComponent(match[1]) : "";
    }
    sendWsFrame(socket, opcode, payload) {
        const len = payload.length;
        let header;
        if (len < 126) {
            header = Buffer.alloc(2);
            header[0] = 0x80 | opcode;
            header[1] = len;
        }
        else if (len < 65536) {
            header = Buffer.alloc(4);
            header[0] = 0x80 | opcode;
            header[1] = 126;
            header.writeUInt16BE(len, 2);
        }
        else {
            header = Buffer.alloc(10);
            header[0] = 0x80 | opcode;
            header[1] = 127;
            header.writeBigUInt64BE(BigInt(len), 2);
        }
        socket.write(Buffer.concat([header, payload]));
    }
    decodeWsFrames(data) {
        const frames = [];
        let offset = 0;
        while (offset < data.length) {
            if (offset + 2 > data.length)
                break;
            const byte0 = data[offset];
            const byte1 = data[offset + 1];
            const opcode = byte0 & 0x0f;
            const masked = (byte1 & 0x80) !== 0;
            let payloadLen = byte1 & 0x7f;
            offset += 2;
            if (payloadLen === 126) {
                if (offset + 2 > data.length)
                    break;
                payloadLen = data.readUInt16BE(offset);
                offset += 2;
            }
            else if (payloadLen === 127) {
                if (offset + 8 > data.length)
                    break;
                payloadLen = Number(data.readBigUInt64BE(offset));
                offset += 8;
            }
            let maskKey = null;
            if (masked) {
                if (offset + 4 > data.length)
                    break;
                maskKey = data.subarray(offset, offset + 4);
                offset += 4;
            }
            if (offset + payloadLen > data.length)
                break;
            const payload = Buffer.alloc(payloadLen);
            data.copy(payload, 0, offset, offset + payloadLen);
            if (maskKey) {
                for (let i = 0; i < payloadLen; i++) {
                    payload[i] ^= maskKey[i % 4];
                }
            }
            frames.push({ opcode, payload });
            offset += payloadLen;
        }
        return frames;
    }
}
exports.MediaStreamServer = MediaStreamServer;
