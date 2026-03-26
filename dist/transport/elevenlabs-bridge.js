"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElevenLabsBridgeClient = void 0;
const ws_1 = __importDefault(require("ws"));
const audio_convert_1 = require("./audio-convert");
const OPEN_SOCKET = 1;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
class ElevenLabsBridgeClient {
    constructor(options) {
        this.apiKey = options.apiKey;
        this.connectTimeoutMs =
            typeof options.connectTimeoutMs === "number" && options.connectTimeoutMs > 0
                ? options.connectTimeoutMs
                : DEFAULT_CONNECT_TIMEOUT_MS;
        this.webSocketFactory =
            options.webSocketFactory ??
                ((url, apiKey) => new ws_1.default(url, { headers: { "xi-api-key": apiKey } }));
    }
    async connect(options) {
        const { callId, sessionConfig, onMessage, onClose, onError } = options;
        const ws = this.webSocketFactory(sessionConfig.voiceProviderUrl, this.apiKey);
        return new Promise((resolve, reject) => {
            let opened = false;
            let settled = false;
            let parseErrorReported = false;
            const fail = (error) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(connectTimeout);
                reject(error);
            };
            const succeed = (session) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(connectTimeout);
                resolve(session);
            };
            const connectTimeout = setTimeout(() => {
                const timeoutError = new Error(`ElevenLabs WS connect timeout for callId=${callId}`);
                onError?.(timeoutError);
                try {
                    ws.close();
                }
                catch { /* noop */ }
                fail(timeoutError);
            }, this.connectTimeoutMs);
            ws.on("open", () => {
                opened = true;
                // MUST send conversation_initiation_client_data immediately after open.
                // Without this, ElevenLabs ignores all incoming audio.
                // NOTE: Do NOT include prompt overrides in conversation_config_override —
                // the ElevenLabs agent config may disallow them. Instead, pass context
                // via dynamic_variables which the agent prompt uses as {{ var_name }}.
                const initMessage = {
                    type: "conversation_initiation_client_data",
                    conversation_config_override: {
                        stt: {
                            user_input_audio_format: "ulaw_8000",
                        },
                    },
                };
                // Pass call context as dynamic variables for the agent prompt to use.
                // The ElevenLabs agent prompt uses {{ _system_prompt_ }} placeholder.
                // All overrides (prompt, first_message, llm) are locked — only
                // dynamic_variables can inject per-call context.
                const dynamicVars = {};
                if (sessionConfig.systemPrompt) {
                    dynamicVars._system_prompt_ = sessionConfig.systemPrompt;
                }
                if (Object.keys(dynamicVars).length > 0) {
                    initMessage.dynamic_variables = dynamicVars;
                }
                ws.send(JSON.stringify(initMessage));
                succeed({
                    sendAudio(chunk) {
                        if (ws.readyState !== OPEN_SOCKET)
                            return;
                        // Send raw Twilio mulaw — we declare ulaw_8000 input format in the init message
                        ws.send(JSON.stringify({
                            user_audio_chunk: chunk.toString("base64"),
                        }));
                    },
                    sendControl(message) {
                        if (ws.readyState !== OPEN_SOCKET)
                            return;
                        if (message.type === "KeepAlive") {
                            ws.send(JSON.stringify({ type: "user_activity" }));
                            return;
                        }
                        if (message.type === "client_tool_result") {
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
                if (!text)
                    return;
                let raw;
                try {
                    raw = JSON.parse(text);
                }
                catch {
                    if (!parseErrorReported) {
                        parseErrorReported = true;
                        onError?.(new Error(`Invalid ElevenLabs message JSON for callId=${callId}`));
                    }
                    return;
                }
                if (raw.type === "ping") {
                    const pingEvent = raw.ping_event;
                    const eventId = pingEvent?.event_id ?? raw.event_id;
                    ws.send(JSON.stringify({ type: "pong", event_id: eventId }));
                    return;
                }
                const normalized = normalizeMessage(raw);
                if (normalized) {
                    onMessage(normalized);
                }
            });
            ws.on("error", (error) => {
                onError?.(error);
                if (!opened)
                    fail(error);
            });
            ws.on("close", (code, reason) => {
                const closeCode = typeof code === "number" ? code : 1000;
                const closeReason = typeof reason === "string"
                    ? reason
                    : Buffer.isBuffer(reason)
                        ? reason.toString("utf8")
                        : "";
                onClose?.(closeCode, closeReason);
                if (!opened) {
                    fail(new Error(`ElevenLabs stream closed before open for callId=${callId}`));
                }
            });
        });
    }
}
exports.ElevenLabsBridgeClient = ElevenLabsBridgeClient;
/**
 * Normalize ElevenLabs Conversational AI messages to the format
 * VoiceBridgeService.handleVoiceAgentMessage() expects.
 * Returns null for unrecognized message types.
 */
function normalizeMessage(raw) {
    // ElevenLabs Conversational AI messages use top-level event keys
    // (e.g. "audio_event", "user_transcription_event") rather than a "type" field.
    const type = raw.type
        ?? (raw.audio_event ? "audio" : undefined)
        ?? (raw.conversation_initiation_metadata_event ? "conversation_initiation_metadata" : undefined)
        ?? (raw.user_transcription_event ? "user_transcript" : undefined)
        ?? (raw.agent_response_event ? "agent_response" : undefined)
        ?? (raw.client_tool_call ? "client_tool_call" : undefined)
        ?? (raw.ping_event ? "ping" : undefined)
        ?? (raw.interruption ? "interruption" : undefined);
    switch (type) {
        case "conversation_initiation_metadata":
            return { type: "SettingsApplied" };
        case "audio": {
            const audioEvent = raw.audio_event;
            const audioBase64 = audioEvent?.audio_base_64;
            if (!audioBase64)
                return null;
            try {
                // ElevenLabs Conversational AI sends PCM 16-bit at 16kHz → mulaw 8kHz for Twilio
                const pcm16k = Buffer.from(audioBase64, "base64");
                const mulawBuffer = (0, audio_convert_1.elevenLabsToTwilio)(pcm16k);
                return { type: "Audio", data: mulawBuffer };
            }
            catch {
                return null; // skip malformed audio frames
            }
        }
        case "user_transcript": {
            const transcript = raw.user_transcription_event;
            return { type: "ConversationText", role: "user", content: transcript?.user_transcript ?? "" };
        }
        case "agent_response": {
            const response = raw.agent_response_event;
            return { type: "ConversationText", role: "agent", content: response?.agent_response ?? "" };
        }
        case "interruption":
            return { type: "UserStartedSpeaking" };
        case "agent_response_correction":
            return null;
        case "client_tool_call": {
            const toolCallId = raw.tool_call_id ?? raw.client_tool_call_id ?? "";
            const toolName = raw.tool_name ?? "";
            const parameters = raw.parameters ?? {};
            return {
                type: "FunctionCallRequest",
                function_call_id: toolCallId,
                function_name: toolName,
                input: parameters,
            };
        }
        default:
            return null;
    }
}
