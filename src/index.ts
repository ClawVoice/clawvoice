import { Plugin, PluginAPI } from "@openclaw/plugin-sdk";
import { registerCLI } from "./cli";
import { resolveConfig, validateConfig } from "./config";
import { registerHooks } from "./hooks";
import { registerRoutes } from "./routes";
import { MemoryExtractionService } from "./services/memory-extraction";
import { VoiceCallService } from "./services/voice-call";
import { registerTools } from "./tools";

const plugin: Plugin = {
  name: "clawvoice",
  async init(api: PluginAPI): Promise<void> {
    const config = resolveConfig(api.config);
    const validation = validateConfig(config);
    if (!validation.ok) {
      throw new Error(validation.errors.join("; "));
    }
    const callService = new VoiceCallService(config);
    const memoryService = new MemoryExtractionService(config);

    registerTools(api, config, callService, memoryService);
    registerCLI(api, config, callService, memoryService);
    registerRoutes(api, config, (record) => {
      callService.trackInboundCall(record);
    });
    registerHooks(api, config);

    api.services.register("clawvoice-calls", callService);

    api.log.info("ClawVoice initialized", {
      telephonyProvider: config.telephonyProvider,
      voiceProvider: config.voiceProvider,
      inboundEnabled: config.inboundEnabled,
    });
  },
};

export async function activate(api: PluginAPI): Promise<void> {
  await plugin.init(api);
}

export async function register(api: PluginAPI): Promise<void> {
  await activate(api);
}

export default plugin;
