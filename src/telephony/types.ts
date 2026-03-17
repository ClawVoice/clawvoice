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

export interface SendSmsInput {
  to: string;
  from?: string;
  body: string;
}

export interface SendSmsResult {
  providerMessageId: string;
  normalizedTo: string;
}

export interface TelephonyProviderAdapter {
  providerName(): string;
  startCall(input: StartCallInput): Promise<StartCallResult>;
  sendSms(input: SendSmsInput): Promise<SendSmsResult>;
  hangup(providerCallId: string): Promise<void>;
}
