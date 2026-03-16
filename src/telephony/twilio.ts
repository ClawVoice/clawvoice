import { ClawVoiceConfig } from "../config";
import {
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
    const twiml = `<Response><Say>${input.greeting ?? "Hello"}</Say></Response>`;

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
