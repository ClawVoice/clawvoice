import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import { MemoryExtractionService } from "./services/memory-extraction";
import { VoiceCallService } from "./services/voice-call";
export interface SetupPrompter {
    ask(question: string): Promise<string>;
    close(): void;
}
export declare function runSetupWizard(api: PluginAPI, args: string[], prompter?: SetupPrompter): Promise<void>;
export declare function registerCLI(api: PluginAPI, config: ClawVoiceConfig, callService: VoiceCallService, memoryService?: MemoryExtractionService): void;
