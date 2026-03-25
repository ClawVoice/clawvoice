import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import { runDiagnostics } from "./diagnostics/health";

import { MemoryExtractionService } from "./services/memory-extraction";
import { ClawVoiceService } from "./services/clawvoice";
import { readUserProfile, writeDefaultProfile } from "./services/user-profile";
import * as path from "path";

export interface SetupPrompter {
  ask(question: string): Promise<string>;
  close(): void;
}

type WritableConfig = {
  set?(key: string, value: unknown): Promise<void>;
  setMany?(values: Record<string, unknown>): Promise<void>;
};

function maskSecret(value: string | undefined): string {
  if (!value) {
    return "(not set)";
  }
  if (value.length <= 4) {
    return "****";
  }
  return `${value.slice(0, 4)}...`;
}

function normalizeChoice(value: string, options: string[]): string {
  const lowered = value.trim().toLowerCase();
  return options.includes(lowered) ? lowered : "";
}

async function askNonEmpty(prompter: SetupPrompter, question: string): Promise<string> {
  while (true) {
    const answer = (await prompter.ask(question)).trim();
    if (answer.length > 0) {
      return answer;
    }
  }
}

async function askChoice(prompter: SetupPrompter, question: string, choices: string[]): Promise<string> {
  while (true) {
    const answer = normalizeChoice(await prompter.ask(question), choices);
    if (answer.length > 0) {
      return answer;
    }
  }
}

function createReadlinePrompter(): SetupPrompter {
  const readline = require("node:readline/promises") as typeof import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return {
    ask: async (question: string) => rl.question(question),
    close: () => rl.close()
  };
}

async function saveConfig(api: PluginAPI, values: Record<string, unknown>): Promise<void> {
  const configStore = api.config as WritableConfig;
  if (typeof configStore.setMany === "function") {
    await configStore.setMany(values);
    return;
  }

  if (typeof configStore.set === "function") {
    const entries = Object.entries(values);
    for (const [key, value] of entries) {
      await configStore.set(key, value);
    }
    return;
  }

  throw new Error("Config store is not writable in this runtime");
}

export async function runSetupWizard(
  api: PluginAPI,
  args: string[],
  prompter: SetupPrompter = createReadlinePrompter()
): Promise<void> {
  const values: Record<string, unknown> = {};

  const telephonyProvider = await askChoice(prompter, "Telephony provider (telnyx/twilio): ", ["telnyx", "twilio"]);
  values.telephonyProvider = telephonyProvider;

  if (telephonyProvider === "telnyx") {
    values.telnyxApiKey = await askNonEmpty(prompter, "Telnyx API key: ");
    values.telnyxConnectionId = await askNonEmpty(prompter, "Telnyx connection ID: ");
    values.telnyxPhoneNumber = await askNonEmpty(prompter, "Telnyx phone number (E.164): ");
  } else {
    values.twilioAccountSid = await askNonEmpty(prompter, "Twilio Account SID: ");
    values.twilioAuthToken = await askNonEmpty(prompter, "Twilio auth token: ");
    values.twilioPhoneNumber = await askNonEmpty(prompter, "Twilio phone number (E.164): ");
    values.twilioStreamUrl = await askNonEmpty(
      prompter,
      "Twilio media stream URL (wss://...)\n" +
        "  Twilio needs a public WSS endpoint to stream call audio.\n" +
        "  Use a tunnel (ngrok, Cloudflare Tunnel) to expose your local media stream server.\n" +
        "  Example: wss://your-tunnel.ngrok-free.dev/media-stream\n" +
        "  Stream URL: "
    );
  }

  const voiceProvider = await askChoice(
    prompter,
    "Voice provider (deepgram-agent/elevenlabs-conversational): ",
    ["deepgram-agent", "elevenlabs-conversational"]
  );
  values.voiceProvider = voiceProvider;
  values.deepgramApiKey = await askNonEmpty(prompter, "Deepgram API key: ");

  if (voiceProvider === "elevenlabs-conversational") {
    values.elevenlabsApiKey = await askNonEmpty(prompter, "ElevenLabs API key: ");
    values.elevenlabsAgentId = await askNonEmpty(prompter, "ElevenLabs agent ID: ");
  }

  await saveConfig(api, values);

  const setupRaw = api as unknown as Record<string, unknown>;
  const setupLog = (api.log && typeof api.log.info === "function") ? api.log
    : (setupRaw.logger && typeof (setupRaw.logger as { info?: unknown }).info === "function") ? setupRaw.logger as PluginAPI["log"]
    : undefined;
  setupLog?.info?.("ClawVoice setup complete", {
    telephonyProvider,
    voiceProvider,
    deepgramApiKey: maskSecret(String(values.deepgramApiKey)),
    telnyxApiKey: maskSecret(typeof values.telnyxApiKey === "string" ? values.telnyxApiKey : undefined),
    twilioAccountSid: maskSecret(typeof values.twilioAccountSid === "string" ? values.twilioAccountSid : undefined),
    elevenlabsApiKey: maskSecret(typeof values.elevenlabsApiKey === "string" ? values.elevenlabsApiKey : undefined)
  });

  const tunnelPlaceholder = "<YOUR-TUNNEL-URL>";
  const raw = typeof values.twilioStreamUrl === "string" ? values.twilioStreamUrl.trim() : "";

  function hostFromMaybeUrl(input: string): string {
    if (!input) return tunnelPlaceholder;
    const withScheme = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
    const normalized = withScheme.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
    try {
      return new URL(normalized).host || tunnelPlaceholder;
    } catch {
      return tunnelPlaceholder;
    }
  }

  const tunnelHost = hostFromMaybeUrl(raw);

  console.log("\n✅ ClawVoice config saved!\n");
  console.log("── Next steps ──────────────────────────────────────────────\n");

  if (telephonyProvider === "twilio") {
    console.log("1. Configure webhooks in Twilio Console:");
    console.log("   Open: https://console.twilio.com → Phone Numbers → Active Numbers");
    console.log(`   Select your number (${values.twilioPhoneNumber || "..."}):\n`);
    console.log("   Voice Configuration → A call comes in → Webhook:");
    console.log(`     https://${tunnelHost}/clawvoice/webhooks/twilio/voice  (HTTP POST)\n`);
    console.log("   Messaging Configuration → A message comes in → Webhook:");
    console.log(`     https://${tunnelHost}/clawvoice/webhooks/twilio/sms  (HTTP POST)\n`);
    if (tunnelHost !== tunnelPlaceholder) {
      console.log(`   (Derived from your stream URL. If your webhook tunnel differs, replace ${tunnelHost} above.)\n`);
    }
  } else {
    console.log("1. Configure webhook in Telnyx Mission Control:");
    console.log("   Open your Call Control Application and set webhook URL:");
    console.log(`     https://${tunnelHost}/clawvoice/webhooks/telnyx\n`);
    console.log("   Make sure your phone number is assigned to this application.\n");
  }

  console.log("2. Start OpenClaw:");
  console.log("     openclaw start\n");
  console.log("3. Verify your setup:");
  console.log("     openclaw clawvoice status\n");
  console.log("4. Make a test call:");
  console.log("     openclaw clawvoice call +15559876543\n");
  console.log("────────────────────────────────────────────────────────────\n");

  prompter.close();
}

function parseFlag(args: string[], flag: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`--${flag}=`));
  if (inline) return inline.slice(`--${flag}=`.length).trim() || undefined;
  const idx = args.indexOf(`--${flag}`);
  if (idx >= 0 && typeof args[idx + 1] === "string") return args[idx + 1].trim() || undefined;
  return undefined;
}

function isLikelyE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value.trim());
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remaining}s` : `${seconds}s`;
}

export function registerCLI(api: PluginAPI, config: ClawVoiceConfig, callService: ClawVoiceService, memoryService?: MemoryExtractionService, workspacePath?: string): void {
  const raw = api as unknown as Record<string, unknown>;
  const logSource = (api.log && typeof api.log.info === "function") ? api.log
    : (raw.logger && typeof (raw.logger as { info?: unknown }).info === "function") ? raw.logger as PluginAPI["log"]
    : undefined;
  const log = {
    info: (msg: string, meta?: Record<string, unknown>) => logSource?.info?.(msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => logSource?.warn?.(msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => logSource?.error?.(msg, meta),
  };

  api.cli.register({
    name: "clawvoice setup",
    description: "Set up ClawVoice (configure telephony and voice providers)",
    run: async (args) => {
      await runSetupWizard(api, args);
    },
  });

  api.cli.register({
    name: "clawvoice call",
    description: "Initiate an outbound phone call",
    run: async (args) => {
      const phoneNumber = args.find((a) => !a.startsWith("--"));
      if (!phoneNumber) {
        log.info("Usage: clawvoice call <phone-number> [--greeting \"...\"] [--purpose \"...\"]");
        return;
      }
      const greeting = parseFlag(args, "greeting");
      const purpose = parseFlag(args, "purpose");

      log.info("Initiating call...", { to: phoneNumber });
      try {
        const result = await callService.startCall({ phoneNumber, greeting, purpose });
        log.info("Call started", {
          callId: result.callId,
          to: result.to,
          greeting: result.openingGreeting,
          status: result.message,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.info("Call failed", { error: message });
      }
    },
  });

  api.cli.register({
    name: "clawvoice sms",
    description: "Send an outbound SMS message",
    run: async (args) => {
      const phoneNumber = args.find((a) => !a.startsWith("--"));
      const message = parseFlag(args, "message") ?? parseFlag(args, "body");
      if (!phoneNumber || !message) {
        log.info("Usage: clawvoice sms <phone-number> --message \"...\"");
        return;
      }
      if (!isLikelyE164(phoneNumber)) {
        log.info("Phone number must be in E.164 format (example: +15551234567).");
        return;
      }
      try {
        const result = await callService.sendText({ phoneNumber, message });
        log.info("Text sent", {
          messageId: result.messageId,
          to: result.to,
          status: result.message,
        });
      } catch (err) {
        log.info("Text send failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  api.cli.register({
    name: "clawvoice inbox",
    description: "Show recent inbound and outbound SMS messages",
    run: async () => {
      const texts = callService.getRecentTexts();
      if (texts.length === 0) {
        log.info("No recent text messages.");
        return;
      }
      for (const sms of texts) {
        log.info("Text", {
          id: sms.id,
          direction: sms.direction,
          from: sms.from,
          to: sms.to,
          body: sms.body,
          createdAt: sms.createdAt,
        });
      }
    },
  });

  api.cli.register({
    name: "clawvoice status",
    description: "Show active calls and configuration health diagnostics",
    run: async () => {
      const report = runDiagnostics(config);
      log.info(`Diagnostics: ${report.overall.toUpperCase()}`, {});
      for (const check of report.checks) {
        const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "✗";
        log.info(`  ${icon} ${check.name}: ${check.detail}`, {});
        if (check.remediation) {
          log.info(`    → ${check.remediation}`, {});
        }
      }
      const active = callService.getActiveCalls();
      if (active.length > 0) {
        log.info(`Active calls: ${active.length}`, {});
      }
    },
  });

  api.cli.register({
    name: "clawvoice promote",
    description: "Review and promote voice memories to main MEMORY.md",
    run: async (args) => {
      if (!memoryService) {
        log.info("Memory extraction service not available.");
        return;
      }
      const memoryId = args.find((a) => !a.startsWith("--"));
      if (memoryId) {
        const candidate = memoryService.getCandidate(memoryId);
        if (!candidate) {
          log.info("Memory candidate not found", { memoryId });
          return;
        }
        if (parseFlag(args, "yes")) {
          const result = await memoryService.approveAndPromote(memoryId);
          log.info(result.promoted ? "Promoted" : `Failed: ${result.reason}`, { memoryId });
        } else {
          log.info(`[${candidate.status}] ${candidate.category}: "${candidate.content}" (confidence: ${candidate.confidence})`);
          log.info("Run again with --yes to promote.");
        }
        return;
      }
      const pending = memoryService.getPendingCandidates();
      if (pending.length === 0) {
        log.info("No pending memory candidates.");
        return;
      }
      log.info(`${pending.length} pending memory candidate(s):`);
      for (const c of pending) {
        log.info(`  ${c.id}: [${c.category}] "${c.content}" (confidence: ${c.confidence})`);
      }
      log.info("Run `clawvoice promote <memoryId> --yes` to promote.");
    },
  });

  api.cli.register({
    name: "clawvoice history",
    description: "Show recent call history",
    run: async (args) => {
      const callId = args.find((a) => !a.startsWith("--"));
      if (callId) {
        const summary = callService.getCallSummary(callId);
        if (!summary) {
          log.info("No summary found for call", { callId });
          return;
        }
        const transcript = summary.transcriptLength > 0
          ? `${summary.transcriptLength} transcript entries`
          : "No transcript";
        log.info("Call detail", {
          callId: summary.callId,
          outcome: summary.outcome,
          duration: formatDuration(summary.durationMs),
          transcript,
          failures: summary.failures.length > 0
            ? summary.failures.map((f) => `${f.type}: ${f.description}`).join("; ")
            : "none",
          pendingActions: summary.pendingActions.length > 0
            ? summary.pendingActions.join(", ")
            : "none",
          retryContext: summary.retryContext
            ? summary.retryContext.suggestedApproach
            : "none",
        });
        return;
      }

      const active = callService.getActiveCalls();
      if (active.length === 0) {
        log.info("No recent calls.");
        return;
      }
      for (const call of active) {
        log.info("Call", {
          callId: call.callId,
          to: call.to,
          provider: call.provider,
          status: call.status,
          started: call.startedAt,
          ended: call.endedAt ?? "ongoing",
        });
      }
    },
  });

  api.cli.register({
    name: "clawvoice test",
    description: "Test voice pipeline connectivity and provider readiness",
    run: async () => {
      const report = runDiagnostics(config);
      const failures = report.checks.filter((c) => c.status === "fail");
      if (failures.length > 0) {
        log.info("Connectivity test FAILED — fix these issues first:", {});
        for (const f of failures) {
          log.info(`  ✗ ${f.name}: ${f.detail}`, {});
          if (f.remediation) {
            log.info(`    → ${f.remediation}`, {});
          }
        }
        return;
      }
      log.info("Connectivity test PASSED — all providers configured.", {});
      const warnings = report.checks.filter((c) => c.status === "warn");
      if (warnings.length > 0) {
        log.info("Warnings:", {});
        for (const w of warnings) {
          log.info(`  ⚠ ${w.name}: ${w.detail}`, {});
        }
      }
    },
  });

  api.cli.register({
    name: "clawvoice clear",
    description: "Force-clear stuck call slots (fixes 'maximum concurrent calls' with no live call)",
    run: async (args) => {
      const callId = args.find((a) => !a.startsWith("--"));
      const cleared = callService.forceClear(callId || undefined);
      if (cleared.length === 0) {
        log.info("No active call slots to clear.", {});
        return;
      }
      log.info(`Cleared ${cleared.length} stuck call slot(s): ${cleared.join(", ")}`, {});
    },
  });

  api.cli.register({
    name: "clawvoice profile",
    description: "View or set up your user profile for voice calls",
    run: async (args) => {
      const voiceMemoryDir = workspacePath
        ? path.join(workspacePath, "voice-memory")
        : null;

      if (!voiceMemoryDir) {
        log.info("Cannot determine workspace path. Set OPENCLAW_WORKSPACE or run inside an OpenClaw gateway.");
        return;
      }

      const existing = readUserProfile(voiceMemoryDir);

      // Show current profile if no args or --show
      if (args.length === 0 || args.includes("--show")) {
        if (existing.ownerName) {
          log.info("Current profile:", {
            ownerName: existing.ownerName,
            communicationStyle: existing.communicationStyle,
            context: existing.contextBlock || "(empty)",
          });
        } else {
          log.info("No user profile found. Run with --name to create one.");
          log.info("Usage: clawvoice profile --name \"Your Name\" [--style casual|professional] [--context \"About you...\"]");
        }
        return;
      }

      // Set profile from flags
      const name = parseFlag(args, "name") ?? existing.ownerName;
      const style = parseFlag(args, "style") ?? existing.communicationStyle;
      const context = parseFlag(args, "context");

      if (!name) {
        log.info("Usage: clawvoice profile --name \"Your Name\" [--style casual|professional] [--context \"About you...\"]");
        return;
      }

      writeDefaultProfile(voiceMemoryDir, name, style, context ?? (existing.contextBlock || undefined));
      log.info("Profile saved.", {
        ownerName: name,
        communicationStyle: style,
        path: path.join(voiceMemoryDir, "user-profile.md"),
      });
    },
  });
}
