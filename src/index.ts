import { IncomingMessage, ServerResponse } from "http";
import { Plugin, PluginAPI } from "@openclaw/plugin-sdk";
import { registerCLI } from "./cli";
import { resolveConfig, validateConfig } from "./config";
import { runDiagnostics } from "./diagnostics/health";
import { registerHooks } from "./hooks";
import { registerRoutes } from "./routes";
import { MemoryExtractionService } from "./services/memory-extraction";
import { ClawVoiceService } from "./services/clawvoice";
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
  callService: ClawVoiceService,
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

/**
 * Extract params from OpenClaw execute() call.
 * Modern API: execute(params: Record<string, unknown>)
 * Legacy API: execute(toolCallId: string, params: Record<string, unknown>)
 * Returns the first object-like argument, or {} if none found.
 */
function extractParams(...executeArgs: unknown[]): Record<string, unknown> {
  for (const arg of executeArgs) {
    if (arg !== null && arg !== undefined && typeof arg === "object" && !Array.isArray(arg)) {
      return arg as Record<string, unknown>;
    }
  }
  return {};
}

function registerModernToolsBridge(
  api: PluginAPI,
  config: ReturnType<typeof resolveConfig>,
  callService: ClawVoiceService,
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
    const handler = tool.handler;
    modernApi.registerTool(
      {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: handler
          ? async (...executeArgs: unknown[]) => handler(extractParams(...executeArgs))
          : undefined,
      },
      { name: tool.name },
    );
  }
}

/**
 * Adapt an Express-style route handler to raw Node.js (IncomingMessage, ServerResponse).
 *
 * OpenClaw's modern registerHttpRoute API passes raw Node.js objects, but our
 * route handlers (in routes.ts) expect Express-like req.body, res.status().json(), etc.
 * This adapter reads/parses the body and shims the response methods.
 */
function adaptExpressToNode(
  expressHandler: (req: unknown, res: unknown) => unknown,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
    }
    const rawBody = Buffer.concat(chunks).toString("utf-8");

    const contentType = (req.headers["content-type"] ?? "").toLowerCase();
    let body: unknown;
    if (contentType.includes("application/json")) {
      try { body = JSON.parse(rawBody); } catch { body = rawBody; }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      // Twilio sends form-urlencoded webhooks
      const entries = new URLSearchParams(rawBody);
      const obj: Record<string, string> = {};
      for (const [key, value] of entries) { obj[key] = value; }
      body = obj;
    } else {
      body = rawBody;
    }

    const shimReq = {
      body,
      headers: req.headers as Record<string, string>,
      protocol: (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "https",
      url: req.url,
    };

    let statusCode = 200;
    let responseSent = false;

    const shimRes = {
      status(code: number) {
        statusCode = code;
        return shimRes;
      },
      json(value: unknown) {
        if (responseSent) return;
        responseSent = true;
        const payload = JSON.stringify(value);
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(payload);
      },
      send(payload?: string) {
        if (responseSent) return;
        responseSent = true;
        res.writeHead(statusCode, { "Content-Type": "text/plain" });
        res.end(payload ?? "");
      },
      type(ct: string) {
        return {
          send(payload: string) {
            if (responseSent) return;
            responseSent = true;
            res.writeHead(statusCode, { "Content-Type": ct });
            res.end(payload);
          },
        };
      },
    };

    try {
      await expressHandler(shimReq, shimRes);
    } catch (err) {
      if (!responseSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  };
}

function registerModernRoutesBridge(
  api: PluginAPI,
  config: ReturnType<typeof resolveConfig>,
  callService: ClawVoiceService,
): void {
  const modernApi = api as unknown as ModernPluginApi;
  if (typeof modernApi.registerHttpRoute !== "function") {
    console.warn("[clawvoice] registerHttpRoute not available — webhook routes will not be registered");
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
    console.error(`[clawvoice] registering route: ${route.method} ${route.path}`);
    modernApi.registerHttpRoute({
      method: route.method,
      path: route.path,
      handler: adaptExpressToNode(route.handler),
      auth: "plugin",
    });
  }
}

type LoggerLike = {
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  error?: (msg: string, meta?: Record<string, unknown>) => void;
};

function resolveLogger(api: PluginAPI): LoggerLike {
  const raw = api as unknown as Record<string, unknown>;
  if (api.log && typeof api.log.info === "function") return api.log;
  if (raw.logger && typeof (raw.logger as LoggerLike).info === "function") return raw.logger as LoggerLike;
  return {};
}

function initPlugin(api: PluginAPI): void {
  const logger = resolveLogger(api);
  // OpenClaw may provide plugin config at api.pluginConfig, or nested inside
  // the full config at api.config.plugins.entries.clawvoice.config.
  // Fall back to api.config for backward compatibility.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fullCfg = api.config as any;
  const pluginCfg = api.pluginConfig
    ?? fullCfg?.plugins?.entries?.clawvoice?.config
    ?? api.config;
  const config = resolveConfig(pluginCfg);
  const validation = validateConfig(config);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const diagnostics = runDiagnostics(config);
  for (const check of diagnostics.checks) {
    if (check.status === "fail" || check.status === "warn") {
      logger.warn?.(`ClawVoice config ${check.status}: ${check.name}`, {
        detail: check.detail,
        remediation: check.remediation,
      });
    }
  }

  const callService = new ClawVoiceService(config);
  const memoryService = new MemoryExtractionService(config);
  void callService.start().catch((error) => {
    console.error("[clawvoice] start error:", error instanceof Error ? error.stack : String(error));
    logger.error?.("ClawVoice call service failed to start", {
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
    console.error("[clawvoice] using legacy route registration (api.http.router)");
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
    console.error("[clawvoice] using modern route registration (registerHttpRoute)");
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

  logger.info?.("ClawVoice initialized", {
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
