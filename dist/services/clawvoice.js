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
exports.ClawVoiceService = void 0;
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const routes_1 = require("../routes");
const telnyx_1 = require("../telephony/telnyx");
const twilio_1 = require("../telephony/twilio");
const deepgram_bridge_1 = require("../transport/deepgram-bridge");
const elevenlabs_bridge_1 = require("../transport/elevenlabs-bridge");
const media_session_handler_1 = require("../transport/media-session-handler");
const media_stream_server_1 = require("../transport/media-stream-server");
const bridge_1 = require("../voice/bridge");
const post_call_1 = require("./post-call");
const user_profile_1 = require("./user-profile");
class ClawVoiceService {
    getWorkspacePath() {
        return this.workspacePath;
    }
    constructor(config, fetchFn, workspacePath) {
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
        this.systemEventEmitter = null;
        this.smsReplyTimestamps = new Map();
        /** In-memory map for passing call context via short reference IDs instead of URL query params. */
        this.pendingCallContext = new Map();
        this.pendingContextCleanupTimer = null;
        this.mediaStreamServer = null;
        this.reaperTimer = null;
        this.workspacePath = workspacePath;
        // Generate a deterministic auth token from the Twilio auth token (C1)
        if (config.twilioAuthToken) {
            this.mediaStreamAuthToken = (0, crypto_1.createHash)("sha256")
                .update(`clawvoice-media-stream:${config.twilioAuthToken}`)
                .digest("hex")
                .slice(0, 32);
        }
        this.telephonyAdapter =
            config.telephonyProvider === "twilio"
                ? new twilio_1.TwilioTelephonyAdapter(config, fetchFn)
                : new telnyx_1.TelnyxTelephonyAdapter(config, fetchFn);
        this.bridge = new bridge_1.VoiceBridgeService(config);
        this.postCall = new post_call_1.PostCallService(config);
        this.voiceProviderClient = this.createVoiceProviderClient(config);
        this.mediaSessionHandler = this.voiceProviderClient
            ? new media_session_handler_1.TwilioMediaSessionHandler({
                bridge: this.bridge,
                voiceProviderClient: this.voiceProviderClient,
                resolveCallIdByProviderCallId: (providerCallId) => this.findInternalCallIdByProviderCallId(providerCallId),
                workspacePath: this.workspacePath,
                voiceProviderUrl: config.voiceProvider === "deepgram-agent"
                    ? "wss://agent.deepgram.com/v1/agent/converse"
                    : `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${config.elevenlabsAgentId ?? ""}`,
                voiceProviderAuth: config.voiceProvider === "elevenlabs-conversational"
                    ? (config.elevenlabsApiKey ?? "")
                    : (config.deepgramApiKey ?? ""),
                voiceModel: config.voiceProvider === "elevenlabs-conversational"
                    ? (config.elevenlabsVoiceId ?? "")
                    : config.deepgramVoice,
                voiceSystemPrompt: config.voiceSystemPrompt,
                authToken: this.mediaStreamAuthToken,
                allowAutoAccept: true,
                /** Resolver for pending call context references (C2). */
                resolveCallContext: (refId) => this.pendingCallContext.get(refId) ?? null,
                onCallCompleted: (callId, summary, transcript, meta) => {
                    const call = this.activeCalls.get(callId);
                    if (call) {
                        call.status = "completed";
                        call.endedAt = new Date().toISOString();
                        this.activeCalls.delete(callId);
                        this.callIdByProviderCallId.delete(call.providerCallId);
                    }
                    const timer = this.callTimers.get(callId);
                    if (timer) {
                        clearTimeout(timer);
                        this.callTimers.delete(callId);
                    }
                    if (!summary)
                        return;
                    void this.postCall
                        .processCompletedCall(summary, transcript, call?.recordingUrl, meta)
                        .catch(() => undefined);
                },
            })
            : null;
        // Start periodic cleanup of expired pending call context entries (5 min TTL)
        this.pendingContextCleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.pendingCallContext) {
                if (now - entry.createdAt > 300000) {
                    this.pendingCallContext.delete(key);
                }
            }
        }, 60000);
        this.pendingContextCleanupTimer.unref?.();
    }
    createVoiceProviderClient(config) {
        if (config.voiceProvider === "elevenlabs-conversational") {
            if (!config.elevenlabsApiKey || !config.elevenlabsAgentId)
                return null;
            return new elevenlabs_bridge_1.ElevenLabsBridgeClient({ apiKey: config.elevenlabsApiKey });
        }
        if (!config.deepgramApiKey)
            return null;
        return new deepgram_bridge_1.DeepgramBridgeClient({ apiKey: config.deepgramApiKey });
    }
    async start() {
        try {
            await this.startStandaloneTransport();
        }
        catch (error) {
            // EADDRINUSE is expected in multi-instance environments — another instance
            // already owns the media stream port. Call placement still works via Twilio API;
            // only the media stream server is unavailable in this instance.
            const isPortConflict = error instanceof Error && error.code === "EADDRINUSE";
            if (isPortConflict) {
                console.warn("[clawvoice] Media stream port already in use — media stream server not started. Call placement still works via Twilio API.");
            }
            else {
                throw error;
            }
        }
        this.startReaper();
        this.running = true;
    }
    async stop() {
        await this.stopStandaloneTransport();
        this.stopReaper();
        for (const timer of this.callTimers.values()) {
            clearTimeout(timer);
        }
        this.callTimers.clear();
        if (this.pendingContextCleanupTimer) {
            clearInterval(this.pendingContextCleanupTimer);
            this.pendingContextCleanupTimer = null;
        }
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
            authToken: this.mediaStreamAuthToken,
        });
        // Register webhook routes on the standalone server so they work
        // even when the OpenClaw gateway doesn't dispatch plugin routes.
        (0, routes_1.registerStandaloneWebhookRoutes)(this.mediaStreamServer, this.config, {
            onInbound: (record) => this.notifyInboundCall(record),
            onInboundText: (from, to, body, messageId) => {
                void this.handleInboundSms(from, to, body, messageId).catch((e) => {
                    console.error("[clawvoice] handleInboundSms error:", e instanceof Error ? e.message : String(e));
                });
            },
            onRecording: (providerCallId, recordingUrl) => {
                this.setRecordingUrl(providerCallId, recordingUrl);
            },
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
        // Store purpose/greeting in-memory and pass only a short reference ID (C2)
        const refId = (0, crypto_1.randomBytes)(16).toString("hex");
        this.pendingCallContext.set(refId, {
            purpose: request.purpose,
            greeting,
            createdAt: Date.now(),
        });
        const providerResult = await this.telephonyAdapter.startCall({
            to: request.phoneNumber,
            from: this.config.telephonyProvider === "twilio"
                ? this.config.twilioPhoneNumber
                : this.config.telnyxPhoneNumber,
            greeting,
            purpose: request.purpose,
            refId,
            mediaStreamAuthToken: this.mediaStreamAuthToken,
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
    setRecordingUrl(providerCallId, recordingUrl) {
        const callId = this.callIdByProviderCallId.get(providerCallId);
        if (!callId) {
            // Call may already be completed — check recent calls
            for (const call of this.recentCalls) {
                if (call.providerCallId === providerCallId) {
                    call.recordingUrl = recordingUrl;
                    return;
                }
            }
            return;
        }
        const call = this.activeCalls.get(callId);
        if (call) {
            call.recordingUrl = recordingUrl;
        }
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
    setSystemEventEmitter(emitter) {
        this.systemEventEmitter = emitter;
    }
    /**
     * Handle an inbound SMS: record it, send auto-reply, and notify owner agent.
     */
    async handleInboundSms(from, to, body, messageId) {
        // Record the inbound text
        this.trackInboundText(from, to, body, messageId);
        // Don't auto-reply to own number (prevent loops)
        const ownNumber = this.config.telephonyProvider === "twilio"
            ? this.config.twilioPhoneNumber
            : this.config.telnyxPhoneNumber;
        if (ownNumber && from === ownNumber) {
            return;
        }
        // Load user profile for the owner name
        let ownerName = "the owner";
        if (this.workspacePath) {
            try {
                const voiceMemoryDir = path.join(this.workspacePath, "voice-memory");
                const profile = (0, user_profile_1.readUserProfile)(voiceMemoryDir);
                if (profile.ownerName) {
                    ownerName = profile.ownerName;
                }
            }
            catch { /* best-effort */ }
        }
        // Send auto-reply with rate limiting (1 reply per number per 60 seconds)
        if (this.config.smsAutoReply) {
            const now = Date.now();
            const lastReply = this.smsReplyTimestamps.get(from) ?? 0;
            if (now - lastReply >= 60000) {
                try {
                    const replyBody = `Hi, this is ${ownerName}'s assistant. I've received your message and will relay it.`;
                    await this.telephonyAdapter.sendSms({
                        to: from,
                        from: ownNumber || "",
                        body: replyBody,
                    });
                    this.smsReplyTimestamps.set(from, now);
                    // Clean up old timestamps (keep map bounded)
                    if (this.smsReplyTimestamps.size > 500) {
                        const cutoff = now - 120000;
                        for (const [key, ts] of this.smsReplyTimestamps) {
                            if (ts < cutoff)
                                this.smsReplyTimestamps.delete(key);
                        }
                    }
                }
                catch (e) {
                    console.error("[clawvoice] SMS auto-reply failed:", e instanceof Error ? e.message : String(e));
                }
            }
        }
        // Notify owner agent via system event emitter
        if (this.systemEventEmitter) {
            const maskPhone = (num) => num.length > 4 ? num.slice(0, -4).replace(/./g, "*") + num.slice(-4) : "****";
            const autoReplied = this.config.smsAutoReply ? " (auto-reply sent)" : "";
            this.systemEventEmitter(`Inbound SMS from ${maskPhone(from)}: "${body}"${autoReplied}`, { source: "clawvoice" });
        }
    }
    /**
     * Emit a system event when an inbound call arrives.
     */
    notifyInboundCall(record) {
        this.trackInboundCall(record);
        if (this.systemEventEmitter) {
            const maskPhone = (num) => num.length > 4 ? num.slice(0, -4).replace(/./g, "*") + num.slice(-4) : "****";
            this.systemEventEmitter(`Incoming call from ${maskPhone(record.from)} to ${maskPhone(record.to)} (${record.provider}, action: ${record.decision.action})`, { source: "clawvoice" });
        }
    }
    /**
     * Wait for a call to complete (status changes from in-progress to completed).
     * Resolves with the call summary, or null if the call wasn't found.
     * Times out after maxWaitMs (default: maxCallDuration + 30s buffer).
     */
    waitForCallCompletion(callId, maxWaitMs) {
        const timeout = maxWaitMs ?? (this.config.maxCallDuration * 1000 + 30000);
        return new Promise((resolve) => {
            const startedAt = Date.now();
            const check = () => {
                const call = this.activeCalls.get(callId);
                // Call no longer active — it completed
                if (!call) {
                    const summary = this.getCallSummary(callId);
                    resolve(summary);
                    return;
                }
                if (Date.now() - startedAt > timeout) {
                    resolve(null);
                    return;
                }
                const timer = setTimeout(check, 2000);
                timer.unref?.();
            };
            // First check after 5s (calls need time to connect)
            const timer = setTimeout(check, 5000);
            timer.unref?.();
        });
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
        // Hang up first, then destroy session — ensures telephony provider
        // receives the hangup before we tear down the local bridge session.
        // Cleanup runs in `finally` so a hangup failure never leaves zombie calls.
        try {
            await this.telephonyAdapter.hangup(providerCallId);
        }
        finally {
            this.bridge.destroySession(callId);
            call.status = "completed";
            call.endedAt = new Date().toISOString();
            this.activeCalls.delete(callId);
            this.callIdByProviderCallId.delete(call.providerCallId);
            if (summary) {
                await this.postCall.processCompletedCall(summary, transcript, call.recordingUrl, {
                    callerPhone: call.to,
                    direction: "outbound",
                }).catch(() => undefined);
            }
            const timer = this.callTimers.get(callId);
            if (timer) {
                clearTimeout(timer);
                this.callTimers.delete(callId);
            }
        }
    }
}
exports.ClawVoiceService = ClawVoiceService;
ClawVoiceService.REAPER_INTERVAL_MS = 30000; // check every 30s
ClawVoiceService.REAPER_GRACE_MS = 120000;
