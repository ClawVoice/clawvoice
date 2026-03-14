import { Plugin, PluginAPI } from "@openclaw/plugin-sdk";
import { registerCLI } from "./cli";
import { resolveConfig, validateConfig } from "./config";
import { registerHooks } from "./hooks";
import { registerRoutes } from "./routes";
import { MemoryExtractionService } from "./services/memory-extraction";
import { WebSocketRelayService } from "./services/relay";
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
    registerCLI(api, config, callService);
    registerRoutes(api, config, (record) => {
      callService.trackInboundCall(record);
    });
    registerHooks(api, config);

    api.services.register("clawvoice-calls", callService);
    if (config.mode === "managed") {
      api.services.register(
        "clawvoice-relay",
        new WebSocketRelayService(config),
      );
    }

    api.log.info("ClawVoice initialized", {
      mode: config.mode,
      telephonyProvider: config.telephonyProvider,
      voiceProvider: config.voiceProvider,
    });
  },
};

export default plugin;
