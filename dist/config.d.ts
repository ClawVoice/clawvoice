export type TelephonyProvider = "telnyx" | "twilio";
export type VoiceProvider = "deepgram-agent" | "elevenlabs-conversational";
export type MainMemoryAccess = "read" | "none";
/** Well-known ElevenLabs voice IDs for Conversational AI use. Set via `elevenlabsVoiceId`. */
export declare const ELEVENLABS_VOICES: {
    readonly Eryn: "DXFkLCBUTmvXpp2QwZjA";
    readonly Mark: "UgBBYS2sOqTuMpoF3BR0";
    readonly Joseph: "8fcyCHOzlKDlxh1InJSf";
};
export type ElevenLabsVoiceName = keyof typeof ELEVENLABS_VOICES;
export interface ClawVoiceConfig {
    telephonyProvider: TelephonyProvider;
    voiceProvider: VoiceProvider;
    voiceSystemPrompt: string;
    inboundEnabled: boolean;
    telnyxApiKey?: string;
    telnyxConnectionId?: string;
    telnyxPhoneNumber?: string;
    telnyxWebhookSecret?: string;
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioPhoneNumber?: string;
    twilioStreamUrl?: string;
    mediaStreamBind: string;
    mediaStreamPort: number;
    mediaStreamPath: string;
    deepgramApiKey?: string;
    deepgramVoice: string;
    elevenlabsApiKey?: string;
    elevenlabsAgentId?: string;
    elevenlabsVoiceId?: string;
    openaiApiKey?: string;
    analysisModel: string;
    mainMemoryAccess: MainMemoryAccess;
    autoExtractMemories: boolean;
    maxCallDuration: number;
    disclosureEnabled: boolean;
    disclosureStatement: string;
    dailyCallLimit: number;
    recordCalls: boolean;
    amdEnabled: boolean;
    restrictTools: boolean;
    deniedTools: string[];
    smsAutoReply: boolean;
    notifyTelegram: boolean;
    notifyDiscord: boolean;
    notifySlack: boolean;
    notificationTimezone: string;
    tailscaleMode: "off" | "serve" | "funnel";
    tailscalePath: string;
}
export interface ValidationResult {
    ok: boolean;
    errors: string[];
}
export declare function resolveConfig(pluginConfig?: Record<string, unknown>, env?: NodeJS.ProcessEnv): ClawVoiceConfig;
export declare function validateConfig(config: ClawVoiceConfig): ValidationResult;
