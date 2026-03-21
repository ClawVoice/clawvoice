import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import { ClawVoiceService } from "./services/clawvoice";
import { MemoryExtractionService } from "./services/memory-extraction";
export declare function registerTools(api: PluginAPI, config: ClawVoiceConfig, callService: ClawVoiceService, memoryService?: MemoryExtractionService): void;
