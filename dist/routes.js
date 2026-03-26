"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebhookHandlers = createWebhookHandlers;
exports.registerRoutes = registerRoutes;
exports.registerStandaloneWebhookRoutes = registerStandaloneWebhookRoutes;
const classifier_1 = require("./inbound/classifier");
const verify_1 = require("./webhooks/verify");
/**
 * Core webhook handler logic, shared between OpenClaw API registration and standalone server.
 */
function createWebhookHandlers(config, callbacks, logError) {
    const { onInbound, onInboundText, onRecording } = callbacks;
    const handleTelnyxWebhook = async (req, response) => {
        const request = req;
        const body = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? "");
        const result = (0, verify_1.verifyTelnyxSignature)(body, request.headers?.["telnyx-signature-ed25519"], request.headers?.["telnyx-timestamp"], config.telnyxWebhookSecret);
        if (!result.valid) {
            response.status(401).json({ error: "Unauthorized", reason: result.reason });
            return;
        }
        const inboundText = parseTelnyxSmsBody(request.body);
        if (config.inboundEnabled && inboundText) {
            onInboundText?.(inboundText.from, inboundText.to, inboundText.body, inboundText.messageId);
            response.status(200).json({ ok: true });
            return;
        }
        if (config.inboundEnabled) {
            const parsed = parseWebhookBody(request.body);
            if (parsed) {
                const event = (0, classifier_1.classifyInboundEvent)(parsed.providerCallId, parsed.from, parsed.to, "telnyx", parsed.amdResult);
                const decision = (0, classifier_1.decideInboundAction)(event, config);
                const record = (0, classifier_1.buildInboundRecord)(event, decision);
                onInbound?.(record);
            }
        }
        response.status(200).json({ ok: true });
    };
    const handleTwilioVoice = async (req, response) => {
        const request = req;
        const url = buildPublicUrl(request);
        const params = typeof request.body === "object" && request.body !== null ? request.body : {};
        const result = (0, verify_1.verifyTwilioSignature)(url, params, request.headers?.["x-twilio-signature"], config.twilioAuthToken);
        if (!result.valid) {
            response.status(401).json({ error: "Unauthorized", reason: result.reason });
            return;
        }
        if (config.inboundEnabled) {
            const parsed = parseWebhookBody(request.body);
            if (parsed) {
                const event = (0, classifier_1.classifyInboundEvent)(parsed.providerCallId, parsed.from, parsed.to, "twilio", parsed.amdResult);
                const decision = (0, classifier_1.decideInboundAction)(event, config);
                const record = (0, classifier_1.buildInboundRecord)(event, decision);
                onInbound?.(record);
            }
            if (!config.twilioStreamUrl?.trim()) {
                const maskPhone = (num) => num.length > 4 ? num.slice(0, -4).replace(/./g, "*") + num.slice(-4) : "****";
                const from = params["From"] ? maskPhone(params["From"]) : "unknown";
                const to = params["To"] ? maskPhone(params["To"]) : "unknown";
                const callSid = params["CallSid"] || "unknown";
                logError?.(`Inbound call received but CLAWVOICE_TWILIO_STREAM_URL is not configured. ` +
                    `From: ${from}, To: ${to}, CallSid: ${callSid}. ` +
                    `The caller will hear a generic error. Set this to a public WSS endpoint ` +
                    `(e.g. wss://your-tunnel.ngrok-free.dev/media-stream) or run 'clawvoice setup'.`);
            }
            sendTwiml(response, buildTwilioVoiceTwiml(config));
            return;
        }
        sendTwiml(response, "<Response><Reject/></Response>");
    };
    const handleTwilioAmd = async (req, response) => {
        const request = req;
        const url = buildPublicUrl(request);
        const params = typeof request.body === "object" && request.body !== null ? request.body : {};
        const result = (0, verify_1.verifyTwilioSignature)(url, params, request.headers?.["x-twilio-signature"], config.twilioAuthToken);
        if (!result.valid) {
            response.status(401).json({ error: "Unauthorized", reason: result.reason });
            return;
        }
        const amdStatus = typeof params.AnsweredBy === "string" ? params.AnsweredBy : undefined;
        const callSid = typeof params.CallSid === "string" ? params.CallSid : "unknown";
        const amdResult = amdStatus === "human" ? "human"
            : amdStatus === "machine_start" ? "machine_start"
                : amdStatus === "fax" ? "fax"
                    : "unknown";
        if (config.inboundEnabled) {
            const event = (0, classifier_1.classifyInboundEvent)(callSid, typeof params.From === "string" ? params.From : "", typeof params.To === "string" ? params.To : "", "twilio", amdResult);
            const decision = (0, classifier_1.decideInboundAction)(event, config);
            const record = (0, classifier_1.buildInboundRecord)(event, decision);
            onInbound?.(record);
        }
        response.status(200).json({ ok: true });
    };
    const handleTwilioSms = async (req, response) => {
        const request = req;
        const url = buildPublicUrl(request);
        const params = typeof request.body === "object" && request.body !== null ? request.body : {};
        const result = (0, verify_1.verifyTwilioSignature)(url, params, request.headers?.["x-twilio-signature"], config.twilioAuthToken);
        if (!result.valid) {
            response.status(401).json({ error: "Unauthorized", reason: result.reason });
            return;
        }
        const from = typeof params.From === "string" ? params.From : "";
        const to = typeof params.To === "string" ? params.To : "";
        const body = typeof params.Body === "string" ? params.Body : "";
        const messageId = typeof params.MessageSid === "string" ? params.MessageSid : undefined;
        if (from && body) {
            onInboundText?.(from, to, body, messageId);
        }
        sendTwiml(response, "<Response></Response>");
    };
    const handleTwilioRecording = async (req, response) => {
        const request = req;
        const url = buildPublicUrl(request);
        const params = typeof request.body === "object" && request.body !== null ? request.body : {};
        const result = (0, verify_1.verifyTwilioSignature)(url, params, request.headers?.["x-twilio-signature"], config.twilioAuthToken);
        if (!result.valid) {
            response.status(401).json({ error: "Unauthorized", reason: result.reason });
            return;
        }
        const callSid = typeof params.CallSid === "string" ? params.CallSid : "";
        const recordingUrl = typeof params.RecordingUrl === "string" ? params.RecordingUrl : "";
        if (callSid && recordingUrl && onRecording) {
            onRecording(callSid, recordingUrl);
        }
        response.status(200).json({ ok: true });
    };
    return { handleTelnyxWebhook, handleTwilioVoice, handleTwilioAmd, handleTwilioSms, handleTwilioRecording };
}
/**
 * Register webhook routes on the OpenClaw API router (legacy path).
 */
function registerRoutes(api, config, onInbound, onInboundText, onRecording) {
    const router = api.http.router("/clawvoice");
    // Resolve a logger for error reporting
    const rawApi = api;
    const routeLog = (api.log && typeof api.log.error === "function") ? api.log
        : (rawApi.logger && typeof rawApi.logger.error === "function") ? rawApi.logger
            : undefined;
    const handlers = createWebhookHandlers(config, { onInbound, onInboundText, onRecording }, (msg) => routeLog?.error?.(msg));
    router.post("/webhooks/telnyx", async (req, response) => {
        await handlers.handleTelnyxWebhook(req, response);
    });
    router.post("/webhooks/twilio/voice", async (req, response) => {
        await handlers.handleTwilioVoice(req, response);
    });
    router.post("/webhooks/twilio/amd", async (req, response) => {
        await handlers.handleTwilioAmd(req, response);
    });
    router.post("/webhooks/twilio/sms", async (req, response) => {
        await handlers.handleTwilioSms(req, response);
    });
    router.post("/webhooks/twilio/recording", async (req, response) => {
        await handlers.handleTwilioRecording(req, response);
    });
}
/**
 * Register webhook routes on the standalone MediaStreamServer.
 * This allows webhooks to work even when the OpenClaw gateway doesn't
 * dispatch plugin-registered routes correctly.
 */
function registerStandaloneWebhookRoutes(server, config, callbacks) {
    const handlers = createWebhookHandlers(config, callbacks, (msg) => console.error(`[clawvoice]`, msg));
    server.registerHttpRoute("POST", "/clawvoice/webhooks/telnyx", async (req, res) => {
        await handlers.handleTelnyxWebhook(req, res);
    });
    server.registerHttpRoute("POST", "/clawvoice/webhooks/twilio/voice", async (req, res) => {
        await handlers.handleTwilioVoice(req, res);
    });
    server.registerHttpRoute("POST", "/clawvoice/webhooks/twilio/amd", async (req, res) => {
        await handlers.handleTwilioAmd(req, res);
    });
    server.registerHttpRoute("POST", "/clawvoice/webhooks/twilio/sms", async (req, res) => {
        await handlers.handleTwilioSms(req, res);
    });
    server.registerHttpRoute("POST", "/clawvoice/webhooks/twilio/recording", async (req, res) => {
        await handlers.handleTwilioRecording(req, res);
    });
}
function buildPublicUrl(request) {
    const forwardedProto = request.headers?.["x-forwarded-proto"]?.split(",")[0]?.trim();
    const forwardedHost = request.headers?.["x-forwarded-host"]?.split(",")[0]?.trim();
    const protocol = forwardedProto || request.protocol || "https";
    const host = forwardedHost || request.headers?.host || "localhost";
    const urlPath = request.url ?? "/";
    return `${protocol}://${host}${urlPath}`;
}
function sendTwiml(response, twiml) {
    const twimlResponse = response;
    const statusResult = twimlResponse.status(200);
    if (twimlResponse.type && typeof twimlResponse.type === "function") {
        const typed = twimlResponse.type("text/xml");
        if (typed.send && typeof typed.send === "function") {
            typed.send(twiml);
            return;
        }
    }
    if (twimlResponse.send && typeof twimlResponse.send === "function") {
        twimlResponse.send(twiml);
        return;
    }
    if (twimlResponse.json && typeof twimlResponse.json === "function") {
        twimlResponse.json({ ok: true });
        return;
    }
    void statusResult;
}
function buildTwilioVoiceTwiml(config) {
    const streamUrl = config.twilioStreamUrl?.trim();
    if (!streamUrl) {
        return "<Response><Say>We're sorry, this call cannot be completed at this time.</Say><Hangup/></Response>";
    }
    return `<Response><Connect><Stream url="${streamUrl}" track="inbound_track" /></Connect></Response>`;
}
function parseWebhookBody(body) {
    if (typeof body !== "object" || body === null) {
        return null;
    }
    const b = body;
    const providerCallId = typeof b.CallSid === "string" ? b.CallSid
        : typeof b.call_control_id === "string" ? b.call_control_id
            : undefined;
    if (!providerCallId) {
        return null;
    }
    const from = typeof b.From === "string" ? b.From
        : typeof b.from === "string" ? b.from
            : "";
    const to = typeof b.To === "string" ? b.To
        : typeof b.to === "string" ? b.to
            : "";
    return { providerCallId, from, to };
}
function parseTelnyxSmsBody(body) {
    if (typeof body !== "object" || body === null) {
        return null;
    }
    const root = body;
    if (root.event_type !== "message.received") {
        return null;
    }
    const data = root.data;
    if (typeof data !== "object" || data === null) {
        return null;
    }
    const payload = data.payload;
    if (typeof payload !== "object" || payload === null) {
        return null;
    }
    const sms = payload;
    const from = typeof sms.from === "object" && sms.from !== null
        ? sms.from.phone_number
        : undefined;
    const to = typeof sms.to === "object" && sms.to !== null
        ? sms.to.phone_number
        : undefined;
    const text = typeof sms.text === "string" ? sms.text : "";
    const id = typeof sms.id === "string" ? sms.id : undefined;
    if (!from || text.trim().length === 0) {
        return null;
    }
    return {
        from,
        to: to ?? "",
        body: text,
        messageId: id,
    };
}
