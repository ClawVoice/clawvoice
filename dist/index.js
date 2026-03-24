"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.register = register;
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
function registerModernCliBridge(api, config, callService, memoryService) {
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
    (0, cli_1.registerCLI)(shimApi, config, callService, memoryService);
    if (legacyCommands.length === 0) {
        return;
    }
    modernApi.registerCli(({ program }) => {
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
                .action(async (...actionArgs) => {
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
function registerModernToolsBridge(api, config, callService, memoryService) {
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
    for (const tool of capturedTools) {
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
 * Adapt an Express-style route handler to raw Node.js (IncomingMessage, ServerResponse).
 *
 * OpenClaw's modern registerHttpRoute API passes raw Node.js objects, but our
 * route handlers (in routes.ts) expect Express-like req.body, res.status().json(), etc.
 * This adapter reads/parses the body and shims the response methods.
 */
function adaptExpressToNode(expressHandler) {
    return async (req, res) => {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        const contentType = (req.headers["content-type"] ?? "").toLowerCase();
        let body;
        if (contentType.includes("application/json")) {
            try {
                body = JSON.parse(rawBody);
            }
            catch {
                body = rawBody;
            }
        }
        else if (contentType.includes("application/x-www-form-urlencoded")) {
            // Twilio sends form-urlencoded webhooks
            const entries = new URLSearchParams(rawBody);
            const obj = {};
            for (const [key, value] of entries) {
                obj[key] = value;
            }
            body = obj;
        }
        else {
            body = rawBody;
        }
        const shimReq = {
            body,
            headers: req.headers,
            protocol: req.headers["x-forwarded-proto"]?.split(",")[0]?.trim() ?? "https",
            url: req.url,
        };
        let statusCode = 200;
        let responseSent = false;
        const shimRes = {
            status(code) {
                statusCode = code;
                return shimRes;
            },
            json(value) {
                if (responseSent)
                    return;
                responseSent = true;
                const payload = JSON.stringify(value);
                res.writeHead(statusCode, { "Content-Type": "application/json" });
                res.end(payload);
            },
            send(payload) {
                if (responseSent)
                    return;
                responseSent = true;
                res.writeHead(statusCode, { "Content-Type": "text/plain" });
                res.end(payload ?? "");
            },
            type(ct) {
                return {
                    send(payload) {
                        if (responseSent)
                            return;
                        responseSent = true;
                        res.writeHead(statusCode, { "Content-Type": ct });
                        res.end(payload);
                    },
                };
            },
        };
        try {
            await expressHandler(shimReq, shimRes);
        }
        catch (err) {
            if (!responseSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal server error" }));
            }
        }
    };
}
function registerModernRoutesBridge(api, config, callService) {
    const modernApi = api;
    if (typeof modernApi.registerHttpRoute !== "function") {
        console.warn("[clawvoice] registerHttpRoute not available — webhook routes will not be registered");
        return;
    }
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
        callService.trackInboundCall(record);
    }, (from, to, body, messageId) => {
        callService.trackInboundText(from, to, body, messageId);
    });
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
function resolveLogger(api) {
    const raw = api;
    if (api.log && typeof api.log.info === "function")
        return api.log;
    if (raw.logger && typeof raw.logger.info === "function")
        return raw.logger;
    return {};
}
function initPlugin(api) {
    const logger = resolveLogger(api);
    // OpenClaw may provide plugin config at api.pluginConfig, or nested inside
    // the full config at api.config.plugins.entries.clawvoice.config.
    // Fall back to api.config for backward compatibility.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fullCfg = api.config;
    const pluginCfg = api.pluginConfig
        ?? fullCfg?.plugins?.entries?.clawvoice?.config
        ?? api.config;
    const config = (0, config_1.resolveConfig)(pluginCfg);
    const validation = (0, config_1.validateConfig)(config);
    if (!validation.ok) {
        throw new Error(validation.errors.join("; "));
    }
    const diagnostics = (0, health_1.runDiagnostics)(config);
    for (const check of diagnostics.checks) {
        if (check.status === "fail" || check.status === "warn") {
            logger.warn?.(`ClawVoice config ${check.status}: ${check.name}`, {
                detail: check.detail,
                remediation: check.remediation,
            });
        }
    }
    const callService = new clawvoice_1.ClawVoiceService(config);
    const memoryService = new memory_extraction_1.MemoryExtractionService(config);
    void callService.start().catch((error) => {
        console.error("[clawvoice] start error:", error instanceof Error ? error.stack : String(error));
        logger.error?.("ClawVoice call service failed to start", {
            error: error instanceof Error ? error.message : String(error),
        });
    });
    const toolsRegister = api.tools?.register;
    if (typeof toolsRegister === "function") {
        (0, tools_1.registerTools)(api, config, callService, memoryService);
    }
    else {
        registerModernToolsBridge(api, config, callService, memoryService);
    }
    const cliRegister = api.cli?.register;
    if (typeof cliRegister === "function") {
        (0, cli_1.registerCLI)(api, config, callService, memoryService);
    }
    else {
        registerModernCliBridge(api, config, callService, memoryService);
    }
    const httpRouter = api.http?.router;
    if (typeof httpRouter === "function") {
        console.error("[clawvoice] using legacy route registration (api.http.router)");
        (0, routes_1.registerRoutes)(api, config, (record) => {
            callService.trackInboundCall(record);
        }, (from, to, body, messageId) => {
            callService.trackInboundText(from, to, body, messageId);
        });
    }
    else {
        console.error("[clawvoice] using modern route registration (registerHttpRoute)");
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
exports.default = plugin;
