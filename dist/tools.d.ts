import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import { VoiceCallService } from "./services/voice-call";
import { MemoryExtractionService } from "./services/memory-extraction";
export declare function registerTools(api: PluginAPI, config: ClawVoiceConfig, callService: VoiceCallService, memoryService?: MemoryExtractionService): void;
