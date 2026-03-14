export interface StartCallInput {
  to: string;
  from?: string;
  greeting?: string;
  purpose?: string;
}

export interface StartCallResult {
  providerCallId: string;
  normalizedTo: string;
}

export interface TelephonyProviderAdapter {
  providerName(): string;
  startCall(input: StartCallInput): Promise<StartCallResult>;
  hangup(providerCallId: string): Promise<void>;
}
