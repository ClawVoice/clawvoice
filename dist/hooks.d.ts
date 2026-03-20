import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
export declare function isVoiceSession(context: unknown): boolean;
export declare function getMemoryWritePolicy(config: ClawVoiceConfig): {
    namespace: string;
};
export declare function getMemoryReadPolicy(config: ClawVoiceConfig): {
    allowed: boolean;
    reason?: string;
};
export declare function getToolDenyList(config: ClawVoiceConfig): string[];
export declare function detectPromptInjection(text: string): {
    detected: boolean;
    pattern?: string;
};
export declare function registerHooks(api: PluginAPI, config: ClawVoiceConfig): void;
