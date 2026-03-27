"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDiagnostics = runDiagnostics;
exports.checkPluginConflict = checkPluginConflict;
const tailscale_1 = require("../tunnel/tailscale");
async function runDiagnostics(config, openclawConfig) {
    const checks = [];
    checks.push(checkPluginConflict(openclawConfig));
    checks.push(checkMode(config));
    checks.push(checkTelephonyProvider(config));
    checks.push(checkVoiceProvider(config));
    checks.push(checkTelephonyCredentials(config));
    checks.push(checkVoiceCredentials(config));
    checks.push(checkWebhookConfig(config));
    checks.push(checkTwilioStreamConfig(config));
    checks.push(await checkTailscale(config));
    checks.push(checkDisclosure(config));
    checks.push(checkCallDuration(config));
    const overall = deriveOverall(checks);
    return {
        overall,
        checks,
        generatedAt: new Date().toISOString(),
    };
}
/**
 * Detect @openclaw/voice-call — the built-in voice plugin that overlaps with
 * ClawVoice.  Both register voice tools/hooks, causing duplicate tool entries
 * and unpredictable routing when both are active.
 *
 * When the full OpenClaw config is available (initPlugin / wizard), callers
 * should pass it as `openclawConfig` so we can check
 * `plugins.entries["voice-call"]`.  Without it we fall back to a
 * `require.resolve` probe which only catches npm-installed copies.
 */
function checkPluginConflict(openclawConfig) {
    let conflictDetected = false;
    let determinedFromConfig = false;
    if (openclawConfig) {
        const plugins = openclawConfig.plugins;
        const entries = plugins?.entries;
        const voiceCallEntry = entries?.["voice-call"];
        if (voiceCallEntry !== undefined && voiceCallEntry !== null) {
            determinedFromConfig = true;
            if (typeof voiceCallEntry === "object" && voiceCallEntry.enabled === false) {
                conflictDetected = false;
            }
            else {
                conflictDetected = true;
            }
        }
    }
    if (!determinedFromConfig) {
        try {
            require.resolve("@openclaw/voice-call");
            conflictDetected = true;
        }
        catch (err) {
            if (err instanceof Error && !err.message.includes("Cannot find module")) {
                console.warn("[clawvoice] Unexpected error probing for @openclaw/voice-call:", err.message);
            }
        }
    }
    if (conflictDetected) {
        return {
            name: "plugin-conflict",
            status: "warn",
            detail: "@openclaw/voice-call is also active. The agent may route voice requests to the wrong plugin.",
            remediation: 'Disable it: set plugins.entries["voice-call"].enabled = false in your OpenClaw config, or run `openclaw plugins disable voice-call`.',
        };
    }
    return {
        name: "plugin-conflict",
        status: "pass",
        detail: "No conflicting voice plugins detected.",
    };
}
function checkMode(config) {
    return {
        name: "mode",
        status: "pass",
        detail: `Telephony: ${config.telephonyProvider}. Inbound: ${config.inboundEnabled ? "enabled" : "disabled"}`,
    };
}
function checkTelephonyProvider(config) {
    const valid = ["twilio", "telnyx"];
    if (!valid.includes(config.telephonyProvider)) {
        return {
            name: "telephony-provider",
            status: "fail",
            detail: `Unknown telephony provider: ${config.telephonyProvider}`,
            remediation: `Set CLAWVOICE_TELEPHONY_PROVIDER to one of: ${valid.join(", ")}`,
        };
    }
    return {
        name: "telephony-provider",
        status: "pass",
        detail: `Telephony: ${config.telephonyProvider}`,
    };
}
function checkVoiceProvider(config) {
    const valid = ["deepgram-agent", "elevenlabs-conversational"];
    if (!valid.includes(config.voiceProvider)) {
        return {
            name: "voice-provider",
            status: "fail",
            detail: `Unknown voice provider: ${config.voiceProvider}`,
            remediation: `Set CLAWVOICE_VOICE_PROVIDER to one of: ${valid.join(", ")}`,
        };
    }
    return {
        name: "voice-provider",
        status: "pass",
        detail: `Voice: ${config.voiceProvider}`,
    };
}
function checkTelephonyCredentials(config) {
    if (config.telephonyProvider === "twilio") {
        if (!config.twilioAccountSid || !config.twilioAuthToken) {
            return {
                name: "telephony-credentials",
                status: "fail",
                detail: "Twilio credentials missing.",
                remediation: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN, or run 'clawvoice setup'.",
            };
        }
    }
    if (config.telephonyProvider === "telnyx") {
        if (!config.telnyxApiKey) {
            return {
                name: "telephony-credentials",
                status: "fail",
                detail: "Telnyx API key missing.",
                remediation: "Set TELNYX_API_KEY, or run 'clawvoice setup'.",
            };
        }
    }
    return {
        name: "telephony-credentials",
        status: "pass",
        detail: "Telephony credentials configured.",
    };
}
function checkVoiceCredentials(config) {
    if (config.voiceProvider === "deepgram-agent") {
        if (!config.deepgramApiKey) {
            return {
                name: "voice-credentials",
                status: "fail",
                detail: "Deepgram API key missing.",
                remediation: "Set DEEPGRAM_API_KEY, or run 'clawvoice setup'.",
            };
        }
    }
    if (config.voiceProvider === "elevenlabs-conversational") {
        if (!config.elevenlabsApiKey || !config.elevenlabsAgentId) {
            return {
                name: "voice-credentials",
                status: "fail",
                detail: "ElevenLabs credentials missing.",
                remediation: "Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID, or run 'clawvoice setup'.",
            };
        }
    }
    return {
        name: "voice-credentials",
        status: "pass",
        detail: "Voice credentials configured.",
    };
}
function checkWebhookConfig(config) {
    if (config.telephonyProvider === "telnyx" && !config.telnyxWebhookSecret) {
        return {
            name: "webhook-config",
            status: "warn",
            detail: "Telnyx webhook secret not configured. Webhooks will not be verified.",
            remediation: "Set TELNYX_WEBHOOK_SECRET for production security.",
        };
    }
    if (config.telephonyProvider === "twilio" && !config.twilioAuthToken) {
        return {
            name: "webhook-config",
            status: "warn",
            detail: "Twilio auth token needed for webhook signature verification.",
            remediation: "Ensure TWILIO_AUTH_TOKEN is set.",
        };
    }
    return {
        name: "webhook-config",
        status: "pass",
        detail: "Webhook verification keys present.",
    };
}
function checkTwilioStreamConfig(config) {
    if (config.telephonyProvider !== "twilio") {
        return {
            name: "twilio-stream-config",
            status: "pass",
            detail: "Twilio stream URL check skipped (provider is not Twilio).",
        };
    }
    if (!config.twilioStreamUrl) {
        return {
            name: "twilio-stream-config",
            status: "warn",
            detail: "CLAWVOICE_TWILIO_STREAM_URL is not set.",
            remediation: "Set CLAWVOICE_TWILIO_STREAM_URL to a public WSS media endpoint (example: wss://your-host.example.com/media-stream).",
        };
    }
    let parsed;
    try {
        parsed = new URL(config.twilioStreamUrl);
    }
    catch {
        return {
            name: "twilio-stream-config",
            status: "fail",
            detail: "twilioStreamUrl is not a valid absolute URL.",
            remediation: "Set CLAWVOICE_TWILIO_STREAM_URL to a valid WSS URL (example: wss://your-host.example.com/media-stream).",
        };
    }
    if (parsed.protocol !== "wss:") {
        return {
            name: "twilio-stream-config",
            status: "fail",
            detail: `twilioStreamUrl uses ${parsed.protocol} (must be wss:).`,
            remediation: "Use a WSS endpoint. Twilio Media Streams require WebSocket TLS (wss://...).",
        };
    }
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        return {
            name: "twilio-stream-config",
            status: "fail",
            detail: "twilioStreamUrl points to localhost/loopback.",
            remediation: "Use a public tunnel/hostname reachable by Twilio (Cloudflare Tunnel or Tailscale Funnel).",
        };
    }
    if (parsed.pathname.toLowerCase().includes("/webhook")) {
        return {
            name: "twilio-stream-config",
            status: "fail",
            detail: "twilioStreamUrl appears to point to a webhook path.",
            remediation: "Point twilioStreamUrl to your WebSocket media endpoint (not /clawvoice/webhooks/*).",
        };
    }
    return {
        name: "twilio-stream-config",
        status: "pass",
        detail: "Twilio stream URL looks valid (public WSS endpoint).",
    };
}
async function checkTailscale(config) {
    if (config.tailscaleMode === "off") {
        return {
            name: "tailscale",
            status: "pass",
            detail: "Tailscale integration disabled.",
        };
    }
    const available = await (0, tailscale_1.isTailscaleAvailable)();
    if (!available) {
        return {
            name: "tailscale",
            status: "fail",
            detail: `Tailscale mode set to "${config.tailscaleMode}" but Tailscale is not running.`,
            remediation: "Install and start Tailscale, or set tailscaleMode to \"off\".",
        };
    }
    return {
        name: "tailscale",
        status: "pass",
        detail: `Tailscale ${config.tailscaleMode} mode configured and daemon is running.`,
    };
}
function checkDisclosure(config) {
    if (config.disclosureEnabled && !config.disclosureStatement) {
        return {
            name: "disclosure",
            status: "warn",
            detail: "Disclosure enabled but statement is empty.",
            remediation: "Set CLAWVOICE_DISCLOSURE_STATEMENT or disable disclosure.",
        };
    }
    return {
        name: "disclosure",
        status: "pass",
        detail: config.disclosureEnabled
            ? "Disclosure enabled."
            : "Disclosure disabled.",
    };
}
function checkCallDuration(config) {
    if (config.maxCallDuration <= 0 || !Number.isFinite(config.maxCallDuration)) {
        return {
            name: "call-duration",
            status: "fail",
            detail: `Invalid maxCallDuration: ${config.maxCallDuration}`,
            remediation: "Set CLAWVOICE_MAX_CALL_DURATION to a positive number (seconds).",
        };
    }
    if (config.maxCallDuration > 7200) {
        return {
            name: "call-duration",
            status: "warn",
            detail: `maxCallDuration is ${config.maxCallDuration}s (over 2 hours). This may incur high costs.`,
        };
    }
    return {
        name: "call-duration",
        status: "pass",
        detail: `Max call duration: ${config.maxCallDuration}s`,
    };
}
function deriveOverall(checks) {
    if (checks.some((c) => c.status === "fail"))
        return "fail";
    if (checks.some((c) => c.status === "warn"))
        return "warn";
    return "pass";
}
