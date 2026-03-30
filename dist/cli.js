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
exports.runSetupWizard = runSetupWizard;
exports.runInteractiveSetupWizard = runInteractiveSetupWizard;
exports.registerCLI = registerCLI;
const config_1 = require("./config");
const health_1 = require("./diagnostics/health");
const user_profile_1 = require("./services/user-profile");
const tailscale_1 = require("./tunnel/tailscale");
const path = __importStar(require("path"));
function maskSecret(value) {
    if (!value) {
        return "(not set)";
    }
    if (value.length <= 4) {
        return "****";
    }
    return `${value.slice(0, 4)}...`;
}
function normalizeChoice(value, options) {
    const lowered = value.trim().toLowerCase();
    return options.includes(lowered) ? lowered : "";
}
function normalizePersistedInput(value) {
    return value.trim();
}
async function askNonEmpty(prompter, question) {
    while (true) {
        const answer = (await prompter.ask(question)).trim();
        if (answer.length > 0) {
            return answer;
        }
    }
}
async function askChoice(prompter, question, choices) {
    while (true) {
        const answer = normalizeChoice(await prompter.ask(question), choices);
        if (answer.length > 0) {
            return answer;
        }
    }
}
function createReadlinePrompter() {
    const readline = require("node:readline/promises");
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return {
        ask: async (question) => rl.question(question),
        close: () => rl.close()
    };
}
async function saveConfig(api, values) {
    const configStore = api.config;
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
async function runSetupWizard(api, args, prompter = createReadlinePrompter()) {
    const values = {};
    const telephonyProvider = await askChoice(prompter, "Telephony provider (telnyx/twilio): ", ["telnyx", "twilio"]);
    values.telephonyProvider = telephonyProvider;
    if (telephonyProvider === "telnyx") {
        values.telnyxApiKey = await askNonEmpty(prompter, "Telnyx API key: ");
        values.telnyxConnectionId = await askNonEmpty(prompter, "Telnyx connection ID: ");
        values.telnyxPhoneNumber = await askNonEmpty(prompter, "Telnyx phone number (E.164): ");
    }
    else {
        values.twilioAccountSid = await askNonEmpty(prompter, "Twilio Account SID: ");
        values.twilioAuthToken = await askNonEmpty(prompter, "Twilio auth token: ");
        values.twilioPhoneNumber = await askNonEmpty(prompter, "Twilio phone number (E.164): ");
        // Auto-detect ngrok tunnel if running
        let detectedTunnelUrl = "";
        try {
            const resp = await globalThis.fetch("http://localhost:4040/api/tunnels", { signal: AbortSignal.timeout(2000) });
            const data = await resp.json();
            const httpsTunnel = data.tunnels?.find((t) => t.proto === "https");
            if (httpsTunnel?.public_url) {
                detectedTunnelUrl = httpsTunnel.public_url.replace(/^https:/, "wss:") + "/media-stream";
                console.log(`\n  ✓ Detected ngrok tunnel: ${httpsTunnel.public_url}`);
                console.log(`    Stream URL will be: ${detectedTunnelUrl}\n`);
            }
        }
        catch { /* ngrok not running or not accessible */ }
        if (detectedTunnelUrl) {
            const useDetected = await askChoice(prompter, `Use detected tunnel URL? (${detectedTunnelUrl}) (yes/no): `, ["yes", "no"]);
            if (useDetected === "yes") {
                values.twilioStreamUrl = detectedTunnelUrl;
            }
            else {
                values.twilioStreamUrl = await askNonEmpty(prompter, "Twilio media stream URL (wss://...): ");
            }
        }
        else {
            let tailscaleDns = null;
            try {
                tailscaleDns = await (0, tailscale_1.getTailscaleDnsName)();
            }
            catch { /* tailscale not available */ }
            if (tailscaleDns) {
                const msPath = (0, config_1.resolveConfig)(values).mediaStreamPath;
                const tsStreamUrl = `wss://${tailscaleDns}${msPath}`;
                console.log(`\n  ✓ Detected Tailscale: ${tailscaleDns}`);
                console.log(`    Stream URL will be: ${tsStreamUrl}\n`);
                const useTailscale = await askChoice(prompter, "Use Tailscale Funnel for tunnel? (yes/no): ", ["yes", "no"]);
                if (useTailscale === "yes") {
                    values.twilioStreamUrl = tsStreamUrl;
                    values.tailscaleMode = "funnel";
                    values.tailscalePath = msPath;
                    console.log(`\n  After setup completes, run: openclaw clawvoice expose --mode funnel --path ${msPath} --ts-path ${msPath}`);
                }
                else {
                    values.tailscaleMode = "off";
                    values.twilioStreamUrl = await askNonEmpty(prompter, "Twilio media stream URL (wss://...): ");
                }
            }
            else {
                values.twilioStreamUrl = await askNonEmpty(prompter, "Twilio media stream URL (wss://...)\n" +
                    "  Twilio needs a public WSS endpoint to stream call audio.\n" +
                    "  Use a tunnel (ngrok, Cloudflare Tunnel, Tailscale Funnel) to expose port 3101.\n" +
                    "  Example: wss://your-tunnel.ngrok-free.dev/media-stream\n" +
                    "  Stream URL: ");
            }
        }
    }
    const voiceProvider = await askChoice(prompter, "Voice provider (deepgram-agent/elevenlabs-conversational): ", ["deepgram-agent", "elevenlabs-conversational"]);
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
    const setupRaw = api;
    const setupLog = (api.log && typeof api.log.info === "function") ? api.log
        : (setupRaw.logger && typeof setupRaw.logger.info === "function") ? setupRaw.logger
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
    function hostFromMaybeUrl(input) {
        if (!input)
            return tunnelPlaceholder;
        const withScheme = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
        const normalized = withScheme.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
        try {
            return new URL(normalized).host || tunnelPlaceholder;
        }
        catch {
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
            const autoConfig = await askChoice(prompter, "Auto-configure Twilio webhooks for this number? (yes/no): ", ["yes", "no"]);
            if (autoConfig === "yes") {
                try {
                    const sid = String(values.twilioAccountSid);
                    const token = String(values.twilioAuthToken);
                    const phone = String(values.twilioPhoneNumber);
                    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
                    // Find the phone number SID
                    const listResp = await globalThis.fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`, { headers: { Authorization: `Basic ${auth}` } });
                    const listData = await listResp.json();
                    const phoneSid = listData.incoming_phone_numbers?.[0]?.sid;
                    if (phoneSid) {
                        // Update the phone number webhooks
                        await globalThis.fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${phoneSid}.json`, {
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
                        });
                        console.log(`\n  ✓ Twilio webhooks configured automatically!`);
                        console.log(`    Voice: ${voiceWebhookUrl}`);
                        console.log(`    SMS:   ${smsWebhookUrl}\n`);
                        webhooksConfigured = true;
                    }
                    else {
                        console.log(`\n  ✗ Could not find phone number ${phone} in your Twilio account.\n`);
                    }
                }
                catch (err) {
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
    }
    else {
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
    console.log("   TIP: When placing calls, keep purpose and greeting separate:");
    console.log("     --greeting = first sentence spoken aloud (short)");
    console.log("     --purpose = background context (detailed, NOT read aloud)\n");
    if (voiceProvider === "elevenlabs-conversational") {
        console.log("4. Verify your ElevenLabs agent prompt includes:");
        console.log("     {{ _system_prompt_ }}");
        console.log("   Without this, the voice agent won't receive call context.\n");
        console.log("5. Start OpenClaw:");
    }
    else {
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
        const diagConfig = (0, config_1.resolveConfig)(values);
        const openclawCfg = api.config;
        const report = await (0, health_1.runDiagnostics)(diagConfig, openclawCfg);
        const failures = report.checks.filter((c) => c.status === "fail");
        const warnings = report.checks.filter((c) => c.status === "warn");
        if (failures.length === 0 && warnings.length === 0) {
            console.log("✅ All checks passed — you're ready to go!");
            console.log("   Tip: Run `openclaw clawvoice status` anytime to re-check your setup.\n");
        }
        else {
            if (failures.length > 0) {
                console.log(`❌ ${failures.length} issue(s) need attention:`);
                for (const f of failures)
                    console.log(`   • ${f.name}: ${f.remediation ?? f.detail ?? "(no details)"}`);
                console.log();
            }
            if (warnings.length > 0) {
                console.log(`⚠️  ${warnings.length} warning(s):`);
                for (const w of warnings)
                    console.log(`   • ${w.name}: ${w.remediation ?? w.detail ?? "(no details)"}`);
                console.log();
            }
        }
    }
    catch (err) {
        console.log(`Diagnostics could not be completed: ${err instanceof Error ? err.message : String(err)}`);
        console.log("Run `openclaw clawvoice status` to check your setup.\n");
    }
    finally {
        prompter.close();
    }
}
// ---------------------------------------------------------------------------
// Interactive TUI wizard using @clack/prompts
// ---------------------------------------------------------------------------
async function runInteractiveSetupWizard(api, config) {
    // Import @clack/prompts for interactive TUI prompts
    const clack = await Promise.resolve().then(() => __importStar(require("@clack/prompts")));
    const { intro, outro, select, text, password, spinner: createSpinner, note, isCancel, cancel, log: clackLog, confirm } = clack;
    // Read existing config to pre-fill values
    const rawCfg = api.config;
    const nestedCfg = rawCfg?.plugins
        ?.entries?.clawvoice;
    const existing = config ?? (0, config_1.resolveConfig)((nestedCfg?.config ?? {}));
    const values = {};
    const mask = (s) => s && s.length > 4 ? `${s.slice(0, 4)}...${s.slice(-4)}` : s ? "****" : "";
    // Helper: ask to keep existing value or enter new one
    async function askKeepOrReplace(label, currentValue, promptFn) {
        if (currentValue) {
            const keep = await confirm({
                message: `${label}: ${mask(currentValue)} — keep existing?`,
                initialValue: true,
            });
            if (isCancel(keep)) {
                cancel("Setup cancelled.");
                process.exit(0);
            }
            if (keep)
                return normalizePersistedInput(currentValue);
        }
        const newVal = await promptFn();
        if (isCancel(newVal)) {
            cancel("Setup cancelled.");
            process.exit(0);
        }
        return normalizePersistedInput(newVal);
    }
    intro("ClawVoice Setup");
    const hasExistingConfig = !!(existing.twilioAccountSid || existing.telnyxApiKey);
    if (hasExistingConfig) {
        clackLog.info("Existing configuration detected. You can keep current values or enter new ones.");
    }
    // --- Telephony provider ---
    const telephonyProvider = await select({
        message: "Telephony provider",
        initialValue: existing.telephonyProvider,
        options: [
            { value: "twilio", label: "Twilio", hint: "recommended — easy setup, reliable" },
            { value: "telnyx", label: "Telnyx", hint: "developer-friendly, competitive pricing" },
        ],
    });
    if (isCancel(telephonyProvider)) {
        cancel("Setup cancelled.");
        process.exit(0);
    }
    values.telephonyProvider = telephonyProvider;
    if (telephonyProvider === "telnyx") {
        values.telnyxApiKey = await askKeepOrReplace("Telnyx API key", existing.telnyxApiKey, () => password({ message: "Telnyx API key", validate(v) { if (!v || v.length === 0)
                return "API key is required"; } }));
        values.telnyxConnectionId = await askKeepOrReplace("Telnyx connection ID", existing.telnyxConnectionId, () => text({ message: "Telnyx connection ID", validate(v) { if (!v || v.length === 0)
                return "Connection ID is required"; } }));
        values.telnyxPhoneNumber = await askKeepOrReplace("Telnyx phone number", existing.telnyxPhoneNumber, () => text({ message: "Telnyx phone number (E.164)", placeholder: "+15551234567",
            validate(v) { if (!v || v.length === 0)
                return "Phone number is required"; if (!/^\+[1-9]\d{7,14}$/.test(v.trim()))
                return "Must be E.164 format"; } }));
    }
    else {
        // Twilio
        values.twilioAccountSid = await askKeepOrReplace("Twilio Account SID", existing.twilioAccountSid, () => text({ message: "Twilio Account SID", placeholder: "AC...", validate(v) { if (!v || v.length === 0)
                return "Account SID is required"; } }));
        values.twilioAuthToken = await askKeepOrReplace("Twilio Auth Token", existing.twilioAuthToken, () => password({ message: "Twilio Auth Token", validate(v) { if (!v || v.length === 0)
                return "Auth token is required"; } }));
        values.twilioPhoneNumber = await askKeepOrReplace("Twilio phone number", existing.twilioPhoneNumber, () => text({ message: "Twilio phone number (E.164)", placeholder: "+15551234567",
            validate(v) { if (!v || v.length === 0)
                return "Phone number is required"; if (!/^\+[1-9]\d{7,14}$/.test(v.trim()))
                return "Must be E.164 format"; } }));
        // --- Tunnel auto-detection ---
        const s = createSpinner();
        let detectedTunnelUrl = "";
        s.start("Detecting tunnels...");
        // Check ngrok
        try {
            const resp = await globalThis.fetch("http://localhost:4040/api/tunnels", { signal: AbortSignal.timeout(2000) });
            const data = await resp.json();
            const httpsTunnel = data.tunnels?.find((t) => t.proto === "https");
            if (httpsTunnel?.public_url) {
                detectedTunnelUrl = httpsTunnel.public_url.replace(/^https:/, "wss:") + "/media-stream";
                s.stop(`Found ngrok: ${httpsTunnel.public_url}`);
            }
        }
        catch { /* ngrok not running */ }
        // Check Tailscale if no ngrok
        if (!detectedTunnelUrl) {
            try {
                const { execFile } = require("child_process");
                const { promisify } = require("util");
                const execFileAsync = promisify(execFile);
                const { stdout: tsStatus } = await execFileAsync("tailscale", ["status", "--json"], { timeout: 3000 });
                const ts = JSON.parse(tsStatus);
                if (ts.Self?.DNSName) {
                    const tsHost = ts.Self.DNSName.replace(/\.$/, "");
                    detectedTunnelUrl = `wss://${tsHost}/media-stream`;
                    s.stop(`Found Tailscale: ${tsHost}`);
                }
            }
            catch { /* tailscale not available */ }
        }
        if (!detectedTunnelUrl) {
            s.stop("No tunnels detected");
        }
        if (detectedTunnelUrl) {
            const useTunnel = await select({
                message: "Use detected tunnel?",
                options: [
                    { value: "yes", label: "Yes", hint: detectedTunnelUrl },
                    { value: "no", label: "No — I'll enter my own URL" },
                ],
            });
            if (isCancel(useTunnel)) {
                cancel("Setup cancelled.");
                process.exit(0);
            }
            if (useTunnel === "yes") {
                values.twilioStreamUrl = detectedTunnelUrl;
            }
            else {
                const streamUrl = await text({
                    message: "Twilio media stream URL",
                    placeholder: "wss://your-tunnel.example.com/media-stream",
                    validate(v) {
                        if (!v || v.length === 0)
                            return "Stream URL is required";
                        if (!v.startsWith("wss://"))
                            return "Must start with wss://";
                    },
                });
                if (isCancel(streamUrl)) {
                    cancel("Setup cancelled.");
                    process.exit(0);
                }
                if (typeof streamUrl !== "string") {
                    cancel("Setup cancelled.");
                    process.exit(0);
                }
                values.twilioStreamUrl = normalizePersistedInput(streamUrl);
            }
        }
        else {
            note("Twilio needs a public WSS endpoint to stream call audio.\n" +
                "Use a tunnel (ngrok, Cloudflare Tunnel) to expose your\n" +
                "local media stream server on port 3101.\n" +
                "Example: wss://your-tunnel.ngrok-free.dev/media-stream", "Stream URL");
            const streamUrl = await text({
                message: "Twilio media stream URL",
                placeholder: "wss://your-tunnel.ngrok-free.dev/media-stream",
                validate(v) {
                    if (!v || v.length === 0)
                        return "Stream URL is required";
                    if (!v.startsWith("wss://"))
                        return "Must start with wss://";
                },
            });
            if (isCancel(streamUrl)) {
                cancel("Setup cancelled.");
                process.exit(0);
            }
            if (typeof streamUrl !== "string") {
                cancel("Setup cancelled.");
                process.exit(0);
            }
            values.twilioStreamUrl = normalizePersistedInput(streamUrl);
        }
    }
    // --- Voice provider ---
    const voiceProvider = await select({
        message: "Voice AI provider",
        options: [
            { value: "elevenlabs-conversational", label: "ElevenLabs Conversational AI", hint: "natural voices, recommended" },
            { value: "deepgram-agent", label: "Deepgram Voice Agent", hint: "low latency, lower cost" },
        ],
    });
    if (isCancel(voiceProvider)) {
        cancel("Setup cancelled.");
        process.exit(0);
    }
    values.voiceProvider = voiceProvider;
    if (voiceProvider === "deepgram-agent") {
        values.deepgramApiKey = await askKeepOrReplace("Deepgram API key", existing.deepgramApiKey, () => password({ message: "Deepgram API key", validate(v) { if (!v || v.length === 0)
                return "API key is required"; } }));
    }
    if (voiceProvider === "elevenlabs-conversational") {
        values.elevenlabsApiKey = await askKeepOrReplace("ElevenLabs API key", existing.elevenlabsApiKey, () => password({ message: "ElevenLabs API key", validate(v) { if (!v || v.length === 0)
                return "API key is required"; } }));
        values.elevenlabsAgentId = await askKeepOrReplace("ElevenLabs Agent ID", existing.elevenlabsAgentId, () => text({ message: "ElevenLabs Agent ID", placeholder: "agent_...", validate(v) { if (!v || v.length === 0)
                return "Agent ID is required"; } }));
        note("Your ElevenLabs agent's system prompt MUST include:\n\n" +
            "  {{ _system_prompt_ }}\n\n" +
            "This is how ClawVoice passes call context to your agent.\n" +
            "Without it, the agent won't know why it's calling.\n\n" +
            "Example system prompt:\n" +
            "  You are a professional AI phone assistant.\n" +
            "  {{ _system_prompt_ }}\n" +
            "  Be calm, clear, and concise. Confirm important details.", "IMPORTANT: ElevenLabs Agent Configuration");
        const confirmed = await confirm({
            message: "Have you added {{ _system_prompt_ }} to your ElevenLabs agent's system prompt?",
        });
        if (isCancel(confirmed)) {
            cancel("Setup cancelled.");
            process.exit(0);
        }
        if (!confirmed) {
            clackLog.warn("Please add it before making calls. Configure your agent at:\n" +
                "https://elevenlabs.io/app/conversational-ai");
        }
    }
    // --- Save config ---
    await saveConfig(api, values);
    const setupRaw = api;
    const setupLog = (api.log && typeof api.log.info === "function") ? api.log
        : (setupRaw.logger && typeof setupRaw.logger.info === "function") ? setupRaw.logger
            : undefined;
    setupLog?.info?.("ClawVoice setup complete", {
        telephonyProvider: String(telephonyProvider),
        voiceProvider: String(voiceProvider),
        deepgramApiKey: maskSecret(String(values.deepgramApiKey)),
        telnyxApiKey: maskSecret(typeof values.telnyxApiKey === "string" ? values.telnyxApiKey : undefined),
        twilioAccountSid: maskSecret(typeof values.twilioAccountSid === "string" ? values.twilioAccountSid : undefined),
        elevenlabsApiKey: maskSecret(typeof values.elevenlabsApiKey === "string" ? values.elevenlabsApiKey : undefined)
    });
    // --- Twilio webhook auto-configuration ---
    const tunnelPlaceholder = "<YOUR-TUNNEL-URL>";
    const rawStreamUrl = typeof values.twilioStreamUrl === "string" ? values.twilioStreamUrl.trim() : "";
    function hostFromMaybeUrlInteractive(input) {
        if (!input)
            return tunnelPlaceholder;
        const withScheme = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
        const normalized = withScheme.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
        try {
            return new URL(normalized).host || tunnelPlaceholder;
        }
        catch {
            return tunnelPlaceholder;
        }
    }
    const tunnelHost = hostFromMaybeUrlInteractive(rawStreamUrl);
    if (telephonyProvider === "twilio") {
        const voiceWebhookUrl = `https://${tunnelHost}/clawvoice/webhooks/twilio/voice`;
        const smsWebhookUrl = `https://${tunnelHost}/clawvoice/webhooks/twilio/sms`;
        let webhooksConfigured = false;
        if (tunnelHost !== tunnelPlaceholder && values.twilioAccountSid && values.twilioAuthToken && values.twilioPhoneNumber) {
            const autoConfig = await confirm({
                message: "Auto-configure Twilio webhooks for this number?",
            });
            if (isCancel(autoConfig)) {
                cancel("Setup cancelled.");
                process.exit(0);
            }
            if (autoConfig) {
                const ws = createSpinner();
                ws.start("Configuring Twilio webhooks...");
                try {
                    const sid = String(values.twilioAccountSid);
                    const token = String(values.twilioAuthToken);
                    const phone = String(values.twilioPhoneNumber);
                    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
                    const listResp = await globalThis.fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`, { headers: { Authorization: `Basic ${auth}` } });
                    const listData = await listResp.json();
                    const phoneSid = listData.incoming_phone_numbers?.[0]?.sid;
                    if (phoneSid) {
                        await globalThis.fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${phoneSid}.json`, {
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
                        });
                        ws.stop("Twilio webhooks configured");
                        clackLog.success(`Voice: ${voiceWebhookUrl}`);
                        clackLog.success(`SMS:   ${smsWebhookUrl}`);
                        webhooksConfigured = true;
                    }
                    else {
                        ws.stop(`Could not find phone number ${phone} in your Twilio account`);
                    }
                }
                catch (err) {
                    ws.stop(`Auto-configuration failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }
        if (!webhooksConfigured) {
            note(`Configure webhooks in Twilio Console:\n` +
                `https://console.twilio.com > Phone Numbers > Active Numbers\n` +
                `Select your number (${values.twilioPhoneNumber || "..."}):\n\n` +
                `Voice Configuration > A call comes in > Webhook:\n` +
                `  ${voiceWebhookUrl}  (HTTP POST)\n\n` +
                `Messaging Configuration > A message comes in > Webhook:\n` +
                `  ${smsWebhookUrl}  (HTTP POST)`, "Manual Webhook Setup");
        }
        clackLog.warn("SMS NOTICE: To send/receive SMS in the US, your Twilio number must be\n" +
            "registered with a Messaging Service and A2P 10DLC campaign.\n" +
            "Register at: https://console.twilio.com/us1/develop/sms/services");
    }
    else {
        note(`Configure webhook in Telnyx Mission Control:\n` +
            `Set webhook URL: https://${tunnelHost}/clawvoice/webhooks/telnyx\n` +
            `Make sure your phone number is assigned to this application.`, "Telnyx Webhook Setup");
    }
    // --- Post-setup diagnostics ---
    const runDiag = await confirm({
        message: "Run diagnostics now?",
    });
    if (isCancel(runDiag)) {
        cancel("Setup cancelled.");
        process.exit(0);
    }
    if (runDiag) {
        const existingConfig = existing;
        const mergedConfig = (0, config_1.resolveConfig)({ ...existingConfig, ...values });
        const report = await (0, health_1.runDiagnostics)(mergedConfig);
        for (const check of report.checks) {
            if (check.status === "pass") {
                clackLog.success(`${check.name}: ${check.detail}`);
            }
            else if (check.status === "warn") {
                clackLog.warn(`${check.name}: ${check.detail}`);
            }
            else {
                clackLog.error(`${check.name}: ${check.detail}`);
            }
        }
    }
    // --- Next steps ---
    const nextSteps = [
        "Set up your voice profile:",
        "  openclaw clawvoice profile --name \"Your Name\"",
        "",
        "Start OpenClaw:",
        "  openclaw start",
        "",
        "Verify your setup:",
        "  openclaw clawvoice status",
        "",
        "Make a test call:",
        "  openclaw clawvoice call +15559876543",
        "",
        "TIP: When placing calls, keep purpose and greeting separate:",
        "  --greeting = first sentence spoken aloud (short)",
        "  --purpose  = background context (detailed, NOT read aloud)",
    ];
    if (voiceProvider === "elevenlabs-conversational") {
        nextSteps.unshift("Verify your ElevenLabs agent prompt includes:", "  {{ _system_prompt_ }}", "");
    }
    note(nextSteps.join("\n"), "Next Steps");
    outro("Setup complete! Run: openclaw clawvoice status");
}
function parseFlag(args, flag) {
    const inline = args.find((a) => a.startsWith(`--${flag}=`));
    if (inline)
        return inline.slice(`--${flag}=`.length).trim() || undefined;
    const idx = args.indexOf(`--${flag}`);
    if (idx >= 0 && typeof args[idx + 1] === "string")
        return args[idx + 1].trim() || undefined;
    return undefined;
}
function isLikelyE164(value) {
    return /^\+[1-9]\d{7,14}$/.test(value.trim());
}
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return minutes > 0 ? `${minutes}m ${remaining}s` : `${seconds}s`;
}
function registerCLI(api, config, callService, memoryService, workspacePath) {
    const raw = api;
    const logSource = (api.log && typeof api.log.info === "function") ? api.log
        : (raw.logger && typeof raw.logger.info === "function") ? raw.logger
            : undefined;
    const log = {
        info: (msg, meta) => logSource?.info?.(msg, meta),
        warn: (msg, meta) => logSource?.warn?.(msg, meta),
        error: (msg, meta) => logSource?.error?.(msg, meta),
    };
    api.cli.register({
        name: "clawvoice setup",
        description: "Set up ClawVoice (configure telephony and voice providers)",
        run: async (_args) => {
            await runInteractiveSetupWizard(api, config);
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
            }
            catch (err) {
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
            }
            catch (err) {
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
            const report = await (0, health_1.runDiagnostics)(config);
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
                }
                else {
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
            const report = await (0, health_1.runDiagnostics)(config);
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
        name: "clawvoice expose",
        description: "Expose local media stream server via Tailscale serve or funnel",
        run: async (args) => {
            const modeArg = (parseFlag(args, "mode") ?? config.tailscaleMode);
            const validModes = ["off", "serve", "funnel"];
            if (!validModes.includes(modeArg)) {
                console.error(`Invalid --mode: ${modeArg}. Use: off|serve|funnel`);
                return;
            }
            const mode = modeArg;
            const portRaw = parseFlag(args, "port") ?? String(config.mediaStreamPort);
            const port = Number(portRaw);
            if (!Number.isInteger(port) || port <= 0 || port > 65535) {
                console.error(`Invalid --port: ${portRaw}. Must be 1-65535.`);
                return;
            }
            const localPath = parseFlag(args, "path") ?? config.mediaStreamPath;
            const tailscalePath = parseFlag(args, "ts-path") ?? config.tailscalePath;
            console.log(`Exposing via Tailscale ${mode}...`);
            const result = await (0, tailscale_1.exposeViaTailscale)({
                mode,
                localPort: port,
                localPath,
                tailscalePath,
            });
            if (result.ok && result.publicUrl) {
                console.log(`\n  ✓ Tailscale ${mode} active`);
                console.log(`    Public URL: ${result.publicUrl}`);
                console.log(`    Local:      ${result.localUrl}`);
                if (mode === "funnel" && config.telephonyProvider === "twilio") {
                    const wssUrl = result.publicUrl.replace(/^https:/, "wss:");
                    console.log(`\n  Twilio stream URL: ${wssUrl}`);
                    console.log(`  Set this as your twilioStreamUrl in config.`);
                }
                else if (mode === "serve" && config.telephonyProvider === "twilio") {
                    console.log(`\n  Note: Tailscale serve is tailnet-only; Twilio requires funnel for public internet access.`);
                }
            }
            else if (result.ok && mode === "off") {
                console.log(`\n  ✓ Tailscale exposure disabled for path: ${result.path}`);
            }
            else {
                console.log(`\n  ✗ Failed to activate Tailscale ${mode}`);
                if (result.hint) {
                    console.log(`    ${result.hint.note}`);
                    if (result.hint.enableUrl) {
                        console.log(`    Enable: ${result.hint.enableUrl}`);
                    }
                }
            }
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
                        }
                        catch { /* ignore */ }
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
            const existing = (0, user_profile_1.readUserProfile)(voiceMemoryDir);
            // Show current profile if no args or --show
            if (args.length === 0 || args.includes("--show")) {
                if (existing.ownerName) {
                    log.info(`Current profile:`);
                    log.info(`  Owner: ${existing.ownerName}`);
                    log.info(`  Style: ${existing.communicationStyle}`);
                    log.info(`  Context: ${existing.contextBlock || "(empty)"}`);
                    log.info(`  File: ${path.join(voiceMemoryDir, "user-profile.md")}`);
                }
                else {
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
            (0, user_profile_1.writeDefaultProfile)(voiceMemoryDir, name, style, context ?? (existing.contextBlock || undefined));
            log.info(`Profile saved!`);
            log.info(`  Owner: ${name}`);
            log.info(`  Style: ${style}`);
            log.info(`  File: ${path.join(voiceMemoryDir, "user-profile.md")}`);
        },
    });
}
