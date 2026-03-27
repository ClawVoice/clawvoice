import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig, resolveConfig } from "./config";
import { MemoryExtractionService } from "./services/memory-extraction";
import { ClawVoiceService } from "./services/clawvoice";
export interface SetupPrompter {
    ask(question: string): Promise<string>;
    close(): void;
}
export declare function runSetupWizard(api: PluginAPI, args: string[], prompter?: SetupPrompter): Promise<void>;
export declare function runInteractiveSetupWizard(api: PluginAPI, config?: ReturnType<typeof resolveConfig>): Promise<void>;
export declare function registerCLI(api: PluginAPI, config: ClawVoiceConfig, callService: ClawVoiceService, memoryService?: MemoryExtractionService, workspacePath?: string): void;
