import { Plugin, PluginAPI } from "@openclaw/plugin-sdk";
import { registerCLI } from "./cli";
import { resolveConfig, validateConfig } from "./config";
import { runDiagnostics } from "./diagnostics/health";
import { registerHooks } from "./hooks";
import { registerRoutes } from "./routes";
import { MemoryExtractionService } from "./services/memory-extraction";
import { VoiceCallService } from "./services/voice-call";
import { registerTools } from "./tools";

type LegacyCliCommandDefinition = {
  name: string;
  description: string;
  run: (args: string[]) => Promise<void>;
};

type CommanderLike = {
  command(name: string): CommanderLike;
  description(text: string): CommanderLike;
  action(handler: (...args: unknown[]) => unknown): CommanderLike;
};

type ToolDefinition = {
  name: string;
  description: string;
  parameters?: unknown;
  handler?: (input: Record<string, unknown>) => Promise<unknown>;
};

type ModernPluginApi = {
  registerCli?: (
    registrar: (ctx: { program: CommanderLike }) => void,
    opts?: { commands?: string[] },
  ) => void;
  registerTool?: (
    tool: Record<string, unknown>,
    opts?: { name?: string },
  ) => void;
  registerHttpRoute?: (route: Record<string, unknown>) => void;
};

function normalizeCliArgs(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((value) => String(value));
  }
  if (typeof input === "string" && input.trim().length > 0) {
    return [input.trim()];
  }
  return [];
}

function registerModernCliBridge(
  api: PluginAPI,
  config: ReturnType<typeof resolveConfig>,
  callService: VoiceCallService,
  memoryService: MemoryExtractionService,
): void {
  const modernApi = api as unknown as ModernPluginApi;
  if (typeof modernApi.registerCli !== "function") {
    return;
  }

  const legacyCommands: LegacyCliCommandDefinition[] = [];
  const shimApi = {
    ...api,
    cli: {
      register(definition: LegacyCliCommandDefinition): void {
        legacyCommands.push(definition);
      },
    },
  } as PluginAPI;

  registerCLI(shimApi, config, callService, memoryService);
  if (legacyCommands.length === 0) {
    return;
  }

  modernApi.registerCli(
    ({ program }) => {
      const root = program.command("clawvoice").description("ClawVoice commands");
      for (const definition of legacyCommands) {
        if (!definition.name.startsWith("clawvoice ")) {
          continue;
        }
        const commandName = definition.name.slice("clawvoice ".length).trim();
        if (!commandName) {
          continue;
        }
        root
          .command(`${commandName} [args...]`)
          .description(definition.description)
          .action(async (...actionArgs: unknown[]) => {
            const args = normalizeCliArgs(actionArgs[0]);
            await definition.run(args);
          });
      }
    },
    { commands: ["clawvoice"] },
  );
}

function registerModernToolsBridge(
  api: PluginAPI,
  config: ReturnType<typeof resolveConfig>,
  callService: VoiceCallService,
  memoryService: MemoryExtractionService,
): void {
  const modernApi = api as unknown as ModernPluginApi;
  if (typeof modernApi.registerTool !== "function") {
    return;
  }

  const capturedTools: ToolDefinition[] = [];
  const shimApi = {
    ...api,
    tools: {
      register(definition: ToolDefinition): void {
        capturedTools.push(definition);
      },
    },
  } as PluginAPI;

  registerTools(shimApi, config, callService, memoryService);

  for (const tool of capturedTools) {
    modernApi.registerTool(
      {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: tool.handler,
      },
      { name: tool.name },
    );
  }
}

function registerModernRoutesBridge(
  api: PluginAPI,
  config: ReturnType<typeof resolveConfig>,
  callService: VoiceCallService,
): void {
  const modernApi = api as unknown as ModernPluginApi;
  if (typeof modernApi.registerHttpRoute !== "function") {
    return;
  }

  type CapturedRoute = {
    method: string;
    path: string;
    handler: (req: unknown, res: unknown) => unknown;
  };

  const capturedRoutes: CapturedRoute[] = [];
  const shimApi = {
    ...api,
    http: {
      router(prefix: string) {
        return {
          post(path: string, handler: (req: unknown, res: unknown) => unknown) {
            capturedRoutes.push({ method: "POST", path: `${prefix}${path}`, handler });
          },
          get(path: string, handler: (req: unknown, res: unknown) => unknown) {
            capturedRoutes.push({ method: "GET", path: `${prefix}${path}`, handler });
          },
        };
      },
    },
  } as PluginAPI;

  registerRoutes(
    shimApi,
    config,
    (record) => {
      callService.trackInboundCall(record);
    },
    (from, to, body, messageId) => {
      callService.trackInboundText(from, to, body, messageId);
    },
  );

  for (const route of capturedRoutes) {
    modernApi.registerHttpRoute({
      method: route.method,
      path: route.path,
      handler: route.handler,
    });
  }
}

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
  void callService.start().catch((error) => {
    api.log?.error?.("ClawVoice call service failed to start", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const toolsRegister = (api as unknown as { tools?: { register?: unknown } }).tools?.register;
  if (typeof toolsRegister === "function") {
    registerTools(api, config, callService, memoryService);
  } else {
    registerModernToolsBridge(api, config, callService, memoryService);
  }

  const cliRegister = (api as unknown as { cli?: { register?: unknown } }).cli?.register;
  if (typeof cliRegister === "function") {
    registerCLI(api, config, callService, memoryService);
  } else {
    registerModernCliBridge(api, config, callService, memoryService);
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
  } else {
    registerModernRoutesBridge(api, config, callService);
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
