"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClawVoiceService = void 0;
const telnyx_1 = require("../telephony/telnyx");
const twilio_1 = require("../telephony/twilio");
const deepgram_bridge_1 = require("../transport/deepgram-bridge");
const media_session_handler_1 = require("../transport/media-session-handler");
const media_stream_server_1 = require("../transport/media-stream-server");
const bridge_1 = require("../voice/bridge");
const post_call_1 = require("./post-call");
class ClawVoiceService {
    constructor(config, fetchFn) {
        this.config = config;
        this.running = false;
        this.activeCalls = new Map();
        this.callIdByProviderCallId = new Map();
        this.recentCalls = [];
        this.inboundRecords = [];
        this.textMessages = [];
        this.callTimers = new Map();
        this.dailyCallCount = 0;
        this.dailyResetDate = new Date().toISOString().slice(0, 10);
        this.mediaStreamServer = null;
        this.reaperTimer = null;
        this.telephonyAdapter =
            config.telephonyProvider === "twilio"
                ? new twilio_1.TwilioTelephonyAdapter(config, fetchFn)
                : new telnyx_1.TelnyxTelephonyAdapter(config, fetchFn);
        this.bridge = new bridge_1.VoiceBridgeService(config);
        this.postCall = new post_call_1.PostCallService(config);
        this.deepgramClient = config.deepgramApiKey
            ? new deepgram_bridge_1.DeepgramBridgeClient({ apiKey: config.deepgramApiKey })
            : null;
        this.mediaSessionHandler = this.deepgramClient
            ? new media_session_handler_1.TwilioMediaSessionHandler({
                bridge: this.bridge,
                deepgramClient: this.deepgramClient,
                resolveCallIdByProviderCallId: (providerCallId) => this.findInternalCallIdByProviderCallId(providerCallId),
            })
            : null;
    }
    async start() {
        await this.startStandaloneTransport();
        try {
            this.startReaper();
            this.running = true;
        }
        catch (error) {
            await this.stopStandaloneTransport().catch(() => undefined);
            throw error;
        }
    }
    async stop() {
        await this.stopStandaloneTransport();
        this.stopReaper();
        for (const timer of this.callTimers.values()) {
            clearTimeout(timer);
        }
        this.callTimers.clear();
        await this.bridge.stopAll();
        this.running = false;
    }
    async startStandaloneTransport() {
        if (this.config.telephonyProvider !== "twilio") {
            return;
        }
        if (!this.config.twilioStreamUrl) {
            throw new Error("twilioStreamUrl is required. Set CLAWVOICE_TWILIO_STREAM_URL to your public WSS endpoint.");
        }
        if (!this.mediaSessionHandler) {
            throw new Error("Voice provider credentials are required for Twilio media streaming.");
        }
        if (this.mediaStreamServer) {
            return;
        }
        const streamPath = this.config.mediaStreamPath;
        const streamHost = this.config.mediaStreamBind || "0.0.0.0";
        const streamPort = Number.isFinite(this.config.mediaStreamPort) && this.config.mediaStreamPort > 0
            ? this.config.mediaStreamPort
            : 3101;
        this.mediaStreamServer = new media_stream_server_1.MediaStreamServer({
            host: streamHost,
            port: streamPort,
            path: streamPath,
            sessionHandler: this.mediaSessionHandler,
        });
        await this.mediaStreamServer.start();
    }
    async stopStandaloneTransport() {
        if (!this.mediaStreamServer) {
            return;
        }
        const server = this.mediaStreamServer;
        this.mediaStreamServer = null;
        await server.stop();
    }
    startReaper() {
        if (this.reaperTimer) {
            return;
        }
        this.reaperTimer = setInterval(() => {
            this.reapStaleCalls();
        }, ClawVoiceService.REAPER_INTERVAL_MS);
        this.reaperTimer.unref?.();
    }
    stopReaper() {
        if (this.reaperTimer) {
            clearInterval(this.reaperTimer);
            this.reaperTimer = null;
        }
    }
    reapStaleCalls() {
        const now = Date.now();
        for (const [callId, record] of this.activeCalls) {
            const started = new Date(record.startedAt).getTime();
            const maxDurationMs = Math.floor(this.config.maxCallDuration * 1000);
            const staleAfter = Math.max(maxDurationMs, ClawVoiceService.REAPER_GRACE_MS);
            if (now - started > staleAfter + ClawVoiceService.REAPER_GRACE_MS) {
                this.cleanupCall(callId);
            }
        }
    }
    isRunning() {
        return this.running;
    }
    getProviderSummary() {
        return `${this.config.telephonyProvider}:${this.config.voiceProvider}`;
    }
    createCallId() {
        const now = Date.now();
        const random = Math.floor(Math.random() * 1000000)
            .toString()
            .padStart(6, "0");
        return `call-${now}-${random}`;
    }
    findInternalCallIdByProviderCallId(providerCallId) {
        return this.callIdByProviderCallId.get(providerCallId) ?? null;
    }
    checkDailyLimit() {
        const today = new Date().toISOString().slice(0, 10);
        if (today !== this.dailyResetDate) {
            this.dailyCallCount = 0;
            this.dailyResetDate = today;
        }
        if (this.config.dailyCallLimit > 0 && this.dailyCallCount >= this.config.dailyCallLimit) {
            throw new Error(`Daily call limit reached (${this.config.dailyCallLimit}). Try again tomorrow.`);
        }
    }
    validateCallReadiness() {
        const errors = [];
        if (this.config.voiceProvider === "deepgram-agent" && !this.config.deepgramApiKey) {
            errors.push("Deepgram API key is not configured. Set DEEPGRAM_API_KEY or run 'clawvoice setup'.");
        }
        if (this.config.voiceProvider === "elevenlabs-conversational") {
            if (!this.config.elevenlabsApiKey) {
                errors.push("ElevenLabs API key is not configured. Set ELEVENLABS_API_KEY or run 'clawvoice setup'.");
            }
            if (!this.config.elevenlabsAgentId) {
                errors.push("ElevenLabs agent ID is not configured. Set ELEVENLABS_AGENT_ID or run 'clawvoice setup'.");
            }
        }
        if (this.config.telephonyProvider === "twilio") {
            if (!this.config.twilioStreamUrl?.trim()) {
                errors.push("Twilio media stream URL is not configured. " +
                    "Set CLAWVOICE_TWILIO_STREAM_URL to a public WSS endpoint " +
                    "(e.g. wss://your-tunnel.ngrok-free.dev/media-stream). " +
                    "You need a tunnel (ngrok, Cloudflare Tunnel) to expose your local media stream server. " +
                    "Run 'clawvoice setup' for guided configuration.");
            }
        }
        if (errors.length > 0) {
            throw new Error(`Cannot initiate call — missing configuration:\n${errors.join("\n")}`);
        }
    }
    async startCall(request) {
        this.checkDailyLimit();
        this.validateCallReadiness();
        const baseGreeting = request.greeting?.trim() ||
            "Hello, this is an AI assistant calling on behalf of my user.";
        const disclosure = this.config.disclosureEnabled
            ? this.config.disclosureStatement.trim()
            : "";
        const greeting = disclosure.length > 0
            ? `${disclosure} ${baseGreeting}`
            : baseGreeting;
        const providerResult = await this.telephonyAdapter.startCall({
            to: request.phoneNumber,
            from: this.config.telephonyProvider === "twilio"
                ? this.config.twilioPhoneNumber
                : this.config.telnyxPhoneNumber,
            greeting,
            purpose: request.purpose,
        });
        const callId = this.createCallId();
        const record = {
            callId,
            providerCallId: providerResult.providerCallId,
            to: providerResult.normalizedTo,
            provider: this.config.telephonyProvider,
            purpose: request.purpose,
            greeting,
            startedAt: new Date().toISOString(),
            status: "in-progress",
        };
        this.activeCalls.set(callId, record);
        this.callIdByProviderCallId.set(record.providerCallId, callId);
        this.recentCalls.unshift(record);
        this.recentCalls.splice(20);
        this.dailyCallCount++;
        this.scheduleAutoHangup(callId);
        const bridgeEvent = this.bridge.createSession({
            callId,
            providerCallId: providerResult.providerCallId,
            voiceProviderUrl: this.config.voiceProvider === "deepgram-agent"
                ? "wss://agent.deepgram.com/v1/agent/converse"
                : `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${this.config.elevenlabsAgentId ?? ""}`,
            voiceProviderAuth: this.config.voiceProvider === "elevenlabs-conversational"
                ? (this.config.elevenlabsApiKey ?? "")
                : (this.config.deepgramApiKey ?? ""),
            telephonyCodec: "mulaw",
            voiceProviderCodec: "mulaw",
            sampleRate: 8000,
            greeting,
            systemPrompt: this.config.voiceSystemPrompt
                ? (request.purpose ? `${this.config.voiceSystemPrompt}\n\nCall purpose: ${request.purpose}` : this.config.voiceSystemPrompt)
                : (request.purpose ?? ""),
            voiceModel: this.config.voiceProvider === "elevenlabs-conversational"
                ? (this.config.elevenlabsVoiceId ?? "")
                : this.config.deepgramVoice,
            keepAliveIntervalMs: 5000,
            greetingGracePeriodMs: 3000,
        });
        if (bridgeEvent.type === "connected") {
            this.bridge.startKeepAlive(callId, 5000);
            setTimeout(() => this.bridge.endGreetingGrace(callId), 3000);
        }
        return {
            callId,
            to: providerResult.normalizedTo,
            openingGreeting: greeting,
            message: `Outbound call initiated via ${this.config.telephonyProvider}.`,
        };
    }
    async hangup(callId) {
        const selectedCallId = callId ?? this.activeCalls.keys().next().value;
        if (typeof selectedCallId !== "string") {
            throw new Error("No active call found to hang up.");
        }
        const call = this.activeCalls.get(selectedCallId);
        if (!call) {
            throw new Error(`Call not found: ${selectedCallId}`);
        }
        await this.completeCall(selectedCallId, call.providerCallId);
        return {
            callId: selectedCallId,
            message: "Call ended with a polite closing and clean connection termination.",
        };
    }
    getActiveCalls() {
        return Array.from(this.activeCalls.values());
    }
    /**
     * Force-clear a stuck call record without contacting the provider.
     * Use when a call slot is held by a dead session (e.g. after 31920 or network drop).
     */
    forceClear(callId) {
        const cleared = [];
        if (callId) {
            const call = this.activeCalls.get(callId);
            if (call) {
                this.cleanupCall(callId);
                cleared.push(callId);
            }
        }
        else {
            for (const id of this.activeCalls.keys()) {
                this.cleanupCall(id);
                cleared.push(id);
            }
        }
        return cleared;
    }
    cleanupCall(callId) {
        const call = this.activeCalls.get(callId);
        const providerCallId = call?.providerCallId;
        if (call) {
            call.status = "completed";
            call.endedAt = new Date().toISOString();
        }
        this.activeCalls.delete(callId);
        if (providerCallId) {
            this.callIdByProviderCallId.delete(providerCallId);
        }
        this.bridge.destroySession(callId);
        const timer = this.callTimers.get(callId);
        if (timer) {
            clearTimeout(timer);
            this.callTimers.delete(callId);
        }
    }
    scheduleAutoHangup(callId) {
        const durationMs = Math.floor(this.config.maxCallDuration * 1000);
        const timer = setTimeout(() => {
            void this.autoHangup(callId);
        }, durationMs);
        timer.unref?.();
        this.callTimers.set(callId, timer);
    }
    async autoHangup(callId) {
        const call = this.activeCalls.get(callId);
        if (!call) {
            return;
        }
        await this.completeCall(callId, call.providerCallId);
    }
    trackInboundCall(record) {
        this.inboundRecords.unshift(record);
        this.inboundRecords.splice(50);
    }
    getInboundRecords() {
        return [...this.inboundRecords];
    }
    getCallSummary(callId) {
        const call = this.recentCalls.find((c) => c.callId === callId);
        return call?.summary ?? null;
    }
    async sendText(request) {
        const body = request.message.trim();
        if (body.length === 0) {
            throw new Error("Text message body must not be empty.");
        }
        if (body.length > 1600) {
            throw new Error(`Text message too long (${body.length} chars). Maximum is 1600 characters.`);
        }
        const result = await this.telephonyAdapter.sendSms({
            to: request.phoneNumber,
            from: this.config.telephonyProvider === "twilio"
                ? this.config.twilioPhoneNumber
                : this.config.telnyxPhoneNumber,
            body,
        });
        this.textMessages.unshift({
            id: result.providerMessageId,
            direction: "outbound",
            provider: this.config.telephonyProvider,
            from: this.config.telephonyProvider === "twilio"
                ? (this.config.twilioPhoneNumber ?? "")
                : (this.config.telnyxPhoneNumber ?? ""),
            to: result.normalizedTo,
            body,
            createdAt: new Date().toISOString(),
        });
        this.textMessages.splice(100);
        return {
            messageId: result.providerMessageId,
            to: result.normalizedTo,
            message: `Outbound text sent via ${this.config.telephonyProvider}.`,
        };
    }
    trackInboundText(from, to, body, providerMessageId) {
        this.textMessages.unshift({
            id: providerMessageId ?? `sms-${Date.now()}`,
            direction: "inbound",
            provider: this.config.telephonyProvider,
            from,
            to,
            body,
            createdAt: new Date().toISOString(),
        });
        this.textMessages.splice(100);
    }
    getRecentTexts() {
        return [...this.textMessages];
    }
    async completeCall(callId, providerCallId) {
        const call = this.activeCalls.get(callId);
        if (!call) {
            return;
        }
        const transcript = this.bridge.getTranscript(callId);
        const summary = this.bridge.generateCallSummary(callId);
        call.summary = summary ?? undefined;
        this.bridge.destroySession(callId);
        await this.telephonyAdapter.hangup(providerCallId);
        call.status = "completed";
        call.endedAt = new Date().toISOString();
        this.activeCalls.delete(callId);
        this.callIdByProviderCallId.delete(call.providerCallId);
        if (summary) {
            await this.postCall.processCompletedCall(summary, transcript).catch(() => undefined);
        }
        const timer = this.callTimers.get(callId);
        if (timer) {
            clearTimeout(timer);
            this.callTimers.delete(callId);
        }
    }
}
exports.ClawVoiceService = ClawVoiceService;
ClawVoiceService.REAPER_INTERVAL_MS = 30000; // check every 30s
ClawVoiceService.REAPER_GRACE_MS = 120000;
