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
const user_profile_1 = require("../services/user-profile");
const path = __importStar(require("path"));
class TwilioMediaSessionHandler {
    constructor(options) {
        this.options = options;
        this.sessionsBySocket = new Map();
        this.localCloses = new Set();
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
        const callId = this.options.resolveCallIdByProviderCallId(providerCallId);
        if (!callId) {
            socket.close(1008, "Unknown callSid");
            return;
        }
        const sessionConfig = this.options.bridge.getSessionConfig(callId);
        if (!sessionConfig) {
            socket.close(1011, "Missing bridge session");
            return;
        }
        // Enrich systemPrompt with user profile context if workspace is available
        if (this.options.workspacePath) {
            const voiceMemoryDir = path.join(this.options.workspacePath, "voice-memory");
            const profile = (0, user_profile_1.readUserProfile)(voiceMemoryDir);
            if (profile.ownerName || profile.contextBlock) {
                const profilePrompt = (0, user_profile_1.buildCallPrompt)(profile);
                const existing = sessionConfig.systemPrompt || "";
                sessionConfig.systemPrompt = existing
                    ? `${profilePrompt}\n\n${existing}`
                    : profilePrompt;
            }
        }
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
        let voiceSession;
        try {
            voiceSession = await this.options.voiceProviderClient.connect({
                callId,
                sessionConfig,
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
            readyState: 1,
        });
        this.sessionsBySocket.set(socket, {
            callId,
            streamSid: message.streamSid ?? "",
            voiceSession,
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
