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
exports.TwilioMediaSessionHandler = void 0;
const crypto_1 = require("crypto");
const user_profile_1 = require("../services/user-profile");
const path = __importStar(require("path"));
class TwilioMediaSessionHandler {
    constructor(options) {
        this.options = options;
        this.sessionsBySocket = new Map();
        this.localCloses = new Set();
        this.completedCallIds = new Set();
    }
    async handleMessage(socket, payload) {
        let message;
        try {
            message = JSON.parse(payload);
        }
        catch {
            return;
        }
        if (message.event === "start") {
            await this.handleStart(socket, message);
            return;
        }
        if (message.event === "media") {
            this.handleMedia(socket, message);
            return;
        }
        if (message.event === "stop") {
            this.handleClose(socket);
        }
    }
    handleClose(socket) {
        const session = this.sessionsBySocket.get(socket);
        if (!session) {
            return;
        }
        this.localCloses.add(socket);
        session.voiceSession.close();
        this.sessionsBySocket.delete(socket);
        // Trigger post-call processing only once per callId (idempotent)
        if (this.options.onCallCompleted && !this.completedCallIds.has(session.callId)) {
            this.completedCallIds.add(session.callId);
            if (this.completedCallIds.size > TwilioMediaSessionHandler.MAX_COMPLETED) {
                const oldest = this.completedCallIds.values().next().value;
                if (oldest) {
                    this.completedCallIds.delete(oldest);
                }
            }
            const transcript = this.options.bridge.getTranscript(session.callId);
            const summary = this.options.bridge.generateCallSummary(session.callId);
            try {
                this.options.onCallCompleted(session.callId, summary, transcript, {
                    callerPhone: session.callerPhone,
                    direction: session.direction,
                });
            }
            catch { /* post-call is best-effort */ }
        }
    }
    async handleStart(socket, message) {
        const existingSession = this.sessionsBySocket.get(socket);
        if (existingSession) {
            this.handleClose(socket);
        }
        const providerCallId = message.start?.callSid;
        if (!providerCallId) {
            socket.close(1008, "Missing callSid");
            return;
        }
        // Resolve purpose/greeting from in-memory store via reference ID.
        // Twilio delivers ref and token as customParameters (from TwiML <Parameter> elements)
        // since <Stream> URLs strip query params.
        const cp = message.start?.customParameters ?? {};
        const qp = socket._queryParams ?? {};
        const expectedToken = this.options.authToken;
        const receivedToken = cp.clawvoice_token || cp.token || qp.token || "";
        if (expectedToken && receivedToken !== expectedToken) {
            socket.close(1008, "Invalid media-stream token");
            return;
        }
        const refId = cp.clawvoice_ref || cp.ref || qp.ref || "";
        const resolvedContext = refId && this.options.resolveCallContext
            ? this.options.resolveCallContext(refId)
            : null;
        const urlPurpose = resolvedContext?.purpose || cp.purpose || "";
        const urlGreeting = resolvedContext?.greeting || cp.greeting || "";
        // For outbound: "to" = the number being called. For inbound: "from" = the caller's number.
        const outboundTo = cp.to || qp.to || "";
        const inboundFrom = cp.from || qp.from || "";
        const callerPhone = inboundFrom || outboundTo;
        const isInbound = !!inboundFrom || (!urlPurpose && !outboundTo);
        // Auto-accept unknown callSids: the call may have been placed by one
        // plugin instance while the media stream arrives at another.
        let callId = this.options.resolveCallIdByProviderCallId(providerCallId);
        if (!callId) {
            const allowAutoAccept = this.options.allowAutoAccept ?? false;
            if (!allowAutoAccept || !this.options.voiceProviderUrl) {
                socket.close(1008, "Unknown callSid and auto-accept is disabled or misconfigured");
                return;
            }
            callId = `auto-${(0, crypto_1.randomUUID)()}`;
        }
        let sessionConfig = this.options.bridge.getSessionConfig(callId);
        if (!sessionConfig) {
            // Auto-create a bridge session with default config for auto-accepted calls.
            // Read voice provider URL/auth/model from handler options.
            const defaultGreeting = urlGreeting || "Hello, this is an AI assistant.";
            // Build system prompt from user profile + purpose (stated once, not duplicated).
            // buildCallPrompt already includes "Call purpose: ..." when purpose is provided.
            const parts = [];
            // For inbound calls (no purpose specified), prepend inbound-specific instructions
            if (!urlPurpose) {
                parts.push("You are answering an inbound phone call. The caller dialed your number.\n" +
                    "Greet them warmly, determine who they are and what they need, and handle\n" +
                    "the conversation according to your context and instructions below.");
            }
            if (this.options.workspacePath) {
                const voiceMemoryDir = path.join(this.options.workspacePath, "voice-memory");
                const profile = (0, user_profile_1.readUserProfile)(voiceMemoryDir);
                if (profile.ownerName || profile.contextBlock) {
                    parts.push((0, user_profile_1.buildCallPrompt)(profile, urlPurpose || undefined));
                }
            }
            // Only add purpose separately if user profile didn't already include it
            if (urlPurpose && parts.length === 0) {
                parts.push(`Call purpose: ${urlPurpose}`);
            }
            if (this.options.voiceSystemPrompt) {
                parts.push(this.options.voiceSystemPrompt);
            }
            const systemPrompt = parts.join("\n\n");
            const autoConfig = {
                callId,
                providerCallId,
                voiceProviderUrl: this.options.voiceProviderUrl ?? "",
                voiceProviderAuth: this.options.voiceProviderAuth ?? "",
                telephonyCodec: "mulaw",
                voiceProviderCodec: "mulaw",
                sampleRate: 8000,
                greeting: defaultGreeting,
                systemPrompt,
                voiceModel: this.options.voiceModel ?? "",
                keepAliveIntervalMs: 5000,
                greetingGracePeriodMs: 3000,
            };
            this.options.bridge.createSession(autoConfig);
            this.options.bridge.startKeepAlive(callId, 5000);
            setTimeout(() => this.options.bridge.endGreetingGrace(callId), 3000).unref?.();
            sessionConfig = this.options.bridge.getSessionConfig(callId);
        }
        if (!sessionConfig) {
            socket.close(1011, "Missing bridge session");
            return;
        }
        // Clone sessionConfig.systemPrompt before enriching to avoid mutating the
        // shared config object (addresses review: systemPrompt mutation in-place).
        let enrichedSystemPrompt = sessionConfig.systemPrompt || "";
        // Enrich systemPrompt with user profile context if workspace is available
        // (for pre-existing sessions that weren't auto-created above)
        if (this.options.workspacePath && !callId.startsWith("auto-")) {
            const voiceMemoryDir = path.join(this.options.workspacePath, "voice-memory");
            const profile = (0, user_profile_1.readUserProfile)(voiceMemoryDir);
            if (profile.ownerName || profile.contextBlock) {
                const profilePrompt = (0, user_profile_1.buildCallPrompt)(profile);
                enrichedSystemPrompt = enrichedSystemPrompt
                    ? `${profilePrompt}\n\n${enrichedSystemPrompt}`
                    : profilePrompt;
            }
        }
        // Create a shallow clone with the enriched prompt so we don't mutate the original config
        const effectiveConfig = { ...sessionConfig, systemPrompt: enrichedSystemPrompt };
        let teardownTriggered = false;
        const teardownFromVoiceProvider = (detail) => {
            if (teardownTriggered) {
                return;
            }
            teardownTriggered = true;
            this.options.bridge.reportDisconnection(callId, "voice_provider_error", detail);
            this.handleClose(socket);
            socket.close(1011, detail);
        };
        // Track whether the voice session has closed so readyState reflects reality.
        // Must be declared before connect() so the onClose callback can capture it.
        let sessionClosed = false;
        let voiceSession;
        try {
            voiceSession = await this.options.voiceProviderClient.connect({
                callId,
                sessionConfig: effectiveConfig,
                buildSettings: (cfg) => this.options.bridge.buildSettingsMessage(cfg),
                onMessage: (voiceMessage) => {
                    const action = this.options.bridge.handleVoiceAgentMessage(callId, voiceMessage);
                    if (action.action !== "audio") {
                        return;
                    }
                    socket.send(JSON.stringify({
                        event: "media",
                        streamSid: message.streamSid ?? "",
                        media: { payload: action.data.toString("base64") },
                    }));
                },
                onClose: (_code, reason) => {
                    sessionClosed = true;
                    if (this.localCloses.delete(socket))
                        return;
                    teardownFromVoiceProvider(reason || "Voice provider stream closed");
                },
                onError: () => {
                    teardownFromVoiceProvider("Voice provider stream error");
                },
            });
        }
        catch {
            this.options.bridge.reportDisconnection(callId, "voice_provider_error", "Voice provider connect failed");
            socket.close(1011, "Voice provider connect failed");
            return;
        }
        if (socket.readyState !== 1) {
            voiceSession.close();
            this.options.bridge.reportDisconnection(callId, "telephony_provider_error", "Twilio media socket closed before voice provider session was attached");
            return;
        }
        const origOnClose = voiceSession.close.bind(voiceSession);
        voiceSession.close = () => {
            sessionClosed = true;
            origOnClose();
        };
        this.options.bridge.setVoiceSocket(callId, {
            send: (data) => {
                if (Buffer.isBuffer(data)) {
                    voiceSession.sendAudio(data);
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.type === "KeepAlive") {
                        voiceSession.sendControl?.(parsed);
                        return;
                    }
                }
                catch {
                    return;
                }
            },
            close: () => voiceSession.close(),
            get readyState() { return sessionClosed ? 3 : 1; },
        });
        this.sessionsBySocket.set(socket, {
            callId,
            streamSid: message.streamSid ?? "",
            voiceSession,
            callerPhone: callerPhone || undefined,
            direction: isInbound ? "inbound" : "outbound",
        });
        this.options.bridge.startHeartbeatMonitor(callId);
    }
    handleMedia(socket, message) {
        const session = this.sessionsBySocket.get(socket);
        if (!session) {
            return;
        }
        if (!message.media?.payload) {
            return;
        }
        const chunk = Buffer.from(message.media.payload, "base64");
        session.voiceSession.sendAudio(chunk);
        this.options.bridge.recordActivity(session.callId);
    }
}
exports.TwilioMediaSessionHandler = TwilioMediaSessionHandler;
TwilioMediaSessionHandler.MAX_COMPLETED = 1000;
