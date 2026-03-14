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

export function registerRoutes(
  api: PluginAPI,
  config: ClawVoiceConfig,
  onInbound?: InboundHandler,
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
    const url = `${request.protocol ?? "https"}://${request.headers?.host ?? "localhost"}${request.url ?? "/"}`;
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
    }

    response.status(200).json({ ok: true });
  });

  router.post("/webhooks/twilio/amd", async (req, response) => {
    const request = req as WebhookRequest;
    const url = `${request.protocol ?? "https"}://${request.headers?.host ?? "localhost"}${request.url ?? "/"}`;
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

    response.status(200).json({ ok: true });
  });
}

interface ParsedWebhookBody {
  providerCallId: string;
  from: string;
  to: string;
  amdResult?: AmdResult;
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
