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
    const callId = simulatedCallId("telnyx");

    if (
      !this.config.telnyxApiKey ||
      !this.config.telnyxConnectionId ||
      !this.config.telnyxPhoneNumber
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
