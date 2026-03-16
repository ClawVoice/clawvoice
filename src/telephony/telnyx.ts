import { ClawVoiceConfig } from "../config";
import {
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
      throw new Error(`Telnyx API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      data: { call_control_id: string };
    };
    return {
      providerCallId: data.data.call_control_id,
      normalizedTo,
    };
  }

  public async hangup(providerCallId: string): Promise<void> {
    if (!this.config.telnyxApiKey) {
      return;
    }

    await this.fetchFn(
      `https://api.telnyx.com/v2/calls/${providerCallId}/actions/hangup`,
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
