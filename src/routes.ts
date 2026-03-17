import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import {
  classifyInboundEvent,
  decideInboundAction,
  buildInboundRecord,
} from "./inbound/classifier";
import { AmdResult, InboundCallRecord } from "./inbound/types";
import { verifyTelnyxSignature, verifyTwilioSignature } from "./webhooks/verify";

interface WebhookRequest {
  body?: unknown;
  headers?: Record<string, string>;
  protocol?: string;
  url?: string;
}

type InboundHandler = (record: InboundCallRecord) => void;
type InboundTextHandler = (from: string, to: string, body: string, messageId?: string) => void;

export function registerRoutes(
  api: PluginAPI,
  config: ClawVoiceConfig,
  onInbound?: InboundHandler,
  onInboundText?: InboundTextHandler,
): void {
  const router = api.http.router("/clawvoice");

  router.post("/webhooks/telnyx", async (req, response) => {
    const request = req as WebhookRequest;
    const body = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? "");
    const result = verifyTelnyxSignature(
      body,
      request.headers?.["telnyx-signature-ed25519"],
      request.headers?.["telnyx-timestamp"],
      config.telnyxWebhookSecret,
    );
    if (!result.valid) {
      response.status(401).json({ error: "Unauthorized", reason: result.reason });
      return;
    }

    const inboundText = parseTelnyxSmsBody(request.body);
    if (config.inboundEnabled && inboundText) {
      onInboundText?.(
        inboundText.from,
        inboundText.to,
        inboundText.body,
        inboundText.messageId,
      );
      response.status(200).json({ ok: true });
      return;
    }

    if (config.inboundEnabled) {
      const parsed = parseWebhookBody(request.body);
      if (parsed) {
        const event = classifyInboundEvent(
          parsed.providerCallId,
          parsed.from,
          parsed.to,
          "telnyx",
          parsed.amdResult,
        );
        const decision = decideInboundAction(event, config);
        const record = buildInboundRecord(event, decision);
        onInbound?.(record);
      }
    }

    response.status(200).json({ ok: true });
  });

  router.post("/webhooks/twilio/voice", async (req, response) => {
    const request = req as WebhookRequest;
    const url = buildPublicUrl(request);
    const params = typeof request.body === "object" && request.body !== null ? request.body as Record<string, string> : {};
    const result = verifyTwilioSignature(
      url,
      params,
      request.headers?.["x-twilio-signature"],
      config.twilioAuthToken,
    );
    if (!result.valid) {
      response.status(401).json({ error: "Unauthorized", reason: result.reason });
      return;
    }

    if (config.inboundEnabled) {
      const parsed = parseWebhookBody(request.body);
      if (parsed) {
        const event = classifyInboundEvent(
          parsed.providerCallId,
          parsed.from,
          parsed.to,
          "twilio",
          parsed.amdResult,
        );
        const decision = decideInboundAction(event, config);
        const record = buildInboundRecord(event, decision);
        onInbound?.(record);
      }
      sendTwiml(response, buildTwilioVoiceTwiml(config));
      return;
    }

    sendTwiml(response, "<Response><Reject/></Response>");
  });

  router.post("/webhooks/twilio/amd", async (req, response) => {
    const request = req as WebhookRequest;
    const url = buildPublicUrl(request);
    const params = typeof request.body === "object" && request.body !== null ? request.body as Record<string, string> : {};
    const result = verifyTwilioSignature(
      url,
      params,
      request.headers?.["x-twilio-signature"],
      config.twilioAuthToken,
    );
    if (!result.valid) {
      response.status(401).json({ error: "Unauthorized", reason: result.reason });
      return;
    }

    const amdStatus = typeof params.AnsweredBy === "string" ? params.AnsweredBy : undefined;
    const callSid = typeof params.CallSid === "string" ? params.CallSid : "unknown";
    const amdResult: AmdResult = amdStatus === "human" ? "human"
      : amdStatus === "machine_start" ? "machine_start"
      : amdStatus === "fax" ? "fax"
      : "unknown";

    if (config.inboundEnabled) {
      const event = classifyInboundEvent(
        callSid,
        typeof params.From === "string" ? params.From : "",
        typeof params.To === "string" ? params.To : "",
        "twilio",
        amdResult,
      );
      const decision = decideInboundAction(event, config);
      const record = buildInboundRecord(event, decision);
      onInbound?.(record);
    }

    response.status(200).json({ ok: true });
  });

  router.post("/webhooks/twilio/sms", async (req, response) => {
    const request = req as WebhookRequest;
    const url = buildPublicUrl(request);
    const params = typeof request.body === "object" && request.body !== null ? request.body as Record<string, string> : {};
    const result = verifyTwilioSignature(
      url,
      params,
      request.headers?.["x-twilio-signature"],
      config.twilioAuthToken,
    );
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

function buildPublicUrl(request: WebhookRequest): string {
  const forwardedProto = request.headers?.["x-forwarded-proto"]?.split(",")[0]?.trim();
  const forwardedHost = request.headers?.["x-forwarded-host"]?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.protocol || "https";
  const host = forwardedHost || request.headers?.host || "localhost";
  const urlPath = request.url ?? "/";
  return `${protocol}://${host}${urlPath}`;
}

function sendTwiml(response: unknown, twiml: string): void {
  const twimlResponse = response as {
    status(code: number): unknown;
    type?: (contentType: string) => { send?: (payload: string) => void };
    send?: (payload: string) => void;
    json?: (payload: unknown) => void;
  };

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

function buildTwilioVoiceTwiml(config: ClawVoiceConfig): string {
  if (config.callMode === "companion") {
    return "<Response><Say>ClawVoice is in companion mode. Enable the OpenClaw voice-call plugin for live voice calls.</Say><Reject/></Response>";
  }

  const streamUrl = config.twilioStreamUrl?.trim();
  if (!streamUrl) {
    return "<Response><Say>Voice stream URL is not configured.</Say><Hangup/></Response>";
  }
  return `<Response><Connect><Stream url="${streamUrl}" track="both_tracks" /></Connect></Response>`;
}

interface ParsedWebhookBody {
  providerCallId: string;
  from: string;
  to: string;
  amdResult?: AmdResult;
}

interface ParsedTelnyxSmsBody {
  from: string;
  to: string;
  body: string;
  messageId?: string;
}

function parseWebhookBody(body: unknown): ParsedWebhookBody | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const b = body as Record<string, unknown>;

  const providerCallId =
    typeof b.CallSid === "string" ? b.CallSid
    : typeof b.call_control_id === "string" ? b.call_control_id
    : undefined;

  if (!providerCallId) {
    return null;
  }

  const from =
    typeof b.From === "string" ? b.From
    : typeof b.from === "string" ? b.from
    : "";

  const to =
    typeof b.To === "string" ? b.To
    : typeof b.to === "string" ? b.to
    : "";

  return { providerCallId, from, to };
}

function parseTelnyxSmsBody(body: unknown): ParsedTelnyxSmsBody | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const root = body as Record<string, unknown>;
  if (root.event_type !== "message.received") {
    return null;
  }

  const data = root.data;
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const payload = (data as Record<string, unknown>).payload;
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const sms = payload as Record<string, unknown>;
  const from = typeof sms.from === "object" && sms.from !== null
    ? ((sms.from as Record<string, unknown>).phone_number as string | undefined)
    : undefined;
  const to = typeof sms.to === "object" && sms.to !== null
    ? ((sms.to as Record<string, unknown>).phone_number as string | undefined)
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
