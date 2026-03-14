import { ClawVoiceConfig } from "../config";

export type CheckStatus = "pass" | "warn" | "fail";

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  remediation?: string;
}

export interface DiagnosticReport {
  overall: CheckStatus;
  checks: HealthCheck[];
  generatedAt: string;
}

export function runDiagnostics(config: ClawVoiceConfig): DiagnosticReport {
  const checks: HealthCheck[] = [];

  checks.push(checkMode(config));
  checks.push(checkTelephonyProvider(config));
  checks.push(checkVoiceProvider(config));
  checks.push(checkTelephonyCredentials(config));
  checks.push(checkVoiceCredentials(config));
  checks.push(checkWebhookConfig(config));
  checks.push(checkDisclosure(config));
  checks.push(checkCallDuration(config));

  const overall = deriveOverall(checks);

  return {
    overall,
    checks,
    generatedAt: new Date().toISOString(),
  };
}

function checkMode(config: ClawVoiceConfig): HealthCheck {
  return {
    name: "mode",
    status: "pass",
    detail: `Inbound: ${config.inboundEnabled ? "enabled" : "disabled"}`,
  };
}

function checkTelephonyProvider(config: ClawVoiceConfig): HealthCheck {
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

function checkVoiceProvider(config: ClawVoiceConfig): HealthCheck {
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

function checkTelephonyCredentials(config: ClawVoiceConfig): HealthCheck {
  if (config.telephonyProvider === "twilio") {
    if (!config.twilioAccountSid || !config.twilioAuthToken) {
      return {
        name: "telephony-credentials",
        status: "fail",
        detail: "Twilio credentials missing.",
        remediation:
          "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN, or run 'clawvoice setup'.",
      };
    }
  }
  if (config.telephonyProvider === "telnyx") {
    if (!config.telnyxApiKey) {
      return {
        name: "telephony-credentials",
        status: "fail",
        detail: "Telnyx API key missing.",
        remediation:
          "Set TELNYX_API_KEY, or run 'clawvoice setup'.",
      };
    }
  }
  return {
    name: "telephony-credentials",
    status: "pass",
    detail: "Telephony credentials configured.",
  };
}

function checkVoiceCredentials(config: ClawVoiceConfig): HealthCheck {
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
        remediation:
          "Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID, or run 'clawvoice setup'.",
      };
    }
  }
  return {
    name: "voice-credentials",
    status: "pass",
    detail: "Voice credentials configured.",
  };
}

function checkWebhookConfig(config: ClawVoiceConfig): HealthCheck {
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

function checkDisclosure(config: ClawVoiceConfig): HealthCheck {
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

function checkCallDuration(config: ClawVoiceConfig): HealthCheck {
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

function deriveOverall(checks: HealthCheck[]): CheckStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}
