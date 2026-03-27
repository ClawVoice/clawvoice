import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig, resolveConfig } from "./config";
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
    // Auto-detect ngrok tunnel if running
    let detectedTunnelUrl = "";
    try {
      const resp = await globalThis.fetch("http://localhost:4040/api/tunnels", { signal: AbortSignal.timeout(2000) });
      const data = await resp.json() as { tunnels?: Array<{ public_url?: string; proto?: string }> };
      const httpsTunnel = data.tunnels?.find((t) => t.proto === "https");
      if (httpsTunnel?.public_url) {
        detectedTunnelUrl = httpsTunnel.public_url.replace(/^https:/, "wss:") + "/media-stream";
        console.log(`\n  ✓ Detected ngrok tunnel: ${httpsTunnel.public_url}`);
        console.log(`    Stream URL will be: ${detectedTunnelUrl}\n`);
      }
    } catch { /* ngrok not running or not accessible */ }

    if (detectedTunnelUrl) {
      const useDetected = await askChoice(prompter, `Use detected tunnel URL? (${detectedTunnelUrl}) (yes/no): `, ["yes", "no"]);
      if (useDetected === "yes") {
        values.twilioStreamUrl = detectedTunnelUrl;
      } else {
        values.twilioStreamUrl = await askNonEmpty(
          prompter,
          "Twilio media stream URL (wss://...): "
        );
      }
    } else {
      values.twilioStreamUrl = await askNonEmpty(
        prompter,
        "Twilio media stream URL (wss://...)\n" +
          "  Twilio needs a public WSS endpoint to stream call audio.\n" +
          "  Use a tunnel (ngrok, Cloudflare Tunnel) to expose your local media stream server on port 3101.\n" +
          "  Example: wss://your-tunnel.ngrok-free.dev/media-stream\n" +
          "  Stream URL: "
      );
    }
  }

  const voiceProvider = await askChoice(
    prompter,
    "Voice provider (deepgram-agent/elevenlabs-conversational): ",
    ["deepgram-agent", "elevenlabs-conversational"]
  );
  values.voiceProvider = voiceProvider;

  if (voiceProvider === "deepgram-agent") {
    values.deepgramApiKey = await askNonEmpty(prompter, "Deepgram API key: ");
  }

  if (voiceProvider === "elevenlabs-conversational") {
    values.elevenlabsApiKey = await askNonEmpty(prompter, "ElevenLabs API key: ");
    values.elevenlabsAgentId = await askNonEmpty(prompter, "ElevenLabs agent ID: ");

    console.log("\n⚠️  IMPORTANT: ElevenLabs Agent Configuration");
    console.log("   Your ElevenLabs agent's system prompt MUST include this placeholder:");
    console.log("   {{ _system_prompt_ }}");
    console.log("");
    console.log("   This is how ClawVoice passes call context to your agent.");
    console.log("   Without it, the agent won't know why it's calling or who it represents.");
    console.log("");
    console.log("   Example system prompt for your agent:");
    console.log("   ---");
    console.log("   You are a professional AI phone assistant.");
    console.log("");
    console.log("   {{ _system_prompt_ }}");
    console.log("");
    console.log("   Use the context above to guide the conversation. Do NOT read instructions aloud.");
    console.log("   Be calm, clear, and concise. Confirm important details.");
    console.log("   ---");
    console.log("");

    const confirmed = await askChoice(prompter, "Have you added {{ _system_prompt_ }} to your ElevenLabs agent's system prompt? (yes/no): ", ["yes", "no"]);
    if (confirmed === "no") {
      console.log("\n   Please add it before making calls. You can configure your agent at:");
      console.log("   https://elevenlabs.io/app/conversational-ai\n");
    }
  }

  await saveConfig(api, values);

  const setupRaw = api as unknown as Record<string, unknown>;
  const setupLog = (api.log && typeof api.log.info === "function") ? api.log
    : (setupRaw.logger && typeof (setupRaw.logger as { info?: unknown }).info === "function") ? setupRaw.logger as PluginAPI["log"]
    : undefined;
  setupLog?.info?.("ClawVoice setup complete", {
    telephonyProvider,
    voiceProvider,
    deepgramApiKey: maskSecret(typeof values.deepgramApiKey === "string" ? values.deepgramApiKey : undefined),
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
    const voiceWebhookUrl = `https://${tunnelHost}/clawvoice/webhooks/twilio/voice`;
    const smsWebhookUrl = `https://${tunnelHost}/clawvoice/webhooks/twilio/sms`;

    // Try to auto-configure Twilio webhooks via API
    let webhooksConfigured = false;
    if (tunnelHost !== tunnelPlaceholder && values.twilioAccountSid && values.twilioAuthToken && values.twilioPhoneNumber) {
      const autoConfig = await askChoice(
        prompter,
        "Auto-configure Twilio webhooks for this number? (yes/no): ",
        ["yes", "no"],
      );
      if (autoConfig === "yes") {
        try {
          const sid = String(values.twilioAccountSid);
          const token = String(values.twilioAuthToken);
          const phone = String(values.twilioPhoneNumber);
          const auth = Buffer.from(`${sid}:${token}`).toString("base64");

          // Find the phone number SID
          const listResp = await globalThis.fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`,
            { headers: { Authorization: `Basic ${auth}` } },
          );
          const listData = await listResp.json() as { incoming_phone_numbers?: Array<{ sid: string }> };
          const phoneSid = listData.incoming_phone_numbers?.[0]?.sid;

          if (phoneSid) {
            // Update the phone number webhooks
            await globalThis.fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${phoneSid}.json`,
              {
                method: "POST",
                headers: {
                  Authorization: `Basic ${auth}`,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  VoiceUrl: voiceWebhookUrl,
                  VoiceMethod: "POST",
                  SmsUrl: smsWebhookUrl,
                  SmsMethod: "POST",
                }).toString(),
              },
            );
            console.log(`\n  ✓ Twilio webhooks configured automatically!`);
            console.log(`    Voice: ${voiceWebhookUrl}`);
            console.log(`    SMS:   ${smsWebhookUrl}\n`);
            webhooksConfigured = true;
          } else {
            console.log(`\n  ✗ Could not find phone number ${phone} in your Twilio account.\n`);
          }
        } catch (err) {
          console.log(`\n  ✗ Auto-configuration failed: ${err instanceof Error ? err.message : String(err)}`);
          console.log("    You'll need to configure webhooks manually.\n");
        }
      }
    }

    if (!webhooksConfigured) {
      console.log("1. Configure webhooks in Twilio Console:");
      console.log("   Open: https://console.twilio.com → Phone Numbers → Active Numbers");
      console.log(`   Select your number (${values.twilioPhoneNumber || "..."}):\n`);
      console.log("   Voice Configuration → A call comes in → Webhook:");
      console.log(`     ${voiceWebhookUrl}  (HTTP POST)\n`);
      console.log("   Messaging Configuration → A message comes in → Webhook:");
      console.log(`     ${smsWebhookUrl}  (HTTP POST)\n`);
      if (tunnelHost !== tunnelPlaceholder) {
        console.log(`   (Derived from your stream URL. If your webhook tunnel differs, replace ${tunnelHost} above.)\n`);
      }
    }

    console.log("   ⚠️  SMS NOTICE: To send/receive SMS in the US, your Twilio number must be");
    console.log("   registered with a Messaging Service and A2P 10DLC campaign. Without this,");
    console.log("   outbound SMS will be blocked by carriers (Twilio error 30034).");
    console.log("   Register at: https://console.twilio.com/us1/develop/sms/services\n");
  } else {
    console.log("1. Configure webhook in Telnyx Mission Control:");
    console.log("   Open your Call Control Application and set webhook URL:");
    console.log(`     https://${tunnelHost}/clawvoice/webhooks/telnyx\n`);
    console.log("   Make sure your phone number is assigned to this application.\n");
  }

  console.log("2. Set up your voice profile:");
  console.log("     openclaw clawvoice profile --name \"Your Name\"");
  console.log("   Then edit voice-memory/user-profile.md to add your context.\n");
  console.log("3. Tell your OpenClaw agent about voice calling:");
  console.log("   Add this to your workspace MEMORY.md or instructions file:\n");
  console.log("   ┌──────────────────────────────────────────────────────┐");
  console.log("   │ ## Voice Calling (ClawVoice)                        │");
  console.log("   │                                                      │");
  console.log("   │ You have the `clawvoice_call` tool for placing       │");
  console.log("   │ outbound phone calls. When asked to call someone:    │");
  console.log("   │                                                      │");
  console.log("   │ - Use `clawvoice_call` with phoneNumber, purpose,    │");
  console.log("   │   and greeting                                       │");
  console.log("   │ - Put ALL context in the purpose field — the voice   │");
  console.log("   │   agent only knows what you tell it                  │");
  console.log("   │ - The agent identifies itself as an AI assistant     │");
  console.log("   └──────────────────────────────────────────────────────┘\n");
  if (voiceProvider === "elevenlabs-conversational") {
    console.log("4. Verify your ElevenLabs agent prompt includes:");
    console.log("     {{ _system_prompt_ }}");
    console.log("   Without this, the voice agent won't receive call context.\n");
    console.log("5. Start OpenClaw:");
  } else {
    console.log("4. Start OpenClaw:");
  }
  console.log("     openclaw start\n");
  console.log(`${voiceProvider === "elevenlabs-conversational" ? "6" : "5"}. Verify your setup (re-run anytime):`);

  console.log("     openclaw clawvoice status\n");
  console.log(`${voiceProvider === "elevenlabs-conversational" ? "7" : "6"}. Make a test call:`);
  console.log("     openclaw clawvoice call +15559876543\n");
  console.log("────────────────────────────────────────────────────────────\n");

  try {
    console.log("Running setup diagnostics...\n");
    const diagConfig = resolveConfig(values);
    const openclawCfg = api.config as Record<string, unknown> | undefined;
    const report = await runDiagnostics(diagConfig, openclawCfg);
    const failures = report.checks.filter((c) => c.status === "fail");
    const warnings = report.checks.filter((c) => c.status === "warn");
    if (failures.length === 0 && warnings.length === 0) {
      console.log("✅ All checks passed — you're ready to go!");
      console.log("   Tip: Run `openclaw clawvoice status` anytime to re-check your setup.\n");
    } else {
      if (failures.length > 0) {
        console.log(`❌ ${failures.length} issue(s) need attention:`);
        for (const f of failures) console.log(`   • ${f.name}: ${f.remediation ?? f.detail ?? "(no details)"}`);
        console.log();
      }
      if (warnings.length > 0) {
        console.log(`⚠️  ${warnings.length} warning(s):`);
        for (const w of warnings) console.log(`   • ${w.name}: ${w.remediation ?? w.detail ?? "(no details)"}`);
        console.log();
      }
    }
  } catch (err) {
    console.log(`Diagnostics could not be completed: ${err instanceof Error ? err.message : String(err)}`);
    console.log("Run `openclaw clawvoice status` to check your setup.\n");
  } finally {
    prompter.close();
  }
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
      console.log(`\nClawVoice Status: ${report.overall.toUpperCase()}\n`);
      for (const check of report.checks) {
        const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "✗";
        console.log(`  ${icon} ${check.name}: ${check.detail}`);
        if (check.remediation) {
          console.log(`    → ${check.remediation}`);
        }
      }
      const active = callService.getActiveCalls();
      console.log(`\nActive calls: ${active.length}`);
      if (active.length > 0) {
        for (const call of active) {
          console.log(`  - ${call.callId}: ${call.to} (${call.status})`);
        }
      }
      console.log("");
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
      // Resolve workspace: explicit param > OPENCLAW_WORKSPACE env > OpenClaw state dir config
      const resolvedWorkspace = workspacePath
        ?? process.env.OPENCLAW_WORKSPACE
        ?? (() => {
          // Try reading workspace from OpenClaw config file
          const configPath = process.env.OPENCLAW_CONFIG_PATH;
          if (configPath) {
            try {
              const fs = require("fs");
              const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
              return cfg?.agents?.defaults?.workspace ?? cfg?.workspace ?? null;
            } catch { /* ignore */ }
          }
          return null;
        })();
      const voiceMemoryDir = resolvedWorkspace
        ? path.join(resolvedWorkspace, "voice-memory")
        : null;

      if (!voiceMemoryDir) {
        log.info("Cannot determine workspace path. Set OPENCLAW_WORKSPACE or use --profile flag with openclaw CLI.");
        return;
      }

      const existing = readUserProfile(voiceMemoryDir);

      // Show current profile if no args or --show
      if (args.length === 0 || args.includes("--show")) {
        if (existing.ownerName) {
          log.info(`Current profile:`);
          log.info(`  Owner: ${existing.ownerName}`);
          log.info(`  Style: ${existing.communicationStyle}`);
          log.info(`  Context: ${existing.contextBlock || "(empty)"}`);
          log.info(`  File: ${path.join(voiceMemoryDir, "user-profile.md")}`);
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
      log.info(`Profile saved!`);
      log.info(`  Owner: ${name}`);
      log.info(`  Style: ${style}`);
      log.info(`  File: ${path.join(voiceMemoryDir, "user-profile.md")}`);
    },
  });
}
