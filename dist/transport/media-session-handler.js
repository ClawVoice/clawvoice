"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwilioMediaSessionHandler = void 0;
class TwilioMediaSessionHandler {
    constructor(options) {
        this.options = options;
        this.sessionsBySocket = new Map();
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
        session.deepgram.close();
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
        let teardownTriggered = false;
        const teardownFromDeepgram = (detail) => {
            if (teardownTriggered) {
                return;
            }
            teardownTriggered = true;
            this.options.bridge.reportDisconnection(callId, "voice_provider_error", detail);
            this.handleClose(socket);
            socket.close(1011, detail);
        };
        let deepgramSession;
        try {
            deepgramSession = await this.options.deepgramClient.connect({
                callId,
                settings: this.options.bridge.buildSettingsMessage(sessionConfig),
                onMessage: (deepgramMessage) => {
                    const action = this.options.bridge.handleVoiceAgentMessage(callId, deepgramMessage);
                    if (action.action !== "audio") {
                        return;
                    }
                    socket.send(JSON.stringify({
                        event: "media",
                        streamSid: message.streamSid ?? "",
                        media: { payload: action.data.toString("base64") },
                    }));
                },
                onClose: () => {
                    teardownFromDeepgram("Deepgram stream closed");
                },
                onError: () => {
                    teardownFromDeepgram("Deepgram stream error");
                },
            });
        }
        catch {
            this.options.bridge.reportDisconnection(callId, "voice_provider_error", "Deepgram connect failed");
            socket.close(1011, "Deepgram connect failed");
            return;
        }
        if (socket.readyState !== 1) {
            deepgramSession.close();
            this.options.bridge.reportDisconnection(callId, "telephony_provider_error", "Twilio media socket closed before Deepgram session was attached");
            return;
        }
        this.options.bridge.setVoiceSocket(callId, {
            send: (data) => {
                if (Buffer.isBuffer(data)) {
                    deepgramSession.sendAudio(data);
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.type === "KeepAlive") {
                        deepgramSession.sendControl?.(parsed);
                        return;
                    }
                }
                catch {
                    return;
                }
            },
            close: () => deepgramSession.close(),
            readyState: 1,
        });
        this.sessionsBySocket.set(socket, {
            callId,
            streamSid: message.streamSid ?? "",
            deepgram: deepgramSession,
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
        session.deepgram.sendAudio(chunk);
        this.options.bridge.recordActivity(session.callId);
    }
}
exports.TwilioMediaSessionHandler = TwilioMediaSessionHandler;
