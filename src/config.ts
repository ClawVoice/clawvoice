export type TelephonyProvider = "telnyx" | "twilio";
export type VoiceProvider = "deepgram-agent" | "elevenlabs-conversational";
export type MainMemoryAccess = "read" | "none";

export interface ClawVoiceConfig {
  telephonyProvider: TelephonyProvider;
  voiceProvider: VoiceProvider;
  voiceSystemPrompt: string;
  inboundEnabled: boolean;
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
  mainMemoryAccess: MainMemoryAccess;
  autoExtractMemories: boolean;
  maxCallDuration: number;
  disclosureEnabled: boolean;
  disclosureStatement: string;
  dailyCallLimit: number;
  recordCalls: boolean;
  amdEnabled: boolean;
  restrictTools: boolean;
  deniedTools: string[];
  notifyTelegram: boolean;
  notifyDiscord: boolean;
  notifySlack: boolean;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const DEFAULT_CONFIG: ClawVoiceConfig = {
  telephonyProvider: "twilio",
  voiceProvider: "deepgram-agent",
  voiceSystemPrompt: "",
  inboundEnabled: true,
  deepgramVoice: "aura-asteria-en",
  analysisModel: "gpt-4o-mini",
  mainMemoryAccess: "read",
  autoExtractMemories: true,
  maxCallDuration: 1800,
  disclosureEnabled: true,
  disclosureStatement:
    "Hello, this call is from an AI assistant calling on behalf of a user.",
  dailyCallLimit: 50,
  recordCalls: false,
  amdEnabled: true,
  restrictTools: true,
  deniedTools: [
    "exec",
    "browser",
    "web_fetch",
    "gateway",
    "cron",
    "sessions_spawn"
  ],
  notifyTelegram: false,
  notifyDiscord: false,
  notifySlack: false,
};

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

function parseMainMemoryAccess(value: unknown): MainMemoryAccess | undefined {
  return value === "read" || value === "none" ? value : undefined;
}

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const filtered = value.filter((entry): entry is string => typeof entry === "string");
    return filtered.length > 0 ? filtered : fallback;
  }

  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return items.length > 0 ? items : fallback;
  }

  return fallback;
}

function envString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getValue<T>(envValue: T | undefined, configValue: T | undefined, fallback: T): T {
  if (typeof envValue !== "undefined") {
    return envValue;
  }
  if (typeof configValue !== "undefined") {
    return configValue;
  }
  return fallback;
}

function parseTelephonyProvider(value: unknown): TelephonyProvider | undefined {
  return value === "telnyx" || value === "twilio" ? value : undefined;
}

function parseVoiceProvider(value: unknown): VoiceProvider | undefined {
  return value === "deepgram-agent" || value === "elevenlabs-conversational" ? value : undefined;
}

export function resolveConfig(
  pluginConfig: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env
): ClawVoiceConfig {
  const envTelephony = parseTelephonyProvider(envString(env, "CLAWVOICE_TELEPHONY_PROVIDER"));
  const envVoice = parseVoiceProvider(envString(env, "CLAWVOICE_VOICE_PROVIDER"));
  const envTelnyxApiKey = envString(env, "TELNYX_API_KEY");
  const envTelnyxConnectionId = envString(env, "TELNYX_CONNECTION_ID");
  const envTelnyxPhoneNumber = envString(env, "TELNYX_PHONE_NUMBER");
  const envTelnyxWebhookSecret = envString(env, "TELNYX_WEBHOOK_SECRET");
  const envTwilioAccountSid = envString(env, "TWILIO_ACCOUNT_SID");
  const envTwilioAuthToken = envString(env, "TWILIO_AUTH_TOKEN");
  const envTwilioPhoneNumber = envString(env, "TWILIO_PHONE_NUMBER");
  const envDeepgramApiKey = envString(env, "DEEPGRAM_API_KEY");
  const envDeepgramVoice = envString(env, "CLAWVOICE_DEEPGRAM_VOICE");
  const envElevenlabsApiKey = envString(env, "ELEVENLABS_API_KEY");
  const envElevenlabsAgentId = envString(env, "ELEVENLABS_AGENT_ID");
  const envElevenlabsVoiceId = envString(env, "ELEVENLABS_VOICE_ID");
  const envOpenaiApiKey = envString(env, "OPENAI_API_KEY");
  const envAnalysisModel = envString(env, "CLAWVOICE_ANALYSIS_MODEL");
  const envMainMemoryAccess = parseMainMemoryAccess(envString(env, "CLAWVOICE_MAIN_MEMORY_ACCESS"));
  const envAutoExtractMemories = envString(env, "CLAWVOICE_AUTO_EXTRACT_MEMORIES");
  const envMaxCallDuration = envString(env, "CLAWVOICE_MAX_CALL_DURATION");
  const envRecordCalls = envString(env, "CLAWVOICE_RECORD_CALLS");
  const envDisclosureEnabled = envString(env, "CLAWVOICE_DISCLOSURE_ENABLED");
  const envDisclosureStatement = envString(
    env,
    "CLAWVOICE_DISCLOSURE_STATEMENT",
  );
  const envAmdEnabled = envString(env, "CLAWVOICE_AMD_ENABLED");
  const envRestrictTools = envString(env, "CLAWVOICE_RESTRICT_TOOLS");
  const envDeniedTools = envString(env, "CLAWVOICE_DENIED_TOOLS");
  const envVoiceSystemPrompt = envString(env, "CLAWVOICE_VOICE_SYSTEM_PROMPT");
  const envInboundEnabled = envString(env, "CLAWVOICE_INBOUND_ENABLED");
  const envDailyCallLimit = envString(env, "CLAWVOICE_DAILY_CALL_LIMIT");

  const configTelephony = parseTelephonyProvider(pluginConfig.telephonyProvider);
  const configVoice = parseVoiceProvider(pluginConfig.voiceProvider);
  const configMainMemoryAccess = parseMainMemoryAccess(pluginConfig.mainMemoryAccess);

  return {
    telephonyProvider: getValue(envTelephony, configTelephony, DEFAULT_CONFIG.telephonyProvider),
    voiceProvider: getValue(envVoice, configVoice, DEFAULT_CONFIG.voiceProvider),
    telnyxApiKey: getValue(envTelnyxApiKey, typeof pluginConfig.telnyxApiKey === "string" ? pluginConfig.telnyxApiKey : undefined, undefined),
    telnyxConnectionId: getValue(envTelnyxConnectionId, typeof pluginConfig.telnyxConnectionId === "string" ? pluginConfig.telnyxConnectionId : undefined, undefined),
    telnyxPhoneNumber: getValue(envTelnyxPhoneNumber, typeof pluginConfig.telnyxPhoneNumber === "string" ? pluginConfig.telnyxPhoneNumber : undefined, undefined),
    telnyxWebhookSecret: getValue(envTelnyxWebhookSecret, typeof pluginConfig.telnyxWebhookSecret === "string" ? pluginConfig.telnyxWebhookSecret : undefined, undefined),
    twilioAccountSid: getValue(envTwilioAccountSid, typeof pluginConfig.twilioAccountSid === "string" ? pluginConfig.twilioAccountSid : undefined, undefined),
    twilioAuthToken: getValue(envTwilioAuthToken, typeof pluginConfig.twilioAuthToken === "string" ? pluginConfig.twilioAuthToken : undefined, undefined),
    twilioPhoneNumber: getValue(envTwilioPhoneNumber, typeof pluginConfig.twilioPhoneNumber === "string" ? pluginConfig.twilioPhoneNumber : undefined, undefined),
    deepgramApiKey: getValue(envDeepgramApiKey, typeof pluginConfig.deepgramApiKey === "string" ? pluginConfig.deepgramApiKey : undefined, undefined),
    deepgramVoice: getValue(envDeepgramVoice, typeof pluginConfig.deepgramVoice === "string" ? pluginConfig.deepgramVoice : undefined, DEFAULT_CONFIG.deepgramVoice),
    elevenlabsApiKey: getValue(envElevenlabsApiKey, typeof pluginConfig.elevenlabsApiKey === "string" ? pluginConfig.elevenlabsApiKey : undefined, undefined),
    elevenlabsAgentId: getValue(envElevenlabsAgentId, typeof pluginConfig.elevenlabsAgentId === "string" ? pluginConfig.elevenlabsAgentId : undefined, undefined),
    elevenlabsVoiceId: getValue(envElevenlabsVoiceId, typeof pluginConfig.elevenlabsVoiceId === "string" ? pluginConfig.elevenlabsVoiceId : undefined, undefined),
    openaiApiKey: getValue(envOpenaiApiKey, typeof pluginConfig.openaiApiKey === "string" ? pluginConfig.openaiApiKey : undefined, undefined),
    analysisModel: getValue(envAnalysisModel, typeof pluginConfig.analysisModel === "string" ? pluginConfig.analysisModel : undefined, DEFAULT_CONFIG.analysisModel),
    mainMemoryAccess: getValue(envMainMemoryAccess, configMainMemoryAccess, DEFAULT_CONFIG.mainMemoryAccess),
    autoExtractMemories: parseBoolean(
      getValue(envAutoExtractMemories, typeof pluginConfig.autoExtractMemories === "undefined" ? undefined : String(pluginConfig.autoExtractMemories), String(DEFAULT_CONFIG.autoExtractMemories)),
      DEFAULT_CONFIG.autoExtractMemories
    ),
    maxCallDuration: parseNumber(
      getValue(envMaxCallDuration, typeof pluginConfig.maxCallDuration === "undefined" ? undefined : String(pluginConfig.maxCallDuration), String(DEFAULT_CONFIG.maxCallDuration)),
      DEFAULT_CONFIG.maxCallDuration
    ),
    disclosureEnabled: parseBoolean(
      getValue(
        envDisclosureEnabled,
        typeof pluginConfig.disclosureEnabled === "undefined"
          ? undefined
          : String(pluginConfig.disclosureEnabled),
        String(DEFAULT_CONFIG.disclosureEnabled),
      ),
      DEFAULT_CONFIG.disclosureEnabled,
    ),
    disclosureStatement: getValue(
      envDisclosureStatement,
      typeof pluginConfig.disclosureStatement === "string"
        ? pluginConfig.disclosureStatement
        : undefined,
      DEFAULT_CONFIG.disclosureStatement,
    ),
    dailyCallLimit: parseNumber(
      getValue(envDailyCallLimit, typeof pluginConfig.dailyCallLimit === "undefined" ? undefined : String(pluginConfig.dailyCallLimit), String(DEFAULT_CONFIG.dailyCallLimit)),
      DEFAULT_CONFIG.dailyCallLimit
    ),
    recordCalls: parseBoolean(
      getValue(envRecordCalls, typeof pluginConfig.recordCalls === "undefined" ? undefined : String(pluginConfig.recordCalls), String(DEFAULT_CONFIG.recordCalls)),
      DEFAULT_CONFIG.recordCalls
    ),
    amdEnabled: parseBoolean(
      getValue(envAmdEnabled, typeof pluginConfig.amdEnabled === "undefined" ? undefined : String(pluginConfig.amdEnabled), String(DEFAULT_CONFIG.amdEnabled)),
      DEFAULT_CONFIG.amdEnabled
    ),
    voiceSystemPrompt: getValue(envVoiceSystemPrompt, typeof pluginConfig.voiceSystemPrompt === "string" ? pluginConfig.voiceSystemPrompt : undefined, DEFAULT_CONFIG.voiceSystemPrompt),
    inboundEnabled: parseBoolean(
      getValue(envInboundEnabled, typeof pluginConfig.inboundEnabled === "undefined" ? undefined : String(pluginConfig.inboundEnabled), String(DEFAULT_CONFIG.inboundEnabled)),
      DEFAULT_CONFIG.inboundEnabled
    ),
    restrictTools: parseBoolean(
      getValue(envRestrictTools, typeof pluginConfig.restrictTools === "undefined" ? undefined : String(pluginConfig.restrictTools), String(DEFAULT_CONFIG.restrictTools)),
      DEFAULT_CONFIG.restrictTools
    ),
    deniedTools: parseStringArray(
      getValue(envDeniedTools, pluginConfig.deniedTools, DEFAULT_CONFIG.deniedTools),
      DEFAULT_CONFIG.deniedTools
    ),
    notifyTelegram: parseBoolean(
      getValue(envString(env, "CLAWVOICE_NOTIFY_TELEGRAM"), typeof pluginConfig.notifyTelegram === "undefined" ? undefined : String(pluginConfig.notifyTelegram), String(DEFAULT_CONFIG.notifyTelegram)),
      DEFAULT_CONFIG.notifyTelegram
    ),
    notifyDiscord: parseBoolean(
      getValue(envString(env, "CLAWVOICE_NOTIFY_DISCORD"), typeof pluginConfig.notifyDiscord === "undefined" ? undefined : String(pluginConfig.notifyDiscord), String(DEFAULT_CONFIG.notifyDiscord)),
      DEFAULT_CONFIG.notifyDiscord
    ),
    notifySlack: parseBoolean(
      getValue(envString(env, "CLAWVOICE_NOTIFY_SLACK"), typeof pluginConfig.notifySlack === "undefined" ? undefined : String(pluginConfig.notifySlack), String(DEFAULT_CONFIG.notifySlack)),
      DEFAULT_CONFIG.notifySlack
    ),
  };
}

export function validateConfig(config: ClawVoiceConfig): ValidationResult {
  const validationErrors: string[] = [];

  if (!Number.isFinite(config.maxCallDuration) || config.maxCallDuration <= 0) {
    validationErrors.push(
      "maxCallDuration must be a positive number of seconds",
    );
  }

  if (
    config.disclosureEnabled &&
    config.disclosureStatement.trim().length === 0
  ) {
    validationErrors.push(
      "disclosureStatement must be non-empty when disclosureEnabled is true",
    );
  }

  if (validationErrors.length === 0) {
    return { ok: true, errors: [] };
  }

  return {
    ok: false,
    errors: validationErrors,
  };
}
