"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ELEVENLABS_VOICES = void 0;
exports.resolveConfig = resolveConfig;
exports.validateConfig = validateConfig;
/** Well-known ElevenLabs voice IDs for Conversational AI use. Set via `elevenlabsVoiceId`. */
exports.ELEVENLABS_VOICES = {
    Eryn: "DXFkLCBUTmvXpp2QwZjA", // female, natural/conversational
    Mark: "UgBBYS2sOqTuMpoF3BR0", // male, professional/clear
    Joseph: "8fcyCHOzlKDlxh1InJSf", // male, warm/measured
};
const DEFAULT_CONFIG = {
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
    disclosureStatement: "Hello, this call is from an AI assistant calling on behalf of a user.",
    dailyCallLimit: 50,
    recordCalls: false,
    amdEnabled: true,
    mediaStreamBind: "127.0.0.1",
    mediaStreamPort: 3101,
    mediaStreamPath: "/media-stream",
    smsAutoReply: true,
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
    notificationTimezone: "America/Chicago",
    tailscaleMode: "off",
    tailscalePath: "/media-stream",
};
function parseBoolean(value, fallback) {
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
function parseMainMemoryAccess(value) {
    return value === "read" || value === "none" ? value : undefined;
}
function parseNumber(value, fallback) {
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
function parseStringArray(value, fallback) {
    if (Array.isArray(value)) {
        const filtered = value.filter((entry) => typeof entry === "string");
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
function envString(env, key) {
    const value = env[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function getValue(envValue, configValue, fallback) {
    if (typeof envValue !== "undefined") {
        return envValue;
    }
    if (typeof configValue !== "undefined") {
        return configValue;
    }
    return fallback;
}
function parseTelephonyProvider(value) {
    return value === "telnyx" || value === "twilio" ? value : undefined;
}
function parseVoiceProvider(value) {
    return value === "deepgram-agent" || value === "elevenlabs-conversational" ? value : undefined;
}
function parseTailscaleMode(value) {
    return value === "off" || value === "serve" || value === "funnel" ? value : undefined;
}
function validateTwilioStreamUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return "twilioStreamUrl must be a valid absolute URL (for example: wss://your-host.example.com/media-stream)";
    }
    if (parsed.protocol !== "wss:") {
        return "twilioStreamUrl must use wss:// (Twilio Media Streams require WebSocket TLS)";
    }
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        return "twilioStreamUrl cannot point to localhost/loopback; use a publicly reachable HTTPS/WSS hostname";
    }
    const path = parsed.pathname.toLowerCase();
    if (path.includes("/webhook") || path.includes("/webhooks")) {
        return "twilioStreamUrl must point to a WebSocket media endpoint, not an HTTP webhook path";
    }
    return undefined;
}
function resolveConfig(pluginConfig = {}, env = process.env) {
    const envTelephony = parseTelephonyProvider(envString(env, "CLAWVOICE_TELEPHONY_PROVIDER"));
    const envVoice = parseVoiceProvider(envString(env, "CLAWVOICE_VOICE_PROVIDER"));
    const envTelnyxApiKey = envString(env, "TELNYX_API_KEY");
    const envTelnyxConnectionId = envString(env, "TELNYX_CONNECTION_ID");
    const envTelnyxPhoneNumber = envString(env, "TELNYX_PHONE_NUMBER");
    const envTelnyxWebhookSecret = envString(env, "TELNYX_WEBHOOK_SECRET");
    const envTwilioAccountSid = envString(env, "TWILIO_ACCOUNT_SID");
    const envTwilioAuthToken = envString(env, "TWILIO_AUTH_TOKEN");
    const envTwilioPhoneNumber = envString(env, "TWILIO_PHONE_NUMBER");
    const envTwilioStreamUrl = envString(env, "CLAWVOICE_TWILIO_STREAM_URL");
    const envDeepgramApiKey = envString(env, "DEEPGRAM_API_KEY");
    const envMediaStreamBind = envString(env, "CLAWVOICE_MEDIA_STREAM_BIND");
    const envMediaStreamPath = envString(env, "CLAWVOICE_MEDIA_STREAM_PATH");
    const envDeepgramVoice = envString(env, "CLAWVOICE_DEEPGRAM_VOICE");
    const envElevenlabsApiKey = envString(env, "ELEVENLABS_API_KEY");
    const envElevenlabsAgentId = envString(env, "ELEVENLABS_AGENT_ID");
    const envElevenlabsVoiceId = envString(env, "ELEVENLABS_VOICE_ID");
    const envOpenaiApiKey = envString(env, "OPENAI_API_KEY");
    const envAnalysisModel = envString(env, "CLAWVOICE_ANALYSIS_MODEL");
    const envMainMemoryAccess = parseMainMemoryAccess(envString(env, "CLAWVOICE_MAIN_MEMORY_ACCESS"));
    const envAutoExtractMemories = envString(env, "CLAWVOICE_AUTO_EXTRACT_MEMORIES");
    const envMaxCallDuration = envString(env, "CLAWVOICE_MAX_CALL_DURATION");
    const envMediaStreamPort = envString(env, "CLAWVOICE_MEDIA_STREAM_PORT");
    const envRecordCalls = envString(env, "CLAWVOICE_RECORD_CALLS");
    const envDisclosureEnabled = envString(env, "CLAWVOICE_DISCLOSURE_ENABLED");
    const envDisclosureStatement = envString(env, "CLAWVOICE_DISCLOSURE_STATEMENT");
    const envAmdEnabled = envString(env, "CLAWVOICE_AMD_ENABLED");
    const envSmsAutoReply = envString(env, "CLAWVOICE_SMS_AUTO_REPLY");
    const envRestrictTools = envString(env, "CLAWVOICE_RESTRICT_TOOLS");
    const envDeniedTools = envString(env, "CLAWVOICE_DENIED_TOOLS");
    const envVoiceSystemPrompt = envString(env, "CLAWVOICE_VOICE_SYSTEM_PROMPT");
    const envInboundEnabled = envString(env, "CLAWVOICE_INBOUND_ENABLED");
    const envDailyCallLimit = envString(env, "CLAWVOICE_DAILY_CALL_LIMIT");
    const envNotificationTimezone = envString(env, "CLAWVOICE_NOTIFICATION_TIMEZONE");
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
        twilioStreamUrl: getValue(envTwilioStreamUrl, typeof pluginConfig.twilioStreamUrl === "string" ? pluginConfig.twilioStreamUrl : undefined, undefined),
        deepgramApiKey: getValue(envDeepgramApiKey, typeof pluginConfig.deepgramApiKey === "string" ? pluginConfig.deepgramApiKey : undefined, undefined),
        mediaStreamBind: getValue(envMediaStreamBind, typeof pluginConfig.mediaStreamBind === "string" ? pluginConfig.mediaStreamBind : undefined, DEFAULT_CONFIG.mediaStreamBind),
        mediaStreamPort: parseNumber(getValue(envMediaStreamPort, typeof pluginConfig.mediaStreamPort === "undefined" ? undefined : String(pluginConfig.mediaStreamPort), String(DEFAULT_CONFIG.mediaStreamPort)), DEFAULT_CONFIG.mediaStreamPort),
        mediaStreamPath: getValue(envMediaStreamPath, typeof pluginConfig.mediaStreamPath === "string" ? pluginConfig.mediaStreamPath : undefined, DEFAULT_CONFIG.mediaStreamPath),
        deepgramVoice: getValue(envDeepgramVoice, typeof pluginConfig.deepgramVoice === "string" ? pluginConfig.deepgramVoice : undefined, DEFAULT_CONFIG.deepgramVoice),
        elevenlabsApiKey: getValue(envElevenlabsApiKey, typeof pluginConfig.elevenlabsApiKey === "string" ? pluginConfig.elevenlabsApiKey : undefined, undefined),
        elevenlabsAgentId: getValue(envElevenlabsAgentId, typeof pluginConfig.elevenlabsAgentId === "string" ? pluginConfig.elevenlabsAgentId : undefined, undefined),
        elevenlabsVoiceId: getValue(envElevenlabsVoiceId, typeof pluginConfig.elevenlabsVoiceId === "string" ? pluginConfig.elevenlabsVoiceId : undefined, undefined),
        openaiApiKey: getValue(envOpenaiApiKey, typeof pluginConfig.openaiApiKey === "string" ? pluginConfig.openaiApiKey : undefined, undefined),
        analysisModel: getValue(envAnalysisModel, typeof pluginConfig.analysisModel === "string" ? pluginConfig.analysisModel : undefined, DEFAULT_CONFIG.analysisModel),
        mainMemoryAccess: getValue(envMainMemoryAccess, configMainMemoryAccess, DEFAULT_CONFIG.mainMemoryAccess),
        autoExtractMemories: parseBoolean(getValue(envAutoExtractMemories, typeof pluginConfig.autoExtractMemories === "undefined" ? undefined : String(pluginConfig.autoExtractMemories), String(DEFAULT_CONFIG.autoExtractMemories)), DEFAULT_CONFIG.autoExtractMemories),
        maxCallDuration: parseNumber(getValue(envMaxCallDuration, typeof pluginConfig.maxCallDuration === "undefined" ? undefined : String(pluginConfig.maxCallDuration), String(DEFAULT_CONFIG.maxCallDuration)), DEFAULT_CONFIG.maxCallDuration),
        disclosureEnabled: parseBoolean(getValue(envDisclosureEnabled, typeof pluginConfig.disclosureEnabled === "undefined"
            ? undefined
            : String(pluginConfig.disclosureEnabled), String(DEFAULT_CONFIG.disclosureEnabled)), DEFAULT_CONFIG.disclosureEnabled),
        disclosureStatement: getValue(envDisclosureStatement, typeof pluginConfig.disclosureStatement === "string"
            ? pluginConfig.disclosureStatement
            : undefined, DEFAULT_CONFIG.disclosureStatement),
        dailyCallLimit: parseNumber(getValue(envDailyCallLimit, typeof pluginConfig.dailyCallLimit === "undefined" ? undefined : String(pluginConfig.dailyCallLimit), String(DEFAULT_CONFIG.dailyCallLimit)), DEFAULT_CONFIG.dailyCallLimit),
        recordCalls: parseBoolean(getValue(envRecordCalls, typeof pluginConfig.recordCalls === "undefined" ? undefined : String(pluginConfig.recordCalls), String(DEFAULT_CONFIG.recordCalls)), DEFAULT_CONFIG.recordCalls),
        amdEnabled: parseBoolean(getValue(envAmdEnabled, typeof pluginConfig.amdEnabled === "undefined" ? undefined : String(pluginConfig.amdEnabled), String(DEFAULT_CONFIG.amdEnabled)), DEFAULT_CONFIG.amdEnabled),
        voiceSystemPrompt: getValue(envVoiceSystemPrompt, typeof pluginConfig.voiceSystemPrompt === "string" ? pluginConfig.voiceSystemPrompt : undefined, DEFAULT_CONFIG.voiceSystemPrompt),
        inboundEnabled: parseBoolean(getValue(envInboundEnabled, typeof pluginConfig.inboundEnabled === "undefined" ? undefined : String(pluginConfig.inboundEnabled), String(DEFAULT_CONFIG.inboundEnabled)), DEFAULT_CONFIG.inboundEnabled),
        smsAutoReply: parseBoolean(getValue(envSmsAutoReply, typeof pluginConfig.smsAutoReply === "undefined" ? undefined : String(pluginConfig.smsAutoReply), String(DEFAULT_CONFIG.smsAutoReply)), DEFAULT_CONFIG.smsAutoReply),
        restrictTools: parseBoolean(getValue(envRestrictTools, typeof pluginConfig.restrictTools === "undefined" ? undefined : String(pluginConfig.restrictTools), String(DEFAULT_CONFIG.restrictTools)), DEFAULT_CONFIG.restrictTools),
        deniedTools: parseStringArray(getValue(envDeniedTools, pluginConfig.deniedTools, DEFAULT_CONFIG.deniedTools), DEFAULT_CONFIG.deniedTools),
        notifyTelegram: parseBoolean(getValue(envString(env, "CLAWVOICE_NOTIFY_TELEGRAM"), typeof pluginConfig.notifyTelegram === "undefined" ? undefined : String(pluginConfig.notifyTelegram), String(DEFAULT_CONFIG.notifyTelegram)), DEFAULT_CONFIG.notifyTelegram),
        notifyDiscord: parseBoolean(getValue(envString(env, "CLAWVOICE_NOTIFY_DISCORD"), typeof pluginConfig.notifyDiscord === "undefined" ? undefined : String(pluginConfig.notifyDiscord), String(DEFAULT_CONFIG.notifyDiscord)), DEFAULT_CONFIG.notifyDiscord),
        notifySlack: parseBoolean(getValue(envString(env, "CLAWVOICE_NOTIFY_SLACK"), typeof pluginConfig.notifySlack === "undefined" ? undefined : String(pluginConfig.notifySlack), String(DEFAULT_CONFIG.notifySlack)), DEFAULT_CONFIG.notifySlack),
        notificationTimezone: getValue(envNotificationTimezone, typeof pluginConfig.notificationTimezone === "string" ? pluginConfig.notificationTimezone : undefined, DEFAULT_CONFIG.notificationTimezone),
        tailscaleMode: getValue(parseTailscaleMode(envString(env, "CLAWVOICE_TAILSCALE_MODE")), parseTailscaleMode(pluginConfig.tailscaleMode), DEFAULT_CONFIG.tailscaleMode),
        tailscalePath: getValue(envString(env, "CLAWVOICE_TAILSCALE_PATH"), typeof pluginConfig.tailscalePath === "string" ? pluginConfig.tailscalePath : undefined, DEFAULT_CONFIG.tailscalePath),
    };
}
function validateConfig(config) {
    const validationErrors = [];
    if (!Number.isFinite(config.maxCallDuration) || config.maxCallDuration <= 0) {
        validationErrors.push("maxCallDuration must be a positive number of seconds");
    }
    if (!Number.isFinite(config.mediaStreamPort) || config.mediaStreamPort <= 0) {
        validationErrors.push("mediaStreamPort must be a positive number");
    }
    if (!config.mediaStreamPath.startsWith("/")) {
        validationErrors.push("mediaStreamPath must start with '/'");
    }
    if (!config.tailscalePath || config.tailscalePath.trim().length === 0) {
        validationErrors.push("tailscalePath must not be empty");
    }
    else if (!config.tailscalePath.startsWith("/")) {
        validationErrors.push("tailscalePath must start with '/'");
    }
    if (config.disclosureEnabled &&
        config.disclosureStatement.trim().length === 0) {
        validationErrors.push("disclosureStatement must be non-empty when disclosureEnabled is true");
    }
    // Credential/endpoint presence is enforced at call time by validateCallReadiness()
    // and surfaced by diagnostics. validateConfig only checks structural format.
    if (!config.notificationTimezone || !config.notificationTimezone.trim()) {
        validationErrors.push('notificationTimezone must not be blank (e.g. "America/New_York")');
    }
    else {
        try {
            Intl.DateTimeFormat(undefined, { timeZone: config.notificationTimezone });
        }
        catch {
            validationErrors.push(`notificationTimezone "${config.notificationTimezone}" is not a valid IANA timezone (e.g. "America/New_York")`);
        }
    }
    if (config.telephonyProvider === "twilio" && config.twilioStreamUrl) {
        const streamUrlError = validateTwilioStreamUrl(config.twilioStreamUrl);
        if (streamUrlError) {
            validationErrors.push(streamUrlError);
        }
    }
    if (validationErrors.length === 0) {
        return { ok: true, errors: [] };
    }
    return {
        ok: false,
        errors: validationErrors,
    };
}
