"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceBridgeService = void 0;
const types_1 = require("./types");
const TWILIO_CHUNK_SIZE = 160;
const BUFFER_CHUNKS = 20;
const BUFFER_SIZE = TWILIO_CHUNK_SIZE * BUFFER_CHUNKS;
const HEARTBEAT_TIMEOUT_MS = 15000;
class VoiceBridgeService {
    constructor(config) {
        this.config = config;
        this.bridges = new Map();
        this.sessionConfigs = new Map();
        this.disconnectionHandler = null;
    }
    onDisconnection(handler) {
        this.disconnectionHandler = handler;
    }
    negotiateAndValidate(telephonyCodec = "mulaw", voiceProviderCodec = "mulaw", sampleRate = 8000) {
        return (0, types_1.negotiateCodec)(telephonyCodec, voiceProviderCodec, sampleRate);
    }
    createSession(sessionConfig) {
        const codecResult = this.negotiateAndValidate(sessionConfig.telephonyCodec, sessionConfig.voiceProviderCodec, sessionConfig.sampleRate);
        if (!codecResult.ok) {
            return {
                type: "error",
                callId: sessionConfig.callId,
                timestamp: new Date().toISOString(),
                data: {
                    error: codecResult.error,
                    suggestion: codecResult.suggestion,
                },
            };
        }
        const bridge = {
            callId: sessionConfig.callId,
            providerCallId: sessionConfig.providerCallId,
            codecResult,
            transcript: [],
            keepAliveTimer: null,
            heartbeatTimer: null,
            lastActivityAt: Date.now(),
            greetingGraceActive: true,
            audioBuffer: Buffer.alloc(BUFFER_SIZE),
            audioBufferOffset: 0,
            connected: false,
            startedAt: new Date().toISOString(),
            turnState: "idle",
            pendingFunctionCalls: new Map(),
            disconnectionRecord: null,
            failures: [],
            voiceSocket: null,
        };
        this.bridges.set(sessionConfig.callId, bridge);
        this.sessionConfigs.set(sessionConfig.callId, sessionConfig);
        return {
            type: "connected",
            callId: sessionConfig.callId,
            timestamp: bridge.startedAt,
            data: {
                codec: codecResult.telephonyCodec,
                sampleRate: codecResult.sampleRate,
                voiceModel: sessionConfig.voiceModel,
            },
        };
    }
    buildSettingsMessage(sessionConfig) {
        return {
            type: "Settings",
            audio: {
                input: {
                    encoding: sessionConfig.telephonyCodec === "mulaw" ? "mulaw" : "linear16",
                    sample_rate: sessionConfig.sampleRate,
                },
                output: {
                    encoding: sessionConfig.voiceProviderCodec === "mulaw" ? "mulaw" : "linear16",
                    sample_rate: sessionConfig.sampleRate,
                    container: "none",
                },
            },
            agent: {
                listen: { model: "nova-3" },
                speak: { model: sessionConfig.voiceModel },
                think: {
                    provider: { type: "open_ai" },
                    model: this.config.analysisModel,
                    instructions: sessionConfig.systemPrompt ?? "",
                },
                greeting: { text: sessionConfig.greeting },
            },
        };
    }
    setVoiceSocket(callId, socket) {
        const bridge = this.bridges.get(callId);
        if (bridge) {
            bridge.voiceSocket = socket;
        }
    }
    getSessionConfig(callId) {
        return this.sessionConfigs.get(callId) ?? null;
    }
    getVoiceSocket(callId) {
        return this.bridges.get(callId)?.voiceSocket ?? null;
    }
    startKeepAlive(callId, intervalMs) {
        const bridge = this.bridges.get(callId);
        if (!bridge) {
            return;
        }
        bridge.connected = true;
        if (bridge.keepAliveTimer) {
            clearInterval(bridge.keepAliveTimer);
        }
        bridge.keepAliveTimer = setInterval(() => {
            if (bridge.voiceSocket && bridge.voiceSocket.readyState === 1) {
                bridge.voiceSocket.send(JSON.stringify({ type: "KeepAlive" }));
            }
        }, intervalMs);
        bridge.keepAliveTimer.unref?.();
    }
    recordActivity(callId) {
        const bridge = this.bridges.get(callId);
        if (bridge) {
            bridge.lastActivityAt = Date.now();
        }
    }
    startHeartbeatMonitor(callId, timeoutMs = HEARTBEAT_TIMEOUT_MS) {
        const bridge = this.bridges.get(callId);
        if (!bridge) {
            return;
        }
        this.stopHeartbeatMonitor(callId);
        bridge.lastActivityAt = Date.now();
        const check = () => {
            const b = this.bridges.get(callId);
            if (!b || !b.connected) {
                return;
            }
            const elapsed = Date.now() - b.lastActivityAt;
            if (elapsed >= timeoutMs) {
                this.reportDisconnection(callId, "heartbeat_timeout", `No activity for ${elapsed}ms (threshold: ${timeoutMs}ms)`);
                return;
            }
            b.heartbeatTimer = setTimeout(check, Math.max(timeoutMs - elapsed, 100));
            b.heartbeatTimer.unref?.();
        };
        bridge.heartbeatTimer = setTimeout(check, timeoutMs);
        bridge.heartbeatTimer.unref?.();
    }
    stopHeartbeatMonitor(callId) {
        const bridge = this.bridges.get(callId);
        if (bridge?.heartbeatTimer) {
            clearTimeout(bridge.heartbeatTimer);
            bridge.heartbeatTimer = null;
        }
    }
    reportDisconnection(callId, reason, detail) {
        const bridge = this.bridges.get(callId);
        if (!bridge) {
            return null;
        }
        const startMs = new Date(bridge.startedAt).getTime();
        const record = {
            callId,
            reason,
            detail,
            detectedAt: new Date().toISOString(),
            callDurationMs: Date.now() - startMs,
            transcriptLength: bridge.transcript.length,
        };
        bridge.disconnectionRecord = record;
        bridge.connected = false;
        bridge.failures.push({
            type: "disconnection",
            description: `${reason}: ${detail}`,
            timestamp: new Date().toISOString(),
        });
        this.stopHeartbeatMonitor(callId);
        if (this.disconnectionHandler) {
            this.disconnectionHandler(record);
        }
        return record;
    }
    getDisconnectionRecord(callId) {
        return this.bridges.get(callId)?.disconnectionRecord ?? null;
    }
    endGreetingGrace(callId) {
        const bridge = this.bridges.get(callId);
        if (bridge) {
            bridge.greetingGraceActive = false;
        }
    }
    isGreetingGraceActive(callId) {
        return this.bridges.get(callId)?.greetingGraceActive ?? false;
    }
    bufferTelephonyAudio(callId, chunk) {
        const bridge = this.bridges.get(callId);
        if (!bridge) {
            return null;
        }
        bridge.lastActivityAt = Date.now();
        const remaining = BUFFER_SIZE - bridge.audioBufferOffset;
        const toCopy = Math.min(chunk.length, remaining);
        chunk.copy(bridge.audioBuffer, bridge.audioBufferOffset, 0, toCopy);
        bridge.audioBufferOffset += toCopy;
        if (bridge.audioBufferOffset >= BUFFER_SIZE) {
            const flushed = Buffer.from(bridge.audioBuffer.subarray(0, BUFFER_SIZE));
            bridge.audioBufferOffset = 0;
            return flushed;
        }
        return null;
    }
    flushAudioBuffer(callId) {
        const bridge = this.bridges.get(callId);
        if (!bridge || bridge.audioBufferOffset === 0) {
            return null;
        }
        const flushed = Buffer.from(bridge.audioBuffer.subarray(0, bridge.audioBufferOffset));
        bridge.audioBufferOffset = 0;
        return flushed;
    }
    addTranscriptEntry(callId, entry) {
        const bridge = this.bridges.get(callId);
        if (bridge) {
            bridge.transcript.push(entry);
        }
    }
    getTranscript(callId) {
        return this.bridges.get(callId)?.transcript ?? [];
    }
    destroySession(callId) {
        const bridge = this.bridges.get(callId);
        if (bridge?.keepAliveTimer) {
            clearInterval(bridge.keepAliveTimer);
        }
        if (bridge?.heartbeatTimer) {
            clearTimeout(bridge.heartbeatTimer);
        }
        if (bridge?.voiceSocket) {
            try {
                bridge.voiceSocket.close();
            }
            catch { /* ignore */ }
        }
        this.bridges.delete(callId);
        this.sessionConfigs.delete(callId);
        return {
            type: "disconnected",
            callId,
            timestamp: new Date().toISOString(),
            data: {
                transcriptLength: bridge?.transcript.length ?? 0,
            },
        };
    }
    handleVoiceAgentMessage(callId, message) {
        const bridge = this.bridges.get(callId);
        if (!bridge) {
            return { action: "none" };
        }
        bridge.lastActivityAt = Date.now();
        const msgType = message.type;
        switch (msgType) {
            case "SettingsApplied":
                bridge.connected = true;
                return { action: "settings_applied" };
            case "UserStartedSpeaking":
                return this.handleBargeIn(callId);
            case "AgentStartedSpeaking":
                bridge.turnState = "agent_speaking";
                return { action: "turn_change", state: "agent_speaking" };
            case "ConversationText": {
                const role = message.role;
                const content = message.content;
                if (role && content) {
                    const speaker = role === "user" ? "user" : "agent";
                    const entry = {
                        speaker,
                        text: content,
                        timestamp: new Date().toISOString(),
                    };
                    bridge.transcript.push(entry);
                    return { action: "transcript", entry };
                }
                return { action: "none" };
            }
            case "Audio": {
                const payload = message.data;
                if (Buffer.isBuffer(payload)) {
                    return { action: "audio", data: payload };
                }
                if (typeof payload === "string") {
                    return { action: "audio", data: Buffer.from(payload, "base64") };
                }
                return { action: "none" };
            }
            case "AgentAudio": {
                const payload = message.data;
                if (Buffer.isBuffer(payload)) {
                    return { action: "audio", data: payload };
                }
                if (typeof payload === "string") {
                    return { action: "audio", data: Buffer.from(payload, "base64") };
                }
                return { action: "none" };
            }
            case "FunctionCallRequest": {
                const fcReq = {
                    id: message.function_call_id,
                    name: message.function_name,
                    input: message.input ?? {},
                };
                // L4: Check function name against denied tools list
                if (this.config.restrictTools && this.config.deniedTools.includes(fcReq.name)) {
                    return {
                        action: "function_call_denied",
                        request: fcReq,
                        reason: `Function "${fcReq.name}" is denied by restrictTools policy`,
                    };
                }
                bridge.pendingFunctionCalls.set(fcReq.id, fcReq);
                return { action: "function_call", request: fcReq };
            }
            case "Error": {
                const errorMsg = message.message ?? "Unknown voice agent error";
                const record = this.reportDisconnection(callId, "voice_provider_error", errorMsg);
                if (record) {
                    return { action: "disconnection", record };
                }
                return { action: "error", error: errorMsg };
            }
            default:
                return { action: "none" };
        }
    }
    handleBargeIn(callId) {
        const bridge = this.bridges.get(callId);
        if (!bridge) {
            return { action: "none" };
        }
        const duringGrace = bridge.greetingGraceActive;
        bridge.turnState = "user_speaking";
        return { action: "barge_in", duringGrace };
    }
    completeFunctionCall(callId, response) {
        const bridge = this.bridges.get(callId);
        if (!bridge) {
            return false;
        }
        bridge.pendingFunctionCalls.delete(response.id);
        return true;
    }
    getTurnState(callId) {
        return this.bridges.get(callId)?.turnState ?? "idle";
    }
    setTurnState(callId, state) {
        const bridge = this.bridges.get(callId);
        if (bridge) {
            bridge.turnState = state;
        }
    }
    getPendingFunctionCalls(callId) {
        const bridge = this.bridges.get(callId);
        if (!bridge) {
            return [];
        }
        return Array.from(bridge.pendingFunctionCalls.values());
    }
    recordFailure(callId, failure) {
        const bridge = this.bridges.get(callId);
        if (bridge) {
            bridge.failures.push(failure);
        }
    }
    getFailures(callId) {
        return this.bridges.get(callId)?.failures ?? [];
    }
    generateCallSummary(callId) {
        const bridge = this.bridges.get(callId);
        if (!bridge) {
            return null;
        }
        const startMs = new Date(bridge.startedAt).getTime();
        const durationMs = Date.now() - startMs;
        const pendingActions = Array.from(bridge.pendingFunctionCalls.values()).map((fc) => `${fc.name}(${JSON.stringify(fc.input)})`);
        const outcome = this.determineOutcome(bridge);
        const retryContext = outcome !== "completed"
            ? this.buildRetryContext(bridge, pendingActions)
            : null;
        return {
            callId,
            outcome,
            durationMs,
            transcriptLength: bridge.transcript.length,
            failures: [...bridge.failures],
            pendingActions,
            retryContext,
            completedAt: new Date().toISOString(),
        };
    }
    determineOutcome(bridge) {
        if (bridge.failures.length === 0 && bridge.pendingFunctionCalls.size === 0) {
            return "completed";
        }
        const hasHardFailure = bridge.failures.some((f) => f.type === "disconnection" || f.type === "timeout");
        if (hasHardFailure || bridge.transcript.length === 0) {
            return "failed";
        }
        return "partial";
    }
    buildRetryContext(bridge, pendingActions) {
        const failureReasons = bridge.failures.map((f) => f.description);
        if (bridge.disconnectionRecord) {
            failureReasons.push(`Disconnected: ${bridge.disconnectionRecord.reason} — ${bridge.disconnectionRecord.detail}`);
        }
        const lastEntries = bridge.transcript.slice(-3);
        const previousTranscriptSummary = lastEntries.length > 0
            ? lastEntries.map((e) => `${e.speaker}: ${e.text}`).join(" | ")
            : "No transcript recorded.";
        const suggestedApproach = pendingActions.length > 0
            ? `Retry with pending actions: ${pendingActions.join(", ")}`
            : failureReasons.length > 0
                ? `Address failures: ${failureReasons.join("; ")}`
                : "Retry call with same parameters.";
        return {
            originalCallId: bridge.callId,
            failureReasons,
            uncompletedActions: pendingActions,
            previousTranscriptSummary,
            suggestedApproach,
        };
    }
    getActiveBridgeCount() {
        return this.bridges.size;
    }
    hasActiveBridge(callId) {
        return this.bridges.has(callId);
    }
    async stopAll() {
        for (const callId of Array.from(this.bridges.keys())) {
            this.destroySession(callId);
        }
    }
}
exports.VoiceBridgeService = VoiceBridgeService;
