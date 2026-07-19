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
interface LiveCheck {
    name: string;
    ok: boolean;
    detail: string;
}
/**
 * Live connectivity probes for `clawvoice test`: verify the media-stream host is
 * reachable and that telephony/voice provider credentials are actually accepted.
 * Each probe is bounded by a short timeout and degrades gracefully.
 */
export declare function runLiveConnectivityChecks(config: ClawVoiceConfig, fetchFn?: typeof globalThis.fetch): Promise<LiveCheck[]>;
export declare function registerCLI(api: PluginAPI, config: ClawVoiceConfig, callService: ClawVoiceService, memoryService?: MemoryExtractionService, workspacePath?: string): void;
export {};
