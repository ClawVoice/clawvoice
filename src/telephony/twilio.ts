import { ClawVoiceConfig } from "../config";

import {
  SendSmsInput,
  SendSmsResult,
  StartCallInput,
  StartCallResult,
  TelephonyProviderAdapter,
} from "./types";
import { normalizeE164 } from "./util";

type FetchFn = typeof globalThis.fetch;

export class TwilioTelephonyAdapter implements TelephonyProviderAdapter {
  private readonly fetchFn: FetchFn;

  public constructor(
    private readonly config: ClawVoiceConfig,
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  public providerName(): string {
    return "twilio";
  }

  public async startCall(input: StartCallInput): Promise<StartCallResult> {
    const normalizedTo = normalizeE164(input.to);

    if (
      !this.config.twilioAccountSid ||
      !this.config.twilioAuthToken ||
      !this.config.twilioPhoneNumber
    ) {
      throw new Error(
        "Twilio credentials missing: twilioAccountSid, twilioAuthToken, and twilioPhoneNumber are required",
      );
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.twilioAccountSid}/Calls.json`;
    const from = input.from ?? this.config.twilioPhoneNumber;
    const baseWebhookUrl = this.config.twilioStreamUrl?.trim();
    if (!baseWebhookUrl) {
      throw new Error(
        "Twilio stream URL missing: set CLAWVOICE_TWILIO_STREAM_URL to your public wss:// media stream endpoint",
      );
    }

    const callSidPlaceholder = "{CallSid}";

    // WORKAROUND: Encode purpose/greeting as query params on the stream URL.
    // Twilio's <Parameter> elements (customParameters) are the correct mechanism,
    // but they were arriving EMPTY in testing. URL query params are the fallback.
    // SECURITY NOTE: purpose/greeting text should not contain sensitive PII since
    // it will appear in the WebSocket URL (server logs, Twilio console, etc.).
    const streamUrl = new URL(baseWebhookUrl);
    if (input.purpose) streamUrl.searchParams.set("purpose", input.purpose);
    if (input.greeting) streamUrl.searchParams.set("greeting", input.greeting);
    const enrichedStreamUrl = streamUrl.toString();

    let recordAttr = "";
    if (this.config.recordCalls) {
      // Derive HTTPS webhook URL from the WSS stream URL for recording status callback
      const recordingCallbackUrl = baseWebhookUrl
        .replace(/^wss:/i, "https:")
        .replace(/\/media-stream\/?$/, "/clawvoice/webhooks/twilio/recording");
      recordAttr = ` record="record-from-answer" recordingStatusCallback="${recordingCallbackUrl}" recordingStatusCallbackEvent="completed"`;
    }
    // XML-escape values to prevent TwiML parse errors from special chars in purpose/greeting
    const xmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\r/g, "&#13;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
    const safeStreamUrl = xmlEscape(enrichedStreamUrl);
    const safePurpose = xmlEscape(input.purpose ?? "");
    const safeGreeting = xmlEscape(input.greeting ?? "");
    const twiml = `<Response><Connect${recordAttr}><Stream url="${safeStreamUrl}" name="clawvoice" track="inbound_track"><Parameter name="to" value="${normalizedTo}"/><Parameter name="purpose" value="${safePurpose}"/><Parameter name="greeting" value="${safeGreeting}"/><Parameter name="callSid" value="${callSidPlaceholder}"/></Stream></Connect></Response>`;

    const body = new URLSearchParams({
      To: normalizedTo,
      From: from ?? "",
      Twiml: twiml,
    });

    const auth = Buffer.from(
      `${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`,
    ).toString("base64");

    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Twilio API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { sid: string };
    return {
      providerCallId: data.sid,
      normalizedTo,
    };
  }

  public async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    const normalizedTo = normalizeE164(input.to);

    if (
      !this.config.twilioAccountSid ||
      !this.config.twilioAuthToken ||
      !this.config.twilioPhoneNumber
    ) {
      throw new Error(
        "Twilio credentials missing: twilioAccountSid, twilioAuthToken, and twilioPhoneNumber are required",
      );
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.twilioAccountSid}/Messages.json`;
    const from = input.from ?? this.config.twilioPhoneNumber;

    const body = new URLSearchParams({
      To: normalizedTo,
      From: from ?? "",
      Body: input.body,
    });

    const auth = Buffer.from(
      `${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`,
    ).toString("base64");

    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Twilio API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { sid: string };
    return {
      providerMessageId: data.sid,
      normalizedTo,
    };
  }

  public async hangup(providerCallId: string): Promise<void> {
    if (!this.config.twilioAccountSid || !this.config.twilioAuthToken) {
      return;
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.twilioAccountSid}/Calls/${providerCallId}.json`;
    const auth = Buffer.from(
      `${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`,
    ).toString("base64");

    await this.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Status: "completed" }).toString(),
    }).catch(() => undefined);
  }
}
