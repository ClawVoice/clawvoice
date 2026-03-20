"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketRelayService = void 0;
class WebSocketRelayService {
    constructor(config) {
        this.config = config;
        this.running = false;
    }
    async start() {
        this.running = this.config.mode === "managed";
    }
    async stop() {
        this.running = false;
    }
    isRunning() {
        return this.running;
    }
}
exports.WebSocketRelayService = WebSocketRelayService;
