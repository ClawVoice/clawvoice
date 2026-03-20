import { ClawVoiceConfig } from "../config";
import { SendSmsInput, SendSmsResult, StartCallInput, StartCallResult, TelephonyProviderAdapter } from "./types";
type FetchFn = typeof globalThis.fetch;
export declare class TwilioTelephonyAdapter implements TelephonyProviderAdapter {
    private readonly config;
    private readonly fetchFn;
    constructor(config: ClawVoiceConfig, fetchFn?: FetchFn);
    providerName(): string;
    startCall(input: StartCallInput): Promise<StartCallResult>;
    sendSms(input: SendSmsInput): Promise<SendSmsResult>;
    hangup(providerCallId: string): Promise<void>;
}
export {};
