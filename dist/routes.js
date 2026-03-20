"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRoutes = registerRoutes;
const classifier_1 = require("./inbound/classifier");
const verify_1 = require("./webhooks/verify");
function registerRoutes(api, config, onInbound, onInboundText) {
    const router = api.http.router("/clawvoice");
    router.post("/webhooks/telnyx", async (req, response) => {
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
    });
    router.post("/webhooks/twilio/voice", async (req, response) => {
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
                api.log?.error?.("Inbound call received but CLAWVOICE_TWILIO_STREAM_URL is not configured. " +
                    "The caller will hear a generic error. Set this to a public WSS endpoint " +
                    "(e.g. wss://your-tunnel.ngrok-free.dev/media-stream) or run 'clawvoice setup'.");
            }
            sendTwiml(response, buildTwilioVoiceTwiml(config));
            return;
        }
        sendTwiml(response, "<Response><Reject/></Response>");
    });
    router.post("/webhooks/twilio/amd", async (req, response) => {
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
    });
    router.post("/webhooks/twilio/sms", async (req, response) => {
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
    if (config.callMode === "companion") {
        return "<Response><Say>COMPANION_MODE: ClawVoice is in companion mode. Point Twilio Voice webhook to the OpenClaw voice-call inbound webhook.</Say><Hangup/></Response>";
    }
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
