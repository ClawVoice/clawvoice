import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import { runDiagnostics } from "./diagnostics/health";
import { MemoryExtractionService } from "./services/memory-extraction";
import { VoiceCallService } from "./services/voice-call";

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

  api.log.info("ClawVoice setup complete", {
    telephonyProvider,
    voiceProvider,
    deepgramApiKey: maskSecret(String(values.deepgramApiKey)),
    telnyxApiKey: maskSecret(typeof values.telnyxApiKey === "string" ? values.telnyxApiKey : undefined),
    twilioAccountSid: maskSecret(typeof values.twilioAccountSid === "string" ? values.twilioAccountSid : undefined),
    elevenlabsApiKey: maskSecret(typeof values.elevenlabsApiKey === "string" ? values.elevenlabsApiKey : undefined)
  });

  prompter.close();
}

function parseFlag(args: string[], flag: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`--${flag}=`));
  if (inline) return inline.slice(`--${flag}=`.length).trim() || undefined;
  const idx = args.indexOf(`--${flag}`);
  if (idx >= 0 && typeof args[idx + 1] === "string") return args[idx + 1].trim() || undefined;
  return undefined;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remaining}s` : `${seconds}s`;
}

export function registerCLI(api: PluginAPI, config: ClawVoiceConfig, callService: VoiceCallService, memoryService?: MemoryExtractionService): void {
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
        api.log.info("Usage: clawvoice call <phone-number> [--greeting \"...\"] [--purpose \"...\"]");
        return;
      }
      const greeting = parseFlag(args, "greeting");
      const purpose = parseFlag(args, "purpose");

      api.log.info("Initiating call...", { to: phoneNumber });
      try {
        const result = await callService.startCall({ phoneNumber, greeting, purpose });
        api.log.info("Call started", {
          callId: result.callId,
          to: result.to,
          greeting: result.openingGreeting,
          status: result.message,
        });
      } catch (err) {
        api.log.info("Call failed", { error: err instanceof Error ? err.message : String(err) });
      }
    },
  });

  api.cli.register({
    name: "clawvoice status",
    description: "Show active calls and configuration health diagnostics",
    run: async () => {
      const report = runDiagnostics(config);
      api.log.info(`Diagnostics: ${report.overall.toUpperCase()}`, {});
      for (const check of report.checks) {
        const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "✗";
        api.log.info(`  ${icon} ${check.name}: ${check.detail}`, {});
        if (check.remediation) {
          api.log.info(`    → ${check.remediation}`, {});
        }
      }
      const active = callService.getActiveCalls();
      if (active.length > 0) {
        api.log.info(`Active calls: ${active.length}`, {});
      }
    },
  });

  api.cli.register({
    name: "clawvoice promote",
    description: "Review and promote voice memories to main MEMORY.md",
    run: async (args) => {
      if (!memoryService) {
        api.log.info("Memory extraction service not available.");
        return;
      }
      const memoryId = args.find((a) => !a.startsWith("--"));
      if (memoryId) {
        const candidate = memoryService.getCandidate(memoryId);
        if (!candidate) {
          api.log.info("Memory candidate not found", { memoryId });
          return;
        }
        if (parseFlag(args, "--yes")) {
          const result = await memoryService.approveAndPromote(memoryId);
          api.log.info(result.promoted ? "Promoted" : `Failed: ${result.reason}`, { memoryId });
        } else {
          api.log.info(`[${candidate.status}] ${candidate.category}: "${candidate.content}" (confidence: ${candidate.confidence})`);
          api.log.info("Run again with --yes to promote.");
        }
        return;
      }
      const pending = memoryService.getPendingCandidates();
      if (pending.length === 0) {
        api.log.info("No pending memory candidates.");
        return;
      }
      api.log.info(`${pending.length} pending memory candidate(s):`);
      for (const c of pending) {
        api.log.info(`  ${c.id}: [${c.category}] "${c.content}" (confidence: ${c.confidence})`);
      }
      api.log.info("Run `clawvoice promote <memoryId> --yes` to promote.");
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
          api.log.info("No summary found for call", { callId });
          return;
        }
        const transcript = summary.transcriptLength > 0
          ? `${summary.transcriptLength} transcript entries`
          : "No transcript";
        api.log.info("Call detail", {
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
        api.log.info("No recent calls.");
        return;
      }
      for (const call of active) {
        api.log.info("Call", {
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
        api.log.info("Connectivity test FAILED — fix these issues first:", {});
        for (const f of failures) {
          api.log.info(`  ✗ ${f.name}: ${f.detail}`, {});
          if (f.remediation) {
            api.log.info(`    → ${f.remediation}`, {});
          }
        }
        return;
      }
      api.log.info("Connectivity test PASSED — all providers configured.", {});
      const warnings = report.checks.filter((c) => c.status === "warn");
      if (warnings.length > 0) {
        api.log.info("Warnings:", {});
        for (const w of warnings) {
          api.log.info(`  ⚠ ${w.name}: ${w.detail}`, {});
        }
      }
    },
  });
}
