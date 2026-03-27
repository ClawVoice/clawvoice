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

export class TelnyxTelephonyAdapter implements TelephonyProviderAdapter {
  private readonly fetchFn: FetchFn;

  public constructor(
    private readonly config: ClawVoiceConfig,
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  public providerName(): string {
    return "telnyx";
  }

  public async startCall(input: StartCallInput): Promise<StartCallResult> {
    const normalizedTo = normalizeE164(input.to);

    if (
      !this.config.telnyxApiKey ||
      !this.config.telnyxConnectionId ||
      !this.config.telnyxPhoneNumber
    ) {
      throw new Error(
        "Telnyx credentials missing: telnyxApiKey, telnyxConnectionId, and telnyxPhoneNumber are required",
      );
    }

    const from = input.from ?? this.config.telnyxPhoneNumber;

    const response = await this.fetchFn("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.telnyxApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connection_id: this.config.telnyxConnectionId,
        to: normalizedTo,
        from: from ?? "",
        answering_machine_detection: this.config.amdEnabled
          ? "detect"
          : "disabled",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[clawvoice] Telnyx startCall API error (${response.status}):`, errorText);
      throw new Error(`Telnyx API error (${response.status}): Call initiation failed`);
    }

    const data = (await response.json()) as {
      data: { call_control_id: string };
    };
    return {
      providerCallId: data.data.call_control_id,
      normalizedTo,
    };
  }

  public async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    const normalizedTo = normalizeE164(input.to);

    if (!this.config.telnyxApiKey || !this.config.telnyxPhoneNumber) {
      throw new Error(
        "Telnyx credentials missing: telnyxApiKey and telnyxPhoneNumber are required",
      );
    }

    const from = input.from ?? this.config.telnyxPhoneNumber;
    const response = await this.fetchFn("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.telnyxApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from ?? "",
        to: normalizedTo,
        text: input.body,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[clawvoice] Telnyx sendSms API error (${response.status}):`, errorText);
      throw new Error(`Telnyx API error (${response.status}): SMS send failed`);
    }

    const data = (await response.json()) as { data: { id: string } };
    return {
      providerMessageId: data.data.id,
      normalizedTo,
    };
  }

  public async hangup(providerCallId: string): Promise<void> {
    if (!this.config.telnyxApiKey) {
      return;
    }

    // H3: Validate providerCallId is alphanumeric/UUID format to prevent URL injection
    if (!/^[a-zA-Z0-9\-_]+$/.test(providerCallId)) {
      console.error(`[clawvoice] Invalid Telnyx call control ID format: ${providerCallId}`);
      return;
    }

    await this.fetchFn(
      `https://api.telnyx.com/v2/calls/${encodeURIComponent(providerCallId)}/actions/hangup`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.telnyxApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    ).catch(() => undefined);
  }
}
