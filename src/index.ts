import { Plugin, PluginAPI } from "@openclaw/plugin-sdk";
import { registerCLI } from "./cli";
import { resolveConfig, validateConfig } from "./config";
import { runDiagnostics } from "./diagnostics/health";
import { registerHooks } from "./hooks";
import { registerRoutes } from "./routes";
import { MemoryExtractionService } from "./services/memory-extraction";
import { VoiceCallService } from "./services/voice-call";
import { registerTools } from "./tools";

function initPlugin(api: PluginAPI): void {
  const config = resolveConfig(api.config);
  const validation = validateConfig(config);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const diagnostics = runDiagnostics(config);
  for (const check of diagnostics.checks) {
    if (check.status === "fail" || check.status === "warn") {
      api.log?.warn?.(`ClawVoice config ${check.status}: ${check.name}`, {
        detail: check.detail,
        remediation: check.remediation,
      });
    }
  }

  const callService = new VoiceCallService(config);
  const memoryService = new MemoryExtractionService(config);

  const toolsRegister = (api as unknown as { tools?: { register?: unknown } }).tools?.register;
  if (typeof toolsRegister === "function") {
    registerTools(api, config, callService, memoryService);
  }

  const cliRegister = (api as unknown as { cli?: { register?: unknown } }).cli?.register;
  if (typeof cliRegister === "function") {
    registerCLI(api, config, callService, memoryService);
  }

  const httpRouter = (api as unknown as { http?: { router?: unknown } }).http?.router;
  if (typeof httpRouter === "function") {
    registerRoutes(
      api,
      config,
      (record) => {
        callService.trackInboundCall(record);
      },
      (from, to, body, messageId) => {
        callService.trackInboundText(from, to, body, messageId);
      },
    );
  }

  const hooksOn = (api as unknown as { hooks?: { on?: unknown } }).hooks?.on;
  if (typeof hooksOn === "function") {
    registerHooks(api, config);
  }

  const servicesRegister = (api as unknown as { services?: { register?: unknown } }).services?.register;
  if (typeof servicesRegister === "function") {
    api.services.register("clawvoice-calls", callService);
  }

  api.log?.info?.("ClawVoice initialized", {
    telephonyProvider: config.telephonyProvider,
    voiceProvider: config.voiceProvider,
    inboundEnabled: config.inboundEnabled,
  });
}

type OpenClawPluginExports = Plugin & {
  register(api: PluginAPI): void;
  activate(api: PluginAPI): void;
};

const plugin: OpenClawPluginExports = {
  name: "clawvoice",
  async init(api: PluginAPI): Promise<void> {
    initPlugin(api);
  },
  register(api: PluginAPI): void {
    initPlugin(api);
  },
  activate(api: PluginAPI): void {
    initPlugin(api);
  },
};

export function activate(api: PluginAPI): void {
  initPlugin(api);
}

export function register(api: PluginAPI): void {
  initPlugin(api);
}

export default plugin;
