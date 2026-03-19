# ClawVoice - OpenClaw Plugin Implementation Guide

Technical reference for implementing ClawVoice as an OpenClaw plugin. This document covers the plugin SDK, registration patterns, and how each ClawVoice component maps to OpenClaw's extension points.

## OpenClaw Plugin System Overview

OpenClaw plugins are TypeScript modules loaded at runtime via [jiti](https://github.com/unjs/jiti). A plugin can register:

- **Tools** (actions the agent can invoke)
- **CLI commands** (user-facing terminal commands)
- **RPC methods** (machine-to-machine API)
- **HTTP routes** (webhook endpoints)
- **Background services** (long-running processes)
- **Hooks** (lifecycle event listeners)
- **Skills** (agent knowledge documents)
- **Channels** (communication interfaces like voice, SMS)

## Plugin Manifest

Every plugin needs an `openclaw.plugin.json` at the package root.

### ClawVoice Manifest

```json
{
"id": "clawvoice",
  "name": "ClawVoice",
  "description": "Voice calling for OpenClaw agents. Inbound and outbound phone calls with Deepgram Voice Agent or ElevenLabs Conversational AI.",
  "version": "0.1.0",
  "kind": "channel",
  "channels": ["voice"],
"skills": ["clawvoice"],
  "entryPoint": "dist/index.js",
  "configSchema": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["self-hosted", "managed"],
        "default": "self-hosted",
        "description": "Operating mode. self-hosted=BYOK, managed=ClawVoice service."
      },
      "serviceToken": {
        "type": "string",
        "description": "Managed service authentication token."
      },
      "telephonyProvider": {
        "type": "string",
        "enum": ["telnyx", "twilio"],
        "default": "twilio",
        "description": "PSTN telephony provider."
      },
      "voiceProvider": {
        "type": "string",
        "enum": ["deepgram-agent", "elevenlabs-conversational"],
        "default": "deepgram-agent",
        "description": "Voice pipeline provider."
      },
      "telnyxApiKey": { "type": "string" },
      "telnyxConnectionId": { "type": "string" },
      "telnyxPhoneNumber": { "type": "string" },
      "telnyxWebhookSecret": { "type": "string" },
      "twilioAccountSid": { "type": "string" },
      "twilioAuthToken": { "type": "string" },
      "twilioPhoneNumber": { "type": "string" },
      "deepgramApiKey": { "type": "string" },
      "deepgramVoice": {
        "type": "string",
        "default": "aura-asteria-en",
        "description": "Default Deepgram Aura voice ID."
      },
      "elevenlabsApiKey": { "type": "string" },
      "elevenlabsAgentId": { "type": "string" },
      "elevenlabsVoiceId": { "type": "string" },
      "openaiApiKey": {
        "type": "string",
        "description": "Optional. For dedicated post-call analysis model."
      },
      "analysisModel": {
        "type": "string",
        "default": "gpt-4o-mini"
      },
      "mainMemoryAccess": {
        "type": "string",
        "enum": ["read", "none"],
        "default": "read",
        "description": "Can voice sessions read main MEMORY.md?"
      },
      "autoExtractMemories": {
        "type": "boolean",
        "default": true
      },
      "restrictTools": {
        "type": "boolean",
        "default": true
      },
      "deniedTools": {
        "type": "array",
        "items": { "type": "string" },
        "default": ["exec", "browser", "web_fetch", "gateway", "cron", "sessions_spawn"]
      },
      "amdEnabled": {
        "type": "boolean",
        "default": true,
        "description": "Answering machine detection for outbound calls."
      },
      "maxCallDuration": {
        "type": "number",
        "default": 1800,
        "description": "Maximum call duration in seconds."
      },
      "recordCalls": {
        "type": "boolean",
        "default": false
      },
      "relayUrl": {
        "type": "string",
        "default": "wss://relay.clawvoice.dev"
      }
    },
    "required": []
  }
}
```

### Key Manifest Fields

| Field | Purpose |
|-------|---------|
| `id` | Unique plugin identifier. Convention: `org/name`. |
| `kind` | Plugin category. `"channel"` for communication plugins. |
| `channels` | Array of channel types this plugin provides. `["voice"]` |
| `skills` | Agent skills this plugin ships. References `skills/clawvoice/SKILL.md` |
| `entryPoint` | Compiled JS entry point (TypeScript compiled to dist/) |
| `configSchema` | JSON Schema for plugin configuration. Users set values via `openclaw config set clawvoice.*` or environment variables. |

## Plugin Entry Point

`src/index.ts` is the main registration file. OpenClaw calls the default export function with a plugin API object.

### Structure

```typescript
import { Plugin, PluginAPI } from "@openclaw/plugin-sdk";

// Import our components
import { registerTools } from "./tools";
import { registerCLI } from "./cli";
import { registerRoutes } from "./routes";
import { registerHooks } from "./hooks";
import { VoiceCallService } from "./services/voice-call";
import { WebSocketRelayService } from "./services/relay";
import { resolveConfig, ClawVoiceConfig } from "./config";

const plugin: Plugin = {
  name: "clawvoice",

  async init(api: PluginAPI) {
    // Resolve configuration from configSchema + env vars
    const config = resolveConfig(api.config);

    // Register tools (agent actions)
    registerTools(api, config);

    // Register CLI commands
    registerCLI(api, config);

    // Register HTTP routes (webhooks from Telnyx/Twilio)
    registerRoutes(api, config);

    // Register lifecycle hooks
    registerHooks(api, config);

    // Start background services
    if (config.mode === "managed") {
      api.services.register("clawvoice-relay", new WebSocketRelayService(config));
    }
    api.services.register("clawvoice-calls", new VoiceCallService(config));

    api.log.info("ClawVoice initialized", {
      mode: config.mode,
      telephony: config.telephonyProvider,
      voice: config.voiceProvider,
    });
  },
};

export default plugin;
```

## Tool Registration

Tools are actions the OpenClaw agent can invoke during conversation. ClawVoice registers four tools.

### Registration Pattern

```typescript
// src/tools.ts
import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";

export function registerTools(api: PluginAPI, config: ClawVoiceConfig) {
// clawvoice_call - Initiate outbound phone call
  api.tools.register({
name: "clawvoice_call",
    description: "Call a phone number. The agent will have a voice conversation with the person who answers.",
    parameters: {
      type: "object",
      properties: {
        phoneNumber: {
          type: "string",
          description: "Phone number to call in E.164 format (e.g., +15551234567)",
        },
        purpose: {
          type: "string",
          description: "Brief description of why you're calling (used as context for the voice agent)",
        },
        voice: {
          type: "string",
          description: "Voice to use. Options: aura-asteria-en, aura-luna-en, aura-orion-en, aura-arcas-en",
          default: config.deepgramVoice,
        },
      },
      required: ["phoneNumber"],
    },
    handler: async (params, ctx) => {
      // ctx provides: session, memory, agent context
      const result = await initiateOutboundCall(params, config, ctx);
      return {
        content: result.summary,
        data: result,
      };
    },
  });

// clawvoice_hangup - End an active call
  api.tools.register({
name: "clawvoice_hangup",
    description: "End an active phone call.",
    parameters: {
      type: "object",
      properties: {
        callId: {
          type: "string",
          description: "The call ID to hang up. If omitted, hangs up the most recent active call.",
        },
      },
    },
    handler: async (params, ctx) => {
      const result = await hangupCall(params.callId, config);
      return { content: result.message };
    },
  });

// clawvoice_status - Get call status
  api.tools.register({
name: "clawvoice_status",
    description: "Get the status of active and recent phone calls.",
    parameters: {
      type: "object",
      properties: {},
    },
    handler: async (_params, ctx) => {
      const status = await getCallStatus(config);
      return { content: formatCallStatus(status) };
    },
  });

// clawvoice_promote_memory - Promote voice memory to main
  api.tools.register({
name: "clawvoice_promote_memory",
    description: "Review and promote a voice memory to main MEMORY.md. Requires operator confirmation.",
    parameters: {
      type: "object",
      properties: {
        memoryId: {
          type: "string",
          description: "ID of the voice memory entry to promote.",
        },
      },
      required: ["memoryId"],
    },
    handler: async (params, ctx) => {
      const result = await promoteVoiceMemory(params.memoryId, ctx);
      return { content: result.message };
    },
  });
}
```

### Tool Handler Context

The `ctx` parameter in tool handlers provides:

```typescript
interface ToolContext {
  session: {
    id: string;
    channel: string;       // "voice", "text", "discord", etc.
    peerId: string;        // Phone number for voice
  };
  memory: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    append(path: string, content: string): Promise<void>;
  };
  agent: {
    model: string;
    systemPrompt: string;
  };
  log: Logger;
}
```

## CLI Command Registration

CLI commands let users interact with ClawVoice from the terminal.

```typescript
// src/cli.ts
import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";

export function registerCLI(api: PluginAPI, config: ClawVoiceConfig) {
  const clawvoice = api.cli.register("clawvoice", {
    description: "Voice calling for OpenClaw",
  });

  // openclaw clawvoice setup
  clawvoice.command("setup", {
    description: "Set up ClawVoice (configure providers or connect to managed service)",
    options: {
      token: { type: "string", description: "Managed service token" },
    },
    handler: async (args) => {
      if (args.token) {
        await setupManagedService(args.token, config);
      } else {
        await interactiveSetup(config);
      }
    },
  });

  // openclaw clawvoice call <number>
  clawvoice.command("call", {
    description: "Initiate an outbound phone call",
    args: [{ name: "number", required: true, description: "Phone number to call" }],
    handler: async (args) => {
      const result = await initiateOutboundCall(
        { phoneNumber: args.number },
        config,
        null // no agent context for CLI calls
      );
      console.log(`Call initiated: ${result.callId}`);
    },
  });

  // openclaw clawvoice status
  clawvoice.command("status", {
    description: "Show active calls and configuration status",
    handler: async () => {
      const status = await getCallStatus(config);
      printCallStatus(status);
    },
  });

  // openclaw clawvoice promote
  clawvoice.command("promote", {
    description: "Review and promote voice memories to main MEMORY.md",
    handler: async () => {
      await interactiveMemoryPromotion(config);
    },
  });

  // openclaw clawvoice history
  clawvoice.command("history", {
    description: "Show recent call history",
    options: {
      limit: { type: "number", default: 10, description: "Number of calls to show" },
    },
    handler: async (args) => {
      const history = await getCallHistory(config, args.limit);
      printCallHistory(history);
    },
  });

  // openclaw clawvoice test
  clawvoice.command("test", {
    description: "Test voice pipeline connectivity",
    handler: async () => {
      await testConnectivity(config);
    },
  });
}
```

## HTTP Route Registration

The plugin needs HTTP endpoints for telephony provider webhooks (Telnyx/Twilio call events).

```typescript
// src/routes.ts
import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import { handleTelnyxWebhook, verifyTelnyxSignature } from "./telephony/telnyx";
import { handleTwilioWebhook, verifyTwilioSignature } from "./telephony/twilio";

export function registerRoutes(api: PluginAPI, config: ClawVoiceConfig) {
  const router = api.http.router("/clawvoice");

  // Telnyx call event webhooks
  router.post("/webhooks/telnyx", async (req, res) => {
    // Verify webhook signature
    if (config.telnyxWebhookSecret) {
      const valid = verifyTelnyxSignature(req, config.telnyxWebhookSecret);
      if (!valid) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    const event = req.body;
    await handleTelnyxWebhook(event, config);
    res.status(200).json({ ok: true });
  });

  // Twilio call event webhooks (fallback provider)
  router.post("/webhooks/twilio/voice", async (req, res) => {
    if (!verifyTwilioSignature(req, config.twilioAuthToken)) {
      res.status(401).send("Invalid signature");
      return;
    }

    const twiml = await handleTwilioWebhook(req.body, config);
    res.type("text/xml").send(twiml);
  });

  // Twilio status callback
  router.post("/webhooks/twilio/status", async (req, res) => {
    await handleTwilioStatusCallback(req.body, config);
    res.status(200).send();
  });

  // Call status API (for dashboard / external integrations)
  router.get("/calls", async (req, res) => {
    const calls = await getRecentCalls(config);
    res.json({ calls });
  });

  // Voice memory review API (for dashboard)
  router.get("/voice-memories", async (req, res) => {
    const memories = await getPendingVoiceMemories(config);
    res.json({ memories });
  });

  router.post("/voice-memories/:id/promote", async (req, res) => {
    const result = await promoteVoiceMemory(req.params.id);
    res.json(result);
  });
}
```

### Webhook URL Configuration

For self-hosted mode, users need to expose their OpenClaw gateway publicly (or use a tunnel) so Telnyx/Twilio can reach the webhook endpoints:

```
https://your-openclaw-gateway.com/clawvoice/webhooks/telnyx
https://your-openclaw-gateway.com/clawvoice/webhooks/twilio/voice
```

For managed mode, the relay server handles webhooks and forwards events through the outbound WebSocket — no public endpoint needed.

## Hook Registration

Hooks let the plugin intercept OpenClaw lifecycle events. Critical for voice memory isolation.

```typescript
// src/hooks.ts
import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import { buildVoiceMemoryContext } from "./memory/voice-namespace";
import { buildVoiceSecurityPolicy } from "./security";

export function registerHooks(api: PluginAPI, config: ClawVoiceConfig) {

  // Inject voice memory context before the agent prompt is built
  api.hooks.on("before_prompt_build", async (event, ctx) => {
    if (!isVoiceSession(ctx)) return;

    const voiceMemory = await buildVoiceMemoryContext(ctx, config);
    const mainMemorySnippet = config.mainMemoryAccess === "read"
      ? await ctx.memory.read("MEMORY.md")
      : null;

    return {
      appendSystemContext: [
        "## Voice Memory",
        voiceMemory,
        ...(mainMemorySnippet
          ? ["## Main Memory (read-only)", mainMemorySnippet]
          : []),
        "",
        "IMPORTANT: You are in a voice call. Keep responses concise and conversational.",
        "You can only write memories to voice-memory/. You cannot modify main MEMORY.md.",
      ].join("\n"),
    };
  });

  // Restrict tool access for voice sessions
  api.hooks.on("before_tool_execute", async (event, ctx) => {
    if (!isVoiceSession(ctx)) return;
    if (!config.restrictTools) return;

    const deniedTools = config.deniedTools || [
      "exec", "browser", "web_fetch", "gateway", "cron", "sessions_spawn"
    ];

    if (deniedTools.includes(event.toolName)) {
      return {
        blocked: true,
        reason: `Tool "${event.toolName}" is not available during voice calls for security.`,
      };
    }
  });

  // Intercept memory writes from voice sessions
  api.hooks.on("before_memory_write", async (event, ctx) => {
    if (!isVoiceSession(ctx)) return;

    // Redirect writes to voice-memory/ namespace
    if (!event.path.startsWith("voice-memory/")) {
      return {
        redirectPath: `voice-memory/${event.path}`,
      };
    }
  });

  // After a voice call ends, run post-call analysis
  api.hooks.on("after_session_end", async (event, ctx) => {
    if (!isVoiceSession(ctx)) return;

    await runPostCallAnalysis(ctx, config);
  });
}

function isVoiceSession(ctx: any): boolean {
  return ctx.session?.channel === "voice";
}
```

### Available Hooks

| Hook | When | Use in ClawVoice |
|------|------|-----------------|
| `before_prompt_build` | Before system prompt is assembled | Inject voice memory, voice-specific instructions |
| `before_tool_execute` | Before any tool runs | Block restricted tools in voice sessions |
| `before_memory_write` | Before memory file is written | Redirect voice writes to voice-memory/ namespace |
| `after_session_end` | After a conversation session closes | Run post-call analysis, extract memories |
| `after_response` | After agent sends a response | Log voice interactions for transcript |
| `on_error` | When an error occurs | Handle voice pipeline errors gracefully |

## Background Services

Long-running processes that operate independently of request/response cycles.

### Voice Call Service

Manages active calls, maintains WebSocket connections to voice providers.

```typescript
// src/services/voice-call.ts
import { Service } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "../config";

export class VoiceCallService implements Service {
  private activeCalls = new Map<string, ActiveCall>();
  private config: ClawVoiceConfig;

  constructor(config: ClawVoiceConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    // Initialize telephony provider connection
    // Set up event listeners for incoming calls
    // Start health check interval
  }

  async stop(): Promise<void> {
    // Gracefully end all active calls
    // Close WebSocket connections
    // Clean up resources
  }

  async initiateCall(params: CallParams): Promise<CallResult> {
    // 1. Validate phone number
    // 2. Create call via telephony provider (Telnyx/Twilio)
    // 3. Set up voice provider WebSocket (Deepgram/ElevenLabs)
    // 4. Bridge telephony audio <-> voice provider
    // 5. Track in activeCalls map
  }

  async hangup(callId: string): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) throw new Error(`No active call: ${callId}`);
    // End call via telephony provider
    // Close voice provider WebSocket
    // Run post-call analysis
    // Clean up
  }
}
```

### WebSocket Relay Service (Managed Mode)

For managed service users, this service connects outbound to ClawVoice relay servers.

```typescript
// src/services/relay.ts
import { Service } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "../config";
import WebSocket from "ws";

export class WebSocketRelayService implements Service {
  private ws: WebSocket | null = null;
  private config: ClawVoiceConfig;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(config: ClawVoiceConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    await this.connect();
  }

  private async connect(): Promise<void> {
    const url = `${this.config.relayUrl}?token=${this.config.serviceToken}`;

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      // Authenticate with relay server
      // Report capabilities (voice provider, available tools)
      // Ready to receive call events
    });

    this.ws.on("message", async (data) => {
      const event = JSON.parse(data.toString());
      // Handle relay events:
      // - "incoming_call": New inbound call to process
      // - "call_audio": Audio chunk from active call
      // - "call_ended": Call ended, run post-processing
      // - "config_update": Service config changed
    });

    this.ws.on("close", () => {
      // Reconnect with exponential backoff
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
```

## Voice Memory Namespace Implementation

The core differentiator. Voice calls write to an isolated namespace.

### File Structure

```
~/.openclaw/workspace/
  MEMORY.md                    # Main memory (text channels write here)
  memory/
    2026-03-11.md              # Main daily log
  voice-memory/                # Voice-only namespace (created by plugin)
    VOICE-MEMORY.md            # Curated voice long-term memory
    2026-03-11.md              # Voice daily log
    calls/
      call-abc123.md           # Individual call transcript + analysis
```

### Implementation

```typescript
// src/memory/voice-namespace.ts
import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "../config";
import path from "path";
import fs from "fs/promises";

const VOICE_MEMORY_DIR = "voice-memory";
const VOICE_MEMORY_FILE = "voice-memory/VOICE-MEMORY.md";

export async function ensureVoiceMemoryDir(workspacePath: string): Promise<void> {
  const voiceDir = path.join(workspacePath, VOICE_MEMORY_DIR);
  await fs.mkdir(voiceDir, { recursive: true });
  await fs.mkdir(path.join(voiceDir, "calls"), { recursive: true });

  // Create VOICE-MEMORY.md if it doesn't exist
  const memFile = path.join(workspacePath, VOICE_MEMORY_FILE);
  try {
    await fs.access(memFile);
  } catch {
    await fs.writeFile(memFile, "# Voice Memory\n\nCurated memories from voice calls.\n");
  }
}

export async function buildVoiceMemoryContext(
  ctx: any,
  config: ClawVoiceConfig
): Promise<string> {
  const workspace = ctx.workspace.path;
  await ensureVoiceMemoryDir(workspace);

  // Read voice long-term memory
  const voiceMemory = await safeRead(path.join(workspace, VOICE_MEMORY_FILE));

  // Read today's voice log
  const today = new Date().toISOString().split("T")[0];
  const todayLog = await safeRead(
    path.join(workspace, VOICE_MEMORY_DIR, `${today}.md`)
  );

  return [voiceMemory, todayLog ? `\n## Today's Voice Log\n${todayLog}` : ""].join("\n");
}

export async function writeCallTranscript(
  workspacePath: string,
  callId: string,
  transcript: string,
  analysis: CallAnalysis
): Promise<void> {
  const callFile = path.join(workspacePath, VOICE_MEMORY_DIR, "calls", `${callId}.md`);
  const today = new Date().toISOString().split("T")[0];
  const dailyLog = path.join(workspacePath, VOICE_MEMORY_DIR, `${today}.md`);

  // Write full call record
  const callContent = [
    `# Call ${callId}`,
    `Date: ${new Date().toISOString()}`,
    `Duration: ${analysis.duration}s`,
    "",
    "## Summary",
    analysis.summary,
    "",
    "## Mood",
    analysis.mood,
    "",
    "## Topics",
    analysis.topics.map((t: string) => `- ${t}`).join("\n"),
    "",
    "## Action Items",
    analysis.actionItems.map((a: string) => `- [ ] ${a}`).join("\n"),
    "",
    "## Transcript",
    transcript,
  ].join("\n");

  await fs.writeFile(callFile, callContent);

  // Append summary to daily log
  const logEntry = [
    `### ${new Date().toLocaleTimeString()} - Call ${callId}`,
    analysis.summary,
    analysis.actionItems.length > 0
      ? `Action items: ${analysis.actionItems.join(", ")}`
      : "",
    "",
  ].join("\n");

  await fs.appendFile(dailyLog, logEntry);
}

async function safeRead(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}
```

### Memory Promotion

```typescript
// src/memory/promotion.ts
import fs from "fs/promises";
import path from "path";

interface VoiceMemoryEntry {
  id: string;
  date: string;
  callId: string;
  content: string;
  status: "pending" | "promoted" | "rejected";
}

export async function getPendingMemories(workspacePath: string): Promise<VoiceMemoryEntry[]> {
  // Scan voice-memory/calls/ for entries not yet promoted
  // Return list with metadata
}

export async function promoteMemory(
  workspacePath: string,
  memoryId: string,
  content: string
): Promise<void> {
  const mainMemory = path.join(workspacePath, "MEMORY.md");
  const existing = await fs.readFile(mainMemory, "utf-8");

  // Append promoted memory with provenance tag
  const entry = [
    "",
    `<!-- Promoted from voice-memory, call ${memoryId}, ${new Date().toISOString()} -->`,
    content,
  ].join("\n");

  await fs.appendFile(mainMemory, entry);

  // Mark as promoted in voice-memory
  // ...
}

export async function rejectMemory(
  workspacePath: string,
  memoryId: string
): Promise<void> {
  // Move to voice-memory/archived/
  // Mark as rejected
}
```

## Config Resolution

Plugin config can come from multiple sources. Resolution order:

1. Environment variables (highest priority)
2. `openclaw config set clawvoice.*` values
3. `configSchema` defaults (lowest priority)

```typescript
// src/config.ts

export interface ClawVoiceConfig {
  mode: "self-hosted" | "managed";
  serviceToken?: string;
  telephonyProvider: "telnyx" | "twilio";
  voiceProvider: "deepgram-agent" | "elevenlabs-conversational";
  telnyxApiKey?: string;
  telnyxConnectionId?: string;
  telnyxPhoneNumber?: string;
  telnyxWebhookSecret?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  deepgramApiKey?: string;
  deepgramVoice: string;
  elevenlabsApiKey?: string;
  elevenlabsAgentId?: string;
  elevenlabsVoiceId?: string;
  openaiApiKey?: string;
  analysisModel: string;
  mainMemoryAccess: "read" | "none";
  autoExtractMemories: boolean;
  restrictTools: boolean;
  deniedTools: string[];
  amdEnabled: boolean;
  maxCallDuration: number;
  recordCalls: boolean;
  relayUrl: string;
}

export function resolveConfig(pluginConfig: Record<string, any>): ClawVoiceConfig {
  return {
    mode: env("CLAWVOICE_MODE") || pluginConfig.mode || "self-hosted",
    serviceToken: env("CLAWVOICE_SERVICE_TOKEN") || pluginConfig.serviceToken,
    telephonyProvider: env("CLAWVOICE_TELEPHONY_PROVIDER") || pluginConfig.telephonyProvider || "telnyx",
    voiceProvider: env("CLAWVOICE_VOICE_PROVIDER") || pluginConfig.voiceProvider || "deepgram-agent",
    telnyxApiKey: env("TELNYX_API_KEY") || pluginConfig.telnyxApiKey,
    telnyxConnectionId: env("TELNYX_CONNECTION_ID") || pluginConfig.telnyxConnectionId,
    telnyxPhoneNumber: env("TELNYX_PHONE_NUMBER") || pluginConfig.telnyxPhoneNumber,
    telnyxWebhookSecret: env("TELNYX_WEBHOOK_SECRET") || pluginConfig.telnyxWebhookSecret,
    twilioAccountSid: env("TWILIO_ACCOUNT_SID") || pluginConfig.twilioAccountSid,
    twilioAuthToken: env("TWILIO_AUTH_TOKEN") || pluginConfig.twilioAuthToken,
    twilioPhoneNumber: env("TWILIO_PHONE_NUMBER") || pluginConfig.twilioPhoneNumber,
    deepgramApiKey: env("DEEPGRAM_API_KEY") || pluginConfig.deepgramApiKey,
    deepgramVoice: env("CLAWVOICE_DEEPGRAM_VOICE") || pluginConfig.deepgramVoice || "aura-asteria-en",
    elevenlabsApiKey: env("ELEVENLABS_API_KEY") || pluginConfig.elevenlabsApiKey,
    elevenlabsAgentId: env("ELEVENLABS_AGENT_ID") || pluginConfig.elevenlabsAgentId,
    elevenlabsVoiceId: env("ELEVENLABS_VOICE_ID") || pluginConfig.elevenlabsVoiceId,
    openaiApiKey: env("OPENAI_API_KEY") || pluginConfig.openaiApiKey,
    analysisModel: env("CLAWVOICE_ANALYSIS_MODEL") || pluginConfig.analysisModel || "gpt-4o-mini",
    mainMemoryAccess: (env("CLAWVOICE_MAIN_MEMORY_ACCESS") || pluginConfig.mainMemoryAccess || "read") as "read" | "none",
    autoExtractMemories: parseBool(env("CLAWVOICE_AUTO_EXTRACT_MEMORIES"), pluginConfig.autoExtractMemories ?? true),
    restrictTools: parseBool(env("CLAWVOICE_RESTRICT_TOOLS"), pluginConfig.restrictTools ?? true),
    deniedTools: parseArray(env("CLAWVOICE_DENIED_TOOLS")) || pluginConfig.deniedTools || ["exec", "browser", "web_fetch", "gateway", "cron", "sessions_spawn"],
    amdEnabled: parseBool(env("CLAWVOICE_AMD_ENABLED"), pluginConfig.amdEnabled ?? true),
    maxCallDuration: parseInt(env("CLAWVOICE_MAX_CALL_DURATION") || "") || pluginConfig.maxCallDuration || 1800,
    recordCalls: parseBool(env("CLAWVOICE_RECORD_CALLS"), pluginConfig.recordCalls ?? false),
    relayUrl: env("CLAWVOICE_RELAY_URL") || pluginConfig.relayUrl || "wss://relay.clawvoice.dev",
  };
}

function env(key: string): string | undefined {
  return process.env[key] || undefined;
}

function parseBool(envVal: string | undefined, fallback: boolean): boolean {
  if (envVal === "true") return true;
  if (envVal === "false") return false;
  return fallback;
}

function parseArray(envVal: string | undefined): string[] | null {
  if (!envVal) return null;
  return envVal.split(",").map((s) => s.trim());
}
```

## Agent Skill Document

The plugin ships a skill that teaches the OpenClaw agent how to use voice calling.

```markdown
<!-- skills/clawvoice/SKILL.md -->

# Voice Assistant

You can make and receive phone calls using ClawVoice.

## Making a Call

Use the `clawvoice_call` tool to call someone:
- Provide the phone number in E.164 format (+15551234567)
- Optionally describe the purpose of the call

During the call, you'll have a real-time voice conversation. Keep your responses
concise and natural -- you're speaking, not typing.

## During Voice Calls

When you're in a voice call session:
- Keep responses SHORT (1-3 sentences). Long responses feel unnatural in voice.
- Be conversational. Use contractions, casual language.
- If you need to convey complex information, break it into small chunks.
- You can use the `clawvoice_hangup` tool to end the call.

## Voice Memory

Voice calls write to a separate memory namespace (voice-memory/).
- You can reference your main memory but cannot write to it during calls.
- After a call ends, a summary and extracted memories are saved.
- An operator can later promote voice memories to your main MEMORY.md.

## Security

During voice calls, some tools are restricted for safety:
- No file execution, browser automation, or web fetching
- No spawning new sessions or modifying cron jobs
- Workspace file access only
```

## Telnyx Integration Reference

### Key Differences from Twilio

The reference code uses Twilio. When porting to Telnyx:

| Twilio Concept | Telnyx Equivalent |
|---------------|-------------------|
| TwiML (XML responses) | TeXML (compatible format) or Call Control API (REST) |
| Media Streams (WebSocket) | Stream API (WebSocket, different message format) |
| Status Callbacks | Webhooks (different event names/payloads) |
| Programmable Voice API | Call Control v2 API |
| AMD (Answering Machine Detection) | AMD via Call Control API |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | `TELNYX_API_KEY` |

### Telnyx Call Control v2

```typescript
// Initiate outbound call
const response = await fetch("https://api.telnyx.com/v2/calls", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${config.telnyxApiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    connection_id: config.telnyxConnectionId,
    to: phoneNumber,
    from: config.telnyxPhoneNumber,
    answering_machine_detection: config.amdEnabled ? "detect" : "disabled",
    webhook_url: `${gatewayUrl}/clawvoice/webhooks/telnyx`,
    stream_url: `wss://${gatewayHost}/clawvoice/media-stream`,
    stream_track: "both_tracks",
  }),
});
```

### Telnyx WebSocket Media Streaming

Telnyx sends audio over WebSocket in a different format than Twilio:

```typescript
// Telnyx media message format
interface TelnyxMediaMessage {
  event: "media";
  stream_id: string;
  payload: string;     // base64-encoded audio
  sequence_number: number;
}

// Audio format: 8kHz mulaw by default, can request 16kHz linear16
// Configure via stream_url parameters or Call Control API
```

### Key Telnyx Webhook Events

| Event | Description |
|-------|-------------|
| `call.initiated` | Outbound call started |
| `call.answered` | Call was answered |
| `call.hangup` | Call ended |
| `call.machine.detection.ended` | AMD result |
| `call.machine.greeting.ended` | Voicemail greeting finished (if leaving message) |
| `streaming.started` | WebSocket media stream established |
| `streaming.stopped` | WebSocket media stream ended |

## ElevenLabs Conversational AI Integration

This is a new integration (no reference code exists). ElevenLabs Agents handle the full voice pipeline.

### Architecture

```
Phone -> Telnyx -> Audio WebSocket -> ElevenLabs Agent
                                         |
                                    EL calls OpenClaw's
                                    /v1/chat/completions
                                         |
                                    OpenClaw Agent (brain)
                                         |
                                    Response text
                                         |
                                    ElevenLabs TTS -> Audio -> Phone
```

### Setup

1. Create an ElevenLabs Conversational AI agent in their dashboard
2. Configure it to use a "Custom LLM" pointing at your OpenClaw gateway's chat completions endpoint
3. Set the agent ID in ClawVoice config

### Implementation Notes

- ElevenLabs handles STT, turn-taking, interruption detection, and TTS
- OpenClaw's `/v1/chat/completions` endpoint (provided by the gateway) serves as the LLM
- The plugin needs to:
  1. Bridge Telnyx audio WebSocket <-> ElevenLabs Agent WebSocket
  2. Ensure the OpenClaw chat completions endpoint includes voice memory context
  3. Apply tool restrictions when the request comes from an ElevenLabs agent session

## Development Workflow

### Local Development

```bash
# 1. Clone and install
git clone https://github.com/your-org/clawvoice.git
cd clawvoice
npm install

# 2. Build
npm run build

# 3. Link to local OpenClaw
npm link
cd /path/to/your/openclaw/workspace
openclaw plugins install --link @clawvoice/clawvoice

# 4. Configure (minimal for testing)
openclaw config set clawvoice.telephonyProvider telnyx
openclaw config set clawvoice.telnyxApiKey YOUR_KEY
openclaw config set clawvoice.deepgramApiKey YOUR_KEY

# 5. Start OpenClaw
openclaw start

# 6. For webhook testing, use ngrok or similar tunnel
ngrok http 3000
# Then set webhook URL in Telnyx dashboard to ngrok URL + /clawvoice/webhooks/telnyx
```

### Testing

```bash
# Run tests
npm test

# Test telephony connectivity
openclaw clawvoice test

# Make a test call
openclaw clawvoice call +15551234567
```

### Package Structure

```
clawvoice/
  openclaw.plugin.json        # Plugin manifest
  package.json
  tsconfig.json
  src/
    index.ts                  # Plugin entry point
    config.ts                 # Config resolution
    tools.ts                  # Tool registration
    cli.ts                    # CLI command registration
    routes.ts                 # HTTP route registration
    hooks.ts                  # Hook registration
    providers/
      deepgram-agent.ts       # Deepgram Voice Agent provider
      elevenlabs-conversational.ts  # ElevenLabs Agents provider
      voice-mapping.ts        # Voice ID mapping
      types.ts                # VoiceProvider interface
    telephony/
      telnyx.ts               # Telnyx Call Control v2
      twilio.ts               # Twilio fallback
      phone-utils.ts          # Phone number formatting
      types.ts                # TelephonyProvider interface
    memory/
      voice-namespace.ts      # Voice memory isolation
      extractor.ts            # Post-call memory extraction
      promotion.ts            # Memory promotion gate
    analysis/
      post-call.ts            # Call summary, mood, topics
    services/
      voice-call.ts           # Active call management
      relay.ts                # Managed service WebSocket relay
    security/
      tool-policy.ts          # Voice session tool restrictions
      prompt-guards.ts        # Voice-specific injection guards
  skills/
clawvoice/
      SKILL.md                # Agent skill document
  dist/                       # Compiled output
  tests/
    providers/
    telephony/
    memory/
    integration/
```

## Porting Priority

When implementing, work in this order:

### Phase 1: Core Plugin Skeleton
1. `openclaw.plugin.json` manifest
2. `src/index.ts` entry point
3. `src/config.ts` config resolution
4. `src/tools.ts` tool stubs (return "not yet implemented")
5. `src/cli.ts` CLI stubs

### Phase 2: Telephony + Voice Provider
6. `src/telephony/telnyx.ts` - Telnyx Call Control (port from twilioService.ts)
7. `src/providers/deepgram-agent.ts` - Port from deepgramAgentService.ts
8. `src/services/voice-call.ts` - Active call management
9. `src/routes.ts` - Webhook handlers

### Phase 3: Memory + Analysis
10. `src/memory/voice-namespace.ts` - Voice memory isolation
11. `src/memory/extractor.ts` - Port from memoryExtractionService.ts
12. `src/analysis/post-call.ts` - Port from openaiService.ts
13. `src/hooks.ts` - Lifecycle hooks

### Phase 4: Security + Polish
14. `src/security/tool-policy.ts` - Tool restrictions
15. `src/security/prompt-guards.ts` - Voice injection guards
16. `src/memory/promotion.ts` - Memory promotion
17. `skills/clawvoice/SKILL.md` - Agent skill doc

### Phase 5: Managed Service
18. `src/services/relay.ts` - Outbound WebSocket relay
19. `src/telephony/twilio.ts` - Twilio fallback provider
20. `src/providers/elevenlabs-conversational.ts` - ElevenLabs Agents

### Phase 6: Testing + Docs
21. Integration tests
22. Unit tests for each module
23. README, CHANGELOG
