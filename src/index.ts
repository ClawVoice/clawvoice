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
  workspacePath?: string,
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

  registerCLI(shimApi, config, callService, memoryService, workspacePath);
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
 * Wraps an Express-style route handler as a raw Node.js (IncomingMessage, ServerResponse) handler.
 * OpenClaw's modern registerHttpRoute / registerPluginHttpRoute use raw Node.js http types,
 * but routes.ts handlers expect Express-like req.body, res.status().json() etc.
 */
function wrapExpressHandler(
  expressHandler: (req: unknown, res: unknown) => unknown,
  method?: string,
): (req: import("http").IncomingMessage, res: import("http").ServerResponse) => Promise<void> {
  const MAX_BODY_BYTES = 1_048_576; // 1 MB

  return async (req, res) => {
    if (method && req.method !== method) {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      totalBytes += (chunk as Buffer).length;
      if (totalBytes > MAX_BODY_BYTES) {
        res.writeHead(413, { "Content-Type": "application/json", "Connection": "close" });
        res.end(JSON.stringify({ error: "Payload Too Large" }));
        req.destroy();
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let parsedBody: Record<string, unknown> = {};
    const ct = req.headers["content-type"] || "";
    if (ct.includes("application/json")) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      parsedBody = Object.fromEntries(new URLSearchParams(rawBody));
    }
    const expressReq = Object.assign(req, {
      body: parsedBody,
      protocol: req.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim() || "http",
    });
    const expressRes = {
      _statusCode: 200,
      _headers: {} as Record<string, string>,
      status(code: number) { this._statusCode = code; return this; },
      type(t: string) { this._headers["Content-Type"] = t; return this; },
      json(data: unknown) {
        res.writeHead(this._statusCode, { ...this._headers, "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      },
      send(data: string) {
        res.writeHead(this._statusCode, this._headers);
        res.end(data);
      },
    };
    try {
      await (expressHandler as (req: unknown, res: unknown) => Promise<void>)(expressReq, expressRes);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[clawvoice] route handler error:", msg);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      }
    }
  };
}

/**
 * Try to locate OpenClaw's internal registerPluginHttpRoute function.
 * This registers routes in the shared gateway HTTP registry (which the gateway
 * HTTP server actually dispatches from), unlike api.registerHttpRoute which
 * stores routes in a Pi-scoped registry that the gateway server never reads.
 *
 * Falls back to api.registerHttpRoute if the internal function can't be found.
 */
async function resolveInternalRouteRegistrar(
  api: PluginAPI,
): Promise<((params: Record<string, unknown>) => void) | null> {
  try {
    const path = require("path");
    const fs = require("fs");
    // Locate the OpenClaw dist directory from the running process entry point
    let openclawDist = "";
    if (process.argv[1]) {
      let dir = path.dirname(process.argv[1]);
      for (let i = 0; i < 5; i++) {
        try {
          const files = fs.readdirSync(dir) as string[];
          if (files.some((f: string) => f.startsWith("webhook-ingress-") && f.endsWith(".js"))) {
            openclawDist = dir;
            break;
          }
        } catch { /* skip */ }
        dir = path.dirname(dir);
      }
    }
    if (!openclawDist) return null;
    const webhookFiles = (fs.readdirSync(openclawDist) as string[]).filter(
      (f: string) => f.startsWith("webhook-ingress-") && f.endsWith(".js"),
    );
    if (webhookFiles.length === 0) return null;
    const chunkUrl = "file://" + path.join(openclawDist, webhookFiles[0]).replace(/\\/g, "/");
    const mod = await import(chunkUrl);
    // registerPluginHttpRoute is exported as 'l' in the bundled chunk
    if (typeof mod.l === "function") return mod.l;
    // Fallback: search all single-letter exports for the right signature
    for (const key of Object.keys(mod)) {
      if (typeof mod[key] === "function" && key.length === 1) {
        const src = mod[key].toString();
        if (src.includes("httpRoutes") && src.includes("pluginId")) return mod[key];
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Try to locate OpenClaw's enqueueSystemEvent for injecting messages into
 * the active conversation. Falls back to the api-level emitter if available.
 */
async function resolveSystemEventEmitter(
  api: PluginAPI,
): Promise<((text: string, options?: { source?: string }) => void) | null> {
  // Check if api exposes a system event emitter directly
  const rawApi = api as unknown as Record<string, unknown>;
  if (typeof rawApi.enqueueSystemEvent === "function") {
    return rawApi.enqueueSystemEvent as (text: string, options?: { source?: string }) => void;
  }
  if (rawApi.systemEvents && typeof (rawApi.systemEvents as Record<string, unknown>).enqueue === "function") {
    return (rawApi.systemEvents as { enqueue: (text: string, options?: { source?: string }) => void }).enqueue;
  }

  // Try to find it in the OpenClaw dist chunks (same pattern as route registrar)
  try {
    const path = require("path");
    const fs = require("fs");
    let openclawDist = "";
    if (process.argv[1]) {
      let dir = path.dirname(process.argv[1]);
      for (let i = 0; i < 5; i++) {
        try {
          const files = fs.readdirSync(dir) as string[];
          if (files.some((f: string) => f.startsWith("system-events-") && f.endsWith(".js"))) {
            openclawDist = dir;
            break;
          }
        } catch { /* skip */ }
        dir = path.dirname(dir);
      }
    }
    if (!openclawDist) return null;
    const sysEventFiles = (fs.readdirSync(openclawDist) as string[]).filter(
      (f: string) => f.startsWith("system-events-") && f.endsWith(".js"),
    );
    if (sysEventFiles.length === 0) return null;
    const chunkUrl = "file://" + path.join(openclawDist, sysEventFiles[0]).replace(/\\/g, "/");
    const mod = await import(chunkUrl);
    // Look for enqueueSystemEvent export
    if (typeof mod.enqueueSystemEvent === "function") return mod.enqueueSystemEvent;
    // Fallback: search single-letter exports
    for (const key of Object.keys(mod)) {
      if (typeof mod[key] === "function") {
        const src = mod[key].toString();
        if (src.includes("systemEvent") || src.includes("enqueueSystem")) return mod[key];
      }
    }
  } catch { /* ignore */ }
  return null;
}

function registerModernRoutesBridge(
  api: PluginAPI,
  config: ReturnType<typeof resolveConfig>,
  callService: ClawVoiceService,
): void {
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
    (providerCallId, recordingUrl) => {
      callService.setRecordingUrl(providerCallId, recordingUrl);
    },
  );

  // Try the internal gateway registry first; fall back to api.registerHttpRoute
  resolveInternalRouteRegistrar(api)
    .then((internalRegister) => {
      const registerFn = internalRegister
        ?? (typeof (api as unknown as ModernPluginApi).registerHttpRoute === "function"
          ? (params: Record<string, unknown>) =>
              (api as unknown as ModernPluginApi).registerHttpRoute!(params)
          : null);

      if (!registerFn) return;

      for (const route of capturedRoutes) {
        registerFn({
          path: route.path,
          handler: wrapExpressHandler(route.handler, route.method),
          auth: "plugin",
          match: "exact",
          pluginId: "clawvoice",
          source: "clawvoice-route-bridge",
        });
      }
    })
    .catch((err) => {
      console.error("[clawvoice] route registration failed:", err instanceof Error ? err.message : String(err));
    });
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
  // api.pluginConfig is the intended source, but some OpenClaw versions leave it
  // undefined and pass the full config as api.config.  Fall back through the
  // nested path plugins.entries.clawvoice.config before using the raw config.
  const rawCfg = api.config as Record<string, unknown> | undefined;
  const nestedPluginCfg = (
    (rawCfg?.plugins as Record<string, unknown> | undefined)
      ?.entries as Record<string, unknown> | undefined
  )?.clawvoice as Record<string, unknown> | undefined;
  const pluginCfg = api.pluginConfig ?? nestedPluginCfg?.config ?? api.config;
  const config = resolveConfig(pluginCfg as Record<string, unknown>);
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

  // Resolve workspace path for user profile and voice-memory access
  const rawApiConfig = api.config as Record<string, unknown> | undefined;
  const workspacePath =
    (typeof rawApiConfig?.workspace === "string" ? rawApiConfig.workspace : undefined) ??
    (typeof rawApiConfig?.dataDir === "string" ? rawApiConfig.dataDir : undefined) ??
    (typeof rawApiConfig?.workspacePath === "string" ? rawApiConfig.workspacePath : undefined) ??
    (typeof process.env.OPENCLAW_WORKSPACE === "string" && process.env.OPENCLAW_WORKSPACE.length > 0
      ? process.env.OPENCLAW_WORKSPACE
      : undefined);

  const callService = new ClawVoiceService(config, undefined, workspacePath);
  const memoryService = new MemoryExtractionService(config);

  // Wire system event emitter for immediate post-call summary delivery
  resolveSystemEventEmitter(api)
    .then((emitter) => {
      if (emitter) {
        callService.postCall.setSystemEventEmitter(emitter);
      }
    })
    .catch(() => undefined);

  void callService.start().catch((error) => {
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
    registerCLI(api, config, callService, memoryService, workspacePath);
  } else {
    registerModernCliBridge(api, config, callService, memoryService, workspacePath);
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
      (providerCallId, recordingUrl) => {
        callService.setRecordingUrl(providerCallId, recordingUrl);
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
