import { ClawVoiceConfig } from "../config";
import {
  StartCallInput,
  StartCallResult,
  TelephonyProviderAdapter,
} from "./types";
import { normalizeE164, simulatedCallId } from "./util";

export class TelnyxTelephonyAdapter implements TelephonyProviderAdapter {
  public constructor(private readonly config: ClawVoiceConfig) {}

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
        "Telnyx credentials missing: telnyxApiKey, telnyxConnectionId, and telnyxPhoneNumber are required"
      );
    }

    const callId = simulatedCallId("telnyx");
    return {
      providerCallId: callId,
      normalizedTo,
    };
  }

  public async hangup(_providerCallId: string): Promise<void> {
    return;
  }
}
