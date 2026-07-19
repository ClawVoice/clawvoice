import { createHash } from "crypto";
import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import {
  classifyInboundEvent,
  decideInboundAction,
  buildInboundRecord,
} from "./inbound/classifier";
import { AmdResult, InboundCallRecord } from "./inbound/types";
import { verifyTelnyxSignature, verifyTwilioSignature } from "./webhooks/verify";
import { MediaStreamServer } from "./transport/media-stream-server";

interface WebhookRequest {
  body?: unknown;
  /** Exact raw request bytes as received, used for signature verification. */
  rawBody?: string;
  headers?: Record<string, string>;
  protocol?: string;
  url?: string;
}

type InboundHandler = (record: InboundCallRecord) => void;
type InboundTextHandler = (from: string, to: string, body: string, messageId?: string) => void;
type RecordingHandler = (providerCallId: string, recordingUrl: string) => void;

export interface WebhookCallbacks {
  onInbound?: InboundHandler;
  onInboundText?: InboundTextHandler;
  onRecording?: RecordingHandler;
}

/** H5: Simple in-memory per-IP rate limiter for webhook endpoints. */
const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;
const WEBHOOK_RATE_LIMIT_MAX = 100;

class WebhookRateLimiter {
  private readonly map = new Map<string, { count: number; resetAt: number }>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically evict expired entries to prevent unbounded growth
    this.cleanupTimer = setInterval(() => this.evictExpired(), 5 * 60_000);
    this.cleanupTimer.unref?.();
  }

  check(req: WebhookRequest): boolean {
    // Behind the documented tunnels (ngrok/Cloudflare/Tailscale) every request
    // shares the proxy's socket address, which would collapse all traffic into a
    // single bucket. Prefer the real client IP from X-Forwarded-For.
    const fwd = req.headers?.["x-forwarded-for"];
    const forwardedIp = typeof fwd === "string" ? fwd.split(",")[0]?.trim() : "";
    const rawReq = req as unknown as { socket?: { remoteAddress?: string }; connection?: { remoteAddress?: string } };
    const ip = forwardedIp || rawReq.socket?.remoteAddress || rawReq.connection?.remoteAddress || "unknown";
    const now = Date.now();
    const entry = this.map.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.map.set(ip, { count: 1, resetAt: now + WEBHOOK_RATE_LIMIT_WINDOW_MS });
      return true;
    }
    entry.count++;
    return entry.count <= WEBHOOK_RATE_LIMIT_MAX;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [ip, entry] of this.map) {
      if (now >= entry.resetAt) this.map.delete(ip);
    }
  }
}

/**
 * Core webhook handler logic, shared between OpenClaw API registration and standalone server.
 */
export function createWebhookHandlers(
  config: ClawVoiceConfig,
  callbacks: WebhookCallbacks,
  logError?: (msg: string) => void,
): {
  handleTelnyxWebhook: (req: WebhookRequest, response: unknown) => Promise<void>;
  handleTwilioVoice: (req: WebhookRequest, response: unknown) => Promise<void>;
  handleTwilioAmd: (req: WebhookRequest, response: unknown) => Promise<void>;
  handleTwilioSms: (req: WebhookRequest, response: unknown) => Promise<void>;
  handleTwilioRecording: (req: WebhookRequest, response: unknown) => Promise<void>;
} {
  const { onInbound, onInboundText, onRecording } = callbacks;
  const rateLimiter = new WebhookRateLimiter();
  const mediaStreamAuthToken = config.twilioAuthToken
    ? createHash("sha256")
        .update(`clawvoice-media-stream:${config.twilioAuthToken}`)
        .digest("hex")
        .slice(0, 32)
    : undefined;

  const handleTelnyxWebhook = async (req: WebhookRequest, response: unknown): Promise<void> => {
    if (!rateLimiter.check(req)) {
      (response as ResponseShim).status(429).json({ error: "Too Many Requests" });
      return;
    }
    const request = req as WebhookRequest;
    // Ed25519 verification must run over the EXACT signed bytes. Prefer the raw
    // request body; only fall back to re-serialization when it isn't available
    // (e.g. legacy callers that pass a pre-parsed body and no rawBody).
    const body =
      typeof request.rawBody === "string"
        ? request.rawBody
        : typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body ?? "");
    const result = verifyTelnyxSignature(
      body,
      request.headers?.["telnyx-signature-ed25519"],
      request.headers?.["telnyx-timestamp"],
      config.telnyxWebhookSecret,
    );
    if (!result.valid) {
      (response as ResponseShim).status(401).json({ error: "Unauthorized", reason: result.reason });
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
      (response as ResponseShim).status(200).json({ ok: true });
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

    (response as ResponseShim).status(200).json({ ok: true });
  };

  const handleTwilioVoice = async (req: WebhookRequest, response: unknown): Promise<void> => {
    if (!rateLimiter.check(req)) {
      (response as ResponseShim).status(429).json({ error: "Too Many Requests" });
      return;
    }
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
      (response as ResponseShim).status(401).json({ error: "Unauthorized", reason: result.reason });
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
      if (!config.twilioStreamUrl?.trim()) {
        const maskPhone = (num: string): string => num.length > 4 ? num.slice(0, -4).replace(/./g, "*") + num.slice(-4) : "****";
        const from = params["From"] ? maskPhone(params["From"]) : "unknown";
        const to = params["To"] ? maskPhone(params["To"]) : "unknown";
        const callSid = params["CallSid"] || "unknown";
        logError?.(
          `Inbound call received but CLAWVOICE_TWILIO_STREAM_URL is not configured. ` +
          `From: ${from}, To: ${to}, CallSid: ${callSid}. ` +
          `The caller will hear a generic error. Set this to a public WSS endpoint ` +
          `(e.g. wss://your-tunnel.ngrok-free.dev/media-stream) or run 'clawvoice setup'.`
        );
      }
      sendTwiml(response, buildTwilioVoiceTwiml(config, mediaStreamAuthToken, params["From"], params["To"]));
      return;
    }

    sendTwiml(response, "<Response><Reject/></Response>");
  };

  const handleTwilioAmd = async (req: WebhookRequest, response: unknown): Promise<void> => {
    if (!rateLimiter.check(req)) {
      (response as ResponseShim).status(429).json({ error: "Too Many Requests" });
      return;
    }
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
      (response as ResponseShim).status(401).json({ error: "Unauthorized", reason: result.reason });
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

    (response as ResponseShim).status(200).json({ ok: true });
  };

  const handleTwilioSms = async (req: WebhookRequest, response: unknown): Promise<void> => {
    if (!rateLimiter.check(req)) {
      (response as ResponseShim).status(429).json({ error: "Too Many Requests" });
      return;
    }
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
      (response as ResponseShim).status(401).json({ error: "Unauthorized", reason: result.reason });
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

  const handleTwilioRecording = async (req: WebhookRequest, response: unknown): Promise<void> => {
    if (!rateLimiter.check(req)) {
      (response as ResponseShim).status(429).json({ error: "Too Many Requests" });
      return;
    }
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
      (response as ResponseShim).status(401).json({ error: "Unauthorized", reason: result.reason });
      return;
    }

    const callSid = typeof params.CallSid === "string" ? params.CallSid : "";
    const recordingUrl = typeof params.RecordingUrl === "string" ? params.RecordingUrl : "";

    // M7: Validate recording URL domain matches Twilio/Telnyx patterns
    if (callSid && recordingUrl && onRecording) {
      let validDomain = false;
      try {
        const parsed = new URL(recordingUrl);
        validDomain = /\.(twilio\.com|telnyx\.com)$/i.test(parsed.hostname);
      } catch { /* invalid URL */ }
      if (validDomain) {
        onRecording(callSid, recordingUrl);
      } else {
        logError?.(`Recording URL rejected — unexpected domain: ${recordingUrl}`);
      }
    }

    (response as ResponseShim).status(200).json({ ok: true });
  };

  return { handleTelnyxWebhook, handleTwilioVoice, handleTwilioAmd, handleTwilioSms, handleTwilioRecording };
}

// Minimal type shim for response objects (works with both Express-like and raw shims)
interface ResponseShim {
  status(code: number): ResponseShim;
  json(data: unknown): void;
  type?(contentType: string): ResponseShim & { send?(payload: string): void };
  send?(payload: string): void;
}

/**
 * Register webhook routes on the OpenClaw API router (legacy path).
 */
export function registerRoutes(
  api: PluginAPI,
  config: ClawVoiceConfig,
  onInbound?: InboundHandler,
  onInboundText?: InboundTextHandler,
  onRecording?: RecordingHandler,
): void {
  const router = api.http.router("/clawvoice");

  // Resolve a logger for error reporting
  const rawApi = api as unknown as Record<string, unknown>;
  const routeLog = (api.log && typeof api.log.error === "function") ? api.log
    : (rawApi.logger && typeof (rawApi.logger as { error?: unknown }).error === "function") ? rawApi.logger as { error: (msg: string) => void }
    : undefined;

  const handlers = createWebhookHandlers(
    config,
    { onInbound, onInboundText, onRecording },
    (msg) => routeLog?.error?.(msg),
  );

  router.post("/webhooks/telnyx", async (req, response) => {
    await handlers.handleTelnyxWebhook(req as WebhookRequest, response);
  });

  router.post("/webhooks/twilio/voice", async (req, response) => {
    await handlers.handleTwilioVoice(req as WebhookRequest, response);
  });

  router.post("/webhooks/twilio/amd", async (req, response) => {
    await handlers.handleTwilioAmd(req as WebhookRequest, response);
  });

  router.post("/webhooks/twilio/sms", async (req, response) => {
    await handlers.handleTwilioSms(req as WebhookRequest, response);
  });

  router.post("/webhooks/twilio/recording", async (req, response) => {
    await handlers.handleTwilioRecording(req as WebhookRequest, response);
  });
}

/**
 * Register webhook routes on the standalone MediaStreamServer.
 * This allows webhooks to work even when the OpenClaw gateway doesn't
 * dispatch plugin-registered routes correctly.
 */
export function registerStandaloneWebhookRoutes(
  server: MediaStreamServer,
  config: ClawVoiceConfig,
  callbacks: WebhookCallbacks,
): void {
  const handlers = createWebhookHandlers(
    config,
    callbacks,
    (msg) => console.error(`[clawvoice]`, msg),
  );

  server.registerHttpRoute("POST", "/clawvoice/webhooks/telnyx", async (req, res) => {
    await handlers.handleTelnyxWebhook(req as unknown as WebhookRequest, res);
  });

  server.registerHttpRoute("POST", "/clawvoice/webhooks/twilio/voice", async (req, res) => {
    await handlers.handleTwilioVoice(req as unknown as WebhookRequest, res);
  });

  server.registerHttpRoute("POST", "/clawvoice/webhooks/twilio/amd", async (req, res) => {
    await handlers.handleTwilioAmd(req as unknown as WebhookRequest, res);
  });

  server.registerHttpRoute("POST", "/clawvoice/webhooks/twilio/sms", async (req, res) => {
    await handlers.handleTwilioSms(req as unknown as WebhookRequest, res);
  });

  server.registerHttpRoute("POST", "/clawvoice/webhooks/twilio/recording", async (req, res) => {
    await handlers.handleTwilioRecording(req as unknown as WebhookRequest, res);
  });
}

/** Reconstruct the public URL from request headers for signature verification.
 *  Twilio signs the real URL it called, so header-based reconstruction is safe:
 *  a spoofed host produces a URL that won't match the Twilio signature. */
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

function buildTwilioVoiceTwiml(config: ClawVoiceConfig, authToken?: string, from?: string, to?: string): string {
  const rawStreamUrl = config.twilioStreamUrl?.trim();
  if (!rawStreamUrl) {
    return "<Response><Say>We're sorry, this call cannot be completed at this time.</Say><Hangup/></Response>";
  }
  const xmlEscape = (s: string): string => s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/\r/g, "&#13;").replace(/\n/g, "&#10;");
  const safeStreamUrl = xmlEscape(rawStreamUrl);
  const params = [
    authToken ? `<Parameter name="clawvoice_token" value="${xmlEscape(authToken)}"/>` : "",
    from ? `<Parameter name="from" value="${xmlEscape(from)}"/>` : "",
    to ? `<Parameter name="to" value="${xmlEscape(to)}"/>` : "",
  ].filter(Boolean).join("");
  return `<Response><Connect><Stream url="${safeStreamUrl}" track="inbound_track">${params}</Stream></Connect></Response>`;
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

  const root = body as Record<string, unknown>;

  // Twilio delivers flat form params at the root (CallSid/From/To).
  // Telnyx v2 nests everything under data.payload — resolve that first and use
  // it as the effective object, falling back to the root for Twilio.
  const data = root.data;
  const payload =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>).payload
      : undefined;
  const b =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : root;

  const providerCallId =
    typeof root.CallSid === "string" ? root.CallSid
    : typeof b.call_control_id === "string" ? b.call_control_id
    : typeof root.call_control_id === "string" ? root.call_control_id
    : undefined;

  if (!providerCallId) {
    return null;
  }

  const from =
    typeof root.From === "string" ? root.From
    : typeof b.from === "string" ? b.from
    : typeof root.from === "string" ? root.from
    : "";

  const to =
    typeof root.To === "string" ? root.To
    : typeof b.to === "string" ? b.to
    : typeof root.to === "string" ? root.to
    : "";

  return { providerCallId, from, to };
}

function parseTelnyxSmsBody(body: unknown): ParsedTelnyxSmsBody | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const root = body as Record<string, unknown>;
  const data = root.data;
  const dataObj =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>) : undefined;

  // Telnyx v2 nests event_type under `data`; tolerate a root-level event_type too.
  const eventType = (dataObj?.event_type ?? root.event_type);
  if (eventType !== "message.received") {
    return null;
  }

  const payload = dataObj?.payload;
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const sms = payload as Record<string, unknown>;
  // `from` is an object { phone_number, ... }. `to` is an ARRAY of
  // { phone_number, ... } on real Telnyx messaging webhooks (but tolerate a
  // single object shape as well).
  const phoneOf = (v: unknown): string | undefined =>
    typeof v === "object" && v !== null
      ? ((v as Record<string, unknown>).phone_number as string | undefined)
      : undefined;
  const from = phoneOf(sms.from);
  const to = Array.isArray(sms.to) ? phoneOf(sms.to[0]) : phoneOf(sms.to);
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
