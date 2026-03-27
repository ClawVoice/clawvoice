export interface StartCallInput {
    to: string;
    from?: string;
    greeting?: string;
    purpose?: string;
    /** Short reference ID for looking up purpose/greeting from in-memory store instead of URL params (C2). */
    refId?: string;
    /** Auth token to include in the media stream URL for WebSocket authentication (C1). */
    mediaStreamAuthToken?: string;
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
