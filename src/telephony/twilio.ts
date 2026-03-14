import { ClawVoiceConfig } from "../config";
import {
  StartCallInput,
  StartCallResult,
  TelephonyProviderAdapter,
} from "./types";
import { normalizeE164, simulatedCallId } from "./util";

export class TwilioTelephonyAdapter implements TelephonyProviderAdapter {
  public constructor(private readonly config: ClawVoiceConfig) {}

  public providerName(): string {
    return "twilio";
  }

  public async startCall(input: StartCallInput): Promise<StartCallResult> {
    const normalizedTo = normalizeE164(input.to);
    const callId = simulatedCallId("twilio");

    if (
      !this.config.twilioAccountSid ||
      !this.config.twilioAuthToken ||
      !this.config.twilioPhoneNumber
    ) {
      return {
        providerCallId: `simulated-${callId}`,
        normalizedTo,
      };
    }

    return {
      providerCallId: callId,
      normalizedTo,
    };
  }

  public async hangup(_providerCallId: string): Promise<void> {
    return;
  }
}
