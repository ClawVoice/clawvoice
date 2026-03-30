"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.register = register;
exports._resetForTesting = _resetForTesting;
const fs = __importStar(require("fs"));
const fsp = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const cli_1 = require("./cli");
const config_1 = require("./config");
const health_1 = require("./diagnostics/health");
const hooks_1 = require("./hooks");
const routes_1 = require("./routes");
const memory_extraction_1 = require("./services/memory-extraction");
const clawvoice_1 = require("./services/clawvoice");
const tools_1 = require("./tools");
function normalizeCliArgs(input) {
    if (Array.isArray(input)) {
        return input.map((value) => String(value));
    }
    if (typeof input === "string" && input.trim().length > 0) {
        return [input.trim()];
    }
    return [];
}
function registerModernCliBridge(api, config, callService, memoryService, workspacePath) {
    const modernApi = api;
    if (typeof modernApi.registerCli !== "function") {
        return;
    }
    const legacyCommands = [];
    const shimApi = {
        ...api,
        cli: {
            register(definition) {
                legacyCommands.push(definition);
            },
        },
    };
    (0, cli_1.registerCLI)(shimApi, config, callService, memoryService, workspacePath);
    if (legacyCommands.length === 0) {
        return;
    }
    modernApi.registerCli(({ program }) => {
        const root = program.command("clawvoice").description("ClawVoice commands");
        // Allow unknown options on the parent so they pass through to subcommands
        if (typeof root.allowUnknownOption === "function") {
            root.allowUnknownOption();
        }
        for (const definition of legacyCommands) {
            if (!definition.name.startsWith("clawvoice ")) {
                continue;
            }
            const commandName = definition.name.slice("clawvoice ".length).trim();
            if (!commandName) {
                continue;
            }
            const cmd = root
                .command(`${commandName} [args...]`)
                .description(definition.description);
            // Allow flags like --purpose, --greeting to pass through to the
            // plugin's own parseFlag() handler instead of Commander rejecting them.
            if (typeof cmd.allowUnknownOption === "function") {
                cmd.allowUnknownOption();
            }
            // enablePositionalOptions tells Commander to stop parsing options after
            // the variadic argument, letting --purpose etc. arrive in the args array.
            if (typeof cmd.enablePositionalOptions === "function") {
                cmd.enablePositionalOptions();
            }
            if (typeof cmd.passThroughOptions === "function") {
                cmd.passThroughOptions();
            }
            cmd.action(async (...actionArgs) => {
                const args = normalizeCliArgs(actionArgs[0]);
                await definition.run(args);
            });
        }
    }, { commands: ["clawvoice"] });
}
/**
 * Extract params from OpenClaw execute() call.
 * Modern API: execute(params: Record<string, unknown>)
 * Legacy API: execute(toolCallId: string, params: Record<string, unknown>)
 * Returns the first object-like argument, or {} if none found.
 */
function extractParams(...executeArgs) {
    for (const arg of executeArgs) {
        if (arg !== null && arg !== undefined && typeof arg === "object" && !Array.isArray(arg)) {
            return arg;
        }
    }
    return {};
}
function registerModernToolsBridge(api, config, callService, memoryService, skipNames) {
    const modernApi = api;
    if (typeof modernApi.registerTool !== "function") {
        return;
    }
    const capturedTools = [];
    const shimApi = {
        ...api,
        tools: {
            register(definition) {
                capturedTools.push(definition);
            },
        },
    };
    (0, tools_1.registerTools)(shimApi, config, callService, memoryService);
    const registeredNames = new Set();
    for (const tool of capturedTools) {
        // Skip tools already registered via the legacy api.tools.register path
        // to avoid duplicate tool entries in the OpenClaw runtime.
        if (skipNames?.has(tool.name))
            continue;
        if (registeredNames.has(tool.name))
            continue;
        registeredNames.add(tool.name);
        const handler = tool.handler;
        modernApi.registerTool({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            execute: handler
                ? async (...executeArgs) => handler(extractParams(...executeArgs))
                : undefined,
        }, { name: tool.name });
    }
}
/**
 * Wraps an Express-style route handler as a raw Node.js (IncomingMessage, ServerResponse) handler.
 * OpenClaw's modern registerHttpRoute / registerPluginHttpRoute use raw Node.js http types,
 * but routes.ts handlers expect Express-like req.body, res.status().json() etc.
 */
function wrapExpressHandler(expressHandler, method) {
    const MAX_BODY = 1048576; // 1 MB (M4)
    return async (req, res) => {
        if (method && req.method !== method) {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method Not Allowed" }));
            return;
        }
        const chunks = [];
        let totalSize = 0;
        for await (const chunk of req) {
            // Ensure Buffer for safety — some Node versions may yield non-Buffer chunks
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalSize += buf.length;
            if (totalSize > MAX_BODY) {
                res.writeHead(413, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Payload Too Large" }));
                return;
            }
            chunks.push(buf);
        }
        const rawBody = Buffer.concat(chunks).toString("utf8");
        let parsedBody = {};
        const ct = req.headers["content-type"] || "";
        if (ct.includes("application/json")) {
            try {
                parsedBody = JSON.parse(rawBody);
            }
            catch { /* ignore */ }
        }
        else if (ct.includes("application/x-www-form-urlencoded")) {
            parsedBody = Object.fromEntries(new URLSearchParams(rawBody));
        }
        const expressReq = Object.assign(req, {
            body: parsedBody,
            // Default to https — Twilio webhook signature validation requires the correct protocol,
            // and behind a reverse proxy/tunnel the connection is typically https.
            protocol: req.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim() || "https",
        });
        const expressRes = {
            _statusCode: 200,
            _headers: {},
            status(code) { this._statusCode = code; return this; },
            type(t) { this._headers["Content-Type"] = t; return this; },
            json(data) {
                res.writeHead(this._statusCode, { ...this._headers, "Content-Type": "application/json" });
                res.end(JSON.stringify(data));
            },
            send(data) {
                res.writeHead(this._statusCode, this._headers);
                res.end(data);
            },
        };
        try {
            await expressHandler(expressReq, expressRes);
        }
        catch (e) {
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
 * !! FRAGILE — INTERNAL MODULE PROBING !!
 *
 * This function probes OpenClaw's minified/bundled internal modules to locate
 * the `registerPluginHttpRoute` function. It is inherently fragile and may
 * break on new OpenClaw versions if the bundler renames exports or restructures
 * the dist output.
 *
 * Fallback chain:
 *   1. Try `mod.l` — the known minified export name in current versions.
 *   2. Search all single-letter exports for a function whose source contains
 *      "httpRoutes" and "pluginId" (heuristic signature match).
 *   3. If both fail, return null — the caller falls back to
 *      `api.registerHttpRoute` (which may not work in all runtimes) and the
 *      standalone webhook server on port 3101 handles webhooks regardless.
 *
 * This registers routes in the shared gateway HTTP registry (which the gateway
 * HTTP server actually dispatches from), unlike api.registerHttpRoute which
 * stores routes in a Pi-scoped registry that the gateway server never reads.
 */
async function resolveInternalRouteRegistrar(api) {
    try {
        const path = require("path");
        const fs = require("fs");
        // Locate the OpenClaw dist directory from the running process entry point
        let openclawDist = "";
        if (process.argv[1]) {
            let dir = path.dirname(process.argv[1]);
            for (let i = 0; i < 5; i++) {
                try {
                    const files = fs.readdirSync(dir);
                    if (files.some((f) => f.startsWith("webhook-ingress-") && f.endsWith(".js"))) {
                        openclawDist = dir;
                        break;
                    }
                }
                catch { /* skip */ }
                dir = path.dirname(dir);
            }
        }
        if (!openclawDist)
            return null;
        const webhookFiles = fs.readdirSync(openclawDist).filter((f) => f.startsWith("webhook-ingress-") && f.endsWith(".js"));
        if (webhookFiles.length === 0)
            return null;
        const { pathToFileURL } = require("url");
        // H4: Verify the resolved module path is inside the expected openclaw dist directory.
        // TRUST BOUNDARY: We only import from the openclaw dist directory found by
        // walking up from process.argv[1]. This prevents code injection via crafted paths.
        const resolvedChunkPath = path.resolve(openclawDist, webhookFiles[0]);
        const resolvedDistDir = path.resolve(openclawDist);
        if (!resolvedChunkPath.startsWith(resolvedDistDir + path.sep) && resolvedChunkPath !== resolvedDistDir) {
            return null;
        }
        const chunkUrl = pathToFileURL(resolvedChunkPath).href;
        const mod = await Promise.resolve(`${chunkUrl}`).then(s => __importStar(require(s)));
        // registerPluginHttpRoute is exported as 'l' in the bundled chunk
        if (typeof mod.l === "function")
            return mod.l;
        // Fallback: search all single-letter exports for the right signature
        for (const key of Object.keys(mod)) {
            if (typeof mod[key] === "function" && key.length === 1) {
                try {
                    const src = mod[key].toString();
                    if (src.includes("httpRoutes") && src.includes("pluginId"))
                        return mod[key];
                }
                catch { /* skip proxied/native functions */ }
            }
        }
    }
    catch { /* ignore */ }
    return null;
}
/**
 * Try to locate OpenClaw's enqueueSystemEvent for injecting messages into
 * the active conversation. Falls back to the api-level emitter if available.
 */
async function resolveSystemEventEmitter(api) {
    // Check if api exposes a system event emitter directly
    const rawApi = api;
    if (typeof rawApi.enqueueSystemEvent === "function") {
        return rawApi.enqueueSystemEvent;
    }
    if (rawApi.systemEvents && typeof rawApi.systemEvents.enqueue === "function") {
        return rawApi.systemEvents.enqueue;
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
                    const files = fs.readdirSync(dir);
                    if (files.some((f) => f.startsWith("system-events-") && f.endsWith(".js"))) {
                        openclawDist = dir;
                        break;
                    }
                }
                catch { /* skip */ }
                dir = path.dirname(dir);
            }
        }
        if (!openclawDist)
            return null;
        const sysEventFiles = fs.readdirSync(openclawDist).filter((f) => f.startsWith("system-events-") && f.endsWith(".js"));
        if (sysEventFiles.length === 0)
            return null;
        const { pathToFileURL } = require("url");
        // H4: Verify the resolved module path is inside the expected openclaw dist directory.
        // TRUST BOUNDARY: Same validation as resolveInternalRouteRegistrar.
        const resolvedChunkPath = path.resolve(openclawDist, sysEventFiles[0]);
        const resolvedDistDir = path.resolve(openclawDist);
        if (!resolvedChunkPath.startsWith(resolvedDistDir + path.sep) && resolvedChunkPath !== resolvedDistDir) {
            return null;
        }
        const chunkUrl = pathToFileURL(resolvedChunkPath).href;
        const mod = await Promise.resolve(`${chunkUrl}`).then(s => __importStar(require(s)));
        // Look for enqueueSystemEvent export
        if (typeof mod.enqueueSystemEvent === "function")
            return mod.enqueueSystemEvent;
        // Fallback: search single-letter exports
        for (const key of Object.keys(mod)) {
            if (typeof mod[key] === "function") {
                try {
                    const src = mod[key].toString();
                    if (src.includes("systemEvent") || src.includes("enqueueSystem"))
                        return mod[key];
                }
                catch { /* skip proxied/native functions */ }
            }
        }
    }
    catch { /* ignore */ }
    return null;
}
function registerModernRoutesBridge(api, config, callService) {
    const capturedRoutes = [];
    const shimApi = {
        ...api,
        http: {
            router(prefix) {
                return {
                    post(path, handler) {
                        capturedRoutes.push({ method: "POST", path: `${prefix}${path}`, handler });
                    },
                    get(path, handler) {
                        capturedRoutes.push({ method: "GET", path: `${prefix}${path}`, handler });
                    },
                };
            },
        },
    };
    (0, routes_1.registerRoutes)(shimApi, config, (record) => {
        callService.notifyInboundCall(record);
    }, (from, to, body, messageId) => {
        void callService.handleInboundSms(from, to, body, messageId).catch(() => undefined);
    }, (providerCallId, recordingUrl) => {
        callService.setRecordingUrl(providerCallId, recordingUrl);
    });
    // Try the internal gateway registry first; fall back to api.registerHttpRoute.
    // NOTE: This async registration is intentionally fire-and-forget. The standalone
    // webhook server on port 3101 is the primary webhook handler and works independently
    // of gateway route registration. These gateway routes are a bonus for environments
    // where the gateway dispatches plugin routes directly.
    resolveInternalRouteRegistrar(api)
        .then((internalRegister) => {
        const registerFn = internalRegister
            ?? (typeof api.registerHttpRoute === "function"
                ? (params) => api.registerHttpRoute(params)
                : null);
        if (!registerFn)
            return;
        for (const route of capturedRoutes) {
            registerFn({
                method: route.method,
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
function resolveLogger(api) {
    const raw = api;
    if (api.log && typeof api.log.info === "function")
        return api.log;
    if (raw.logger && typeof raw.logger.info === "function")
        return raw.logger;
    return {};
}
let initialized = false;
function initPlugin(api) {
    if (initialized)
        return;
    const logger = resolveLogger(api);
    // api.pluginConfig is the intended source, but some OpenClaw versions leave it
    // undefined and pass the full config as api.config.  Fall back through the
    // nested path plugins.entries.clawvoice.config before using the raw config.
    const rawCfg = api.config;
    const nestedPluginCfg = rawCfg?.plugins
        ?.entries?.clawvoice;
    const pluginCfg = api.pluginConfig ?? nestedPluginCfg?.config ?? api.config;
    const config = (0, config_1.resolveConfig)(pluginCfg);
    const validation = (0, config_1.validateConfig)(config);
    if (!validation.ok) {
        throw new Error(validation.errors.join("; "));
    }
    (0, health_1.runDiagnostics)(config).then((diagnostics) => {
        for (const check of diagnostics.checks) {
            if (check.status === "fail" || check.status === "warn") {
                logger.warn?.(`ClawVoice config ${check.status}: ${check.name}`, {
                    detail: check.detail,
                    remediation: check.remediation,
                });
            }
        }
    }).catch((err) => {
        logger.warn?.("ClawVoice diagnostics failed to complete", {
            error: err instanceof Error ? err.message : String(err),
        });
    });
    // Resolve workspace path for user profile and voice-memory access.
    // OpenClaw stores it at agents.defaults.workspace in the config.
    const rawApiConfig = api.config;
    const agentsDefaults = rawApiConfig?.agents
        ?.defaults;
    const workspacePath = (typeof rawApiConfig?.workspace === "string" ? rawApiConfig.workspace : undefined) ??
        (typeof agentsDefaults?.workspace === "string" ? agentsDefaults.workspace : undefined) ??
        (typeof rawApiConfig?.dataDir === "string" ? rawApiConfig.dataDir : undefined) ??
        (typeof rawApiConfig?.workspacePath === "string" ? rawApiConfig.workspacePath : undefined) ??
        (typeof process.env.OPENCLAW_WORKSPACE === "string" && process.env.OPENCLAW_WORKSPACE.length > 0
            ? process.env.OPENCLAW_WORKSPACE
            : undefined);
    const callService = new clawvoice_1.ClawVoiceService(config, undefined, workspacePath);
    const memoryService = new memory_extraction_1.MemoryExtractionService(config);
    // Wire filesystem-based memory writer for post-call transcript persistence
    if (workspacePath) {
        callService.postCall.setMemoryWriter(async (namespace, key, value) => {
            // M8: Whitelist key characters to prevent path traversal and injection
            if (!/^[a-zA-Z0-9\-_\/]+$/.test(key)) {
                throw new Error(`Invalid memory key: ${key}`);
            }
            if (key.includes("..") || key.startsWith("/") || key.startsWith("\\")) {
                throw new Error(`Invalid memory key: ${key}`);
            }
            const resolvedDir = path.resolve(workspacePath, namespace, path.dirname(key));
            const resolvedBase = path.resolve(workspacePath);
            if (!resolvedDir.startsWith(resolvedBase + path.sep) && resolvedDir !== resolvedBase) {
                throw new Error(`Memory key escapes workspace: ${key}`);
            }
            await fsp.mkdir(resolvedDir, { recursive: true });
            const filePath = path.join(workspacePath, namespace, `${key}.json`);
            await fsp.writeFile(filePath, JSON.stringify(value, null, 2));
            // Also write latest summary as markdown for easy agent access
            if (key.startsWith("calls/") && typeof value === "object" && value !== null) {
                const record = value;
                const summaryPath = path.join(workspacePath, namespace, "latest-summary.md");
                const lines = [];
                lines.push(`# Latest Call Summary`);
                lines.push(`- **Call ID:** ${record.callId ?? "unknown"}`);
                lines.push(`- **Outcome:** ${record.outcome ?? "unknown"}`);
                lines.push(`- **Duration:** ${Math.round((record.durationMs ?? 0) / 1000)}s`);
                lines.push(`- **Completed:** ${record.completedAt ?? "unknown"}`);
                const transcript = record.transcript;
                if (transcript && transcript.length > 0) {
                    lines.push(`\n## Transcript (${transcript.length} turns)`);
                    for (const entry of transcript) {
                        const role = entry.speaker === "agent" ? "Agent" : "Callee";
                        lines.push(`> **${role}:** ${entry.text}`);
                    }
                }
                await fsp.writeFile(summaryPath, lines.join("\n") + "\n");
            }
        });
    }
    // Wire system event emitter for immediate post-call summary delivery
    // and inbound call/SMS notifications
    resolveSystemEventEmitter(api)
        .then((emitter) => {
        if (emitter) {
            callService.postCall.setSystemEventEmitter(emitter);
            callService.setSystemEventEmitter(emitter);
        }
    })
        .catch(() => undefined);
    // Wire Telegram notification sender for post-call summaries.
    // Reads bot token and owner chat ID from the OpenClaw config (channels.telegram).
    const channelsCfg = rawApiConfig?.channels;
    const telegramCfg = channelsCfg?.telegram;
    const botToken = typeof telegramCfg?.botToken === "string" ? telegramCfg.botToken : undefined;
    // Resolve owner chat ID from telegram-default-allowFrom.json (paired DM users)
    if (botToken && config.notifyTelegram) {
        let ownerChatId;
        try {
            const allowFromPath = path.join(process.env.OPENCLAW_STATE_DIR || path.dirname(process.env.OPENCLAW_CONFIG_PATH || ""), "credentials", "telegram-default-allowFrom.json");
            const allowFromData = JSON.parse(fs.readFileSync(allowFromPath, "utf8"));
            ownerChatId = allowFromData.allowFrom?.[0];
        }
        catch { /* ignore — file may not exist */ }
        if (ownerChatId) {
            callService.postCall.setNotificationSender(async (notification) => {
                const botUrl = `https://api.telegram.org/bot${botToken}`;
                try {
                    // Send the summary message
                    const summaryResp = await globalThis.fetch(`${botUrl}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chat_id: ownerChatId,
                            text: `\u{1F4DE} ${notification.text}`,
                            parse_mode: "HTML",
                        }),
                    });
                    if (!summaryResp.ok) {
                        const body = await summaryResp.text().catch(() => "");
                        throw new Error(`sendMessage failed (${summaryResp.status}): ${body}`);
                    }
                    // Send transcript file attachment if available
                    if (notification.file) {
                        const boundary = `----ClawVoice${(await Promise.resolve().then(() => __importStar(require("crypto")))).randomUUID()}`;
                        const fileBuf = Buffer.from(notification.file.content, "utf8");
                        const body = Buffer.concat([
                            Buffer.from(`--${boundary}\r\n` +
                                `Content-Disposition: form-data; name="chat_id"\r\n\r\n${ownerChatId}\r\n` +
                                `--${boundary}\r\n` +
                                `Content-Disposition: form-data; name="caption"\r\n\r\nCall transcript\r\n` +
                                `--${boundary}\r\n` +
                                `Content-Disposition: form-data; name="document"; filename="${notification.file.name.replace(/["\r\n]/g, "")}"\r\n` +
                                `Content-Type: ${notification.file.mimeType}\r\n\r\n`),
                            fileBuf,
                            Buffer.from(`\r\n--${boundary}--\r\n`),
                        ]);
                        const documentResp = await globalThis.fetch(`${botUrl}/sendDocument`, {
                            method: "POST",
                            headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
                            body,
                        });
                        if (!documentResp.ok) {
                            const respBody = await documentResp.text().catch(() => "");
                            throw new Error(`sendDocument failed (${documentResp.status}): ${respBody}`);
                        }
                    }
                }
                catch { /* best-effort delivery */ }
            });
        }
    }
    void callService.start().catch((error) => {
        logger.error?.("ClawVoice call service failed to start", {
            error: error instanceof Error ? error.message : String(error),
        });
    });
    // Register tools via BOTH legacy and modern paths to ensure visibility.
    // The legacy api.tools.register may exist but not actually expose tools to the
    // agent session in modern OpenClaw runtimes. The modern registerTool bridge
    // ensures tools appear in the agent's tool list.
    const legacyToolNames = new Set();
    const toolsRegister = api.tools?.register;
    if (typeof toolsRegister === "function") {
        // Wrap register to capture tool names for dedup in the modern bridge
        const origRegister = api.tools.register.bind(api.tools);
        api.tools.register = ((def) => {
            legacyToolNames.add(def.name);
            return origRegister(def);
        });
        (0, tools_1.registerTools)(api, config, callService, memoryService);
        api.tools.register = origRegister; // restore
    }
    registerModernToolsBridge(api, config, callService, memoryService, legacyToolNames);
    const cliRegister = api.cli?.register;
    if (typeof cliRegister === "function") {
        (0, cli_1.registerCLI)(api, config, callService, memoryService, workspacePath);
    }
    else {
        registerModernCliBridge(api, config, callService, memoryService, workspacePath);
    }
    const httpRouter = api.http?.router;
    if (typeof httpRouter === "function") {
        (0, routes_1.registerRoutes)(api, config, (record) => {
            callService.notifyInboundCall(record);
        }, (from, to, body, messageId) => {
            void callService.handleInboundSms(from, to, body, messageId).catch(() => undefined);
        }, (providerCallId, recordingUrl) => {
            callService.setRecordingUrl(providerCallId, recordingUrl);
        });
    }
    else {
        registerModernRoutesBridge(api, config, callService);
    }
    const hooksOn = api.hooks?.on;
    if (typeof hooksOn === "function") {
        (0, hooks_1.registerHooks)(api, config);
    }
    const servicesRegister = api.services?.register;
    if (typeof servicesRegister === "function") {
        api.services.register("clawvoice-calls", callService);
    }
    initialized = true;
    logger.info?.("ClawVoice initialized", {
        telephonyProvider: config.telephonyProvider,
        voiceProvider: config.voiceProvider,
        inboundEnabled: config.inboundEnabled,
    });
}
const plugin = {
    name: "clawvoice",
    async init(api) {
        initPlugin(api);
    },
    register(api) {
        initPlugin(api);
    },
    activate(api) {
        initPlugin(api);
    },
};
function activate(api) {
    initPlugin(api);
}
function register(api) {
    initPlugin(api);
}
function _resetForTesting() {
    initialized = false;
}
exports.default = plugin;
