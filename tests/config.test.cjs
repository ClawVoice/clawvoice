const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveConfig, validateConfig } = require("../dist/config.js");

test("resolveConfig uses defaults when no values are provided", () => {
  const config = resolveConfig({}, {});

  assert.equal(config.mode, "self-hosted");
  assert.equal(config.telephonyProvider, "telnyx");
  assert.equal(config.voiceProvider, "deepgram-agent");
  assert.equal(config.maxCallDuration, 1800);
  assert.equal(config.disclosureEnabled, true);
  assert.equal(
    config.disclosureStatement,
    "Hello, this call is from an AI assistant calling on behalf of a user.",
  );
  assert.equal(config.restrictTools, true);
  assert.equal(config.analysisModel, "gpt-4o-mini");
  assert.equal(config.mainMemoryAccess, "read");
  assert.equal(config.autoExtractMemories, true);
  assert.equal(config.recordCalls, false);
  assert.equal(config.amdEnabled, true);
  assert.equal(config.relayUrl, "wss://relay.clawvoice.dev");
  assert.ok(Array.isArray(config.deniedTools));
  assert.ok(config.deniedTools.includes("exec"));
});

test("resolveConfig uses plugin config values when env vars are absent", () => {
  const config = resolveConfig(
    {
      mode: "managed",
      telephonyProvider: "twilio",
      voiceProvider: "elevenlabs-conversational",
      maxCallDuration: 900,
      disclosureEnabled: false,
      disclosureStatement: "This call may be monitored.",
      restrictTools: false,
      deniedTools: ["exec"],
      serviceToken: "plugin-token"
    },
    {}
  );

  assert.equal(config.mode, "managed");
  assert.equal(config.telephonyProvider, "twilio");
  assert.equal(config.voiceProvider, "elevenlabs-conversational");
  assert.equal(config.maxCallDuration, 900);
  assert.equal(config.disclosureEnabled, false);
  assert.equal(config.disclosureStatement, "This call may be monitored.");
  assert.equal(config.restrictTools, false);
  assert.deepEqual(config.deniedTools, ["exec"]);
  assert.equal(config.serviceToken, "plugin-token");
});

test("resolveConfig prioritizes environment variables over plugin config", () => {
  const config = resolveConfig(
    {
      mode: "self-hosted",
      telephonyProvider: "telnyx",
      voiceProvider: "deepgram-agent",
      maxCallDuration: 1800,
      restrictTools: true,
      deniedTools: ["exec"]
    },
    {
      CLAWVOICE_MODE: "managed",
      CLAWVOICE_TELEPHONY_PROVIDER: "twilio",
      CLAWVOICE_VOICE_PROVIDER: "elevenlabs-conversational",
      CLAWVOICE_MAX_CALL_DURATION: "1200",
      CLAWVOICE_DISCLOSURE_ENABLED: "false",
      CLAWVOICE_DISCLOSURE_STATEMENT: "This is an automated assistant call.",
      CLAWVOICE_RESTRICT_TOOLS: "false",
      CLAWVOICE_DENIED_TOOLS: "exec,browser,web_fetch",
      CLAWVOICE_SERVICE_TOKEN: "env-token"
    }
  );

  assert.equal(config.mode, "managed");
  assert.equal(config.telephonyProvider, "twilio");
  assert.equal(config.voiceProvider, "elevenlabs-conversational");
  assert.equal(config.maxCallDuration, 1200);
  assert.equal(config.disclosureEnabled, false);
  assert.equal(
    config.disclosureStatement,
    "This is an automated assistant call.",
  );
  assert.equal(config.restrictTools, false);
  assert.deepEqual(config.deniedTools, ["exec", "browser", "web_fetch"]);
  assert.equal(config.serviceToken, "env-token");
});

test("resolveConfig falls back to defaults for invalid enum values", () => {
  const config = resolveConfig(
    {
      mode: "invalid",
      telephonyProvider: "vonage",
      voiceProvider: "whisper"
    },
    {}
  );

  assert.equal(config.mode, "self-hosted", "invalid mode should fall back to default");
  assert.equal(config.telephonyProvider, "telnyx", "invalid telephony should fall back to default");
  assert.equal(config.voiceProvider, "deepgram-agent", "invalid voice provider should fall back to default");
});

test("resolveConfig falls back to defaults for invalid env enum values", () => {
  const config = resolveConfig(
    {},
    {
      CLAWVOICE_MODE: "banana",
      CLAWVOICE_TELEPHONY_PROVIDER: "banana",
      CLAWVOICE_VOICE_PROVIDER: "banana"
    }
  );

  assert.equal(config.mode, "self-hosted");
  assert.equal(config.telephonyProvider, "telnyx");
  assert.equal(config.voiceProvider, "deepgram-agent");
});

test("resolveConfig handles empty string env vars as absent", () => {
  const config = resolveConfig(
    { mode: "managed" },
    { CLAWVOICE_MODE: "" }
  );

  assert.equal(config.mode, "managed", "empty env var should not override plugin config");
});

test("resolveConfig resolves full provider field set from env and plugin config", () => {
  const config = resolveConfig(
    {
      telnyxConnectionId: "plugin-conn",
      deepgramVoice: "aura-luna-en",
      analysisModel: "gpt-4o-mini",
      mainMemoryAccess: "none",
      autoExtractMemories: false,
      recordCalls: true,
      amdEnabled: false,
      relayUrl: "wss://plugin-relay.example"
    },
    {
      TELNYX_API_KEY: "env-telnyx-key",
      TELNYX_PHONE_NUMBER: "+15550001111",
      TWILIO_ACCOUNT_SID: "env-twilio-sid",
      TWILIO_AUTH_TOKEN: "env-twilio-token",
      TWILIO_PHONE_NUMBER: "+15550002222",
      DEEPGRAM_API_KEY: "env-deepgram",
      CLAWVOICE_DEEPGRAM_VOICE: "aura-arcas-en",
      ELEVENLABS_API_KEY: "env-eleven",
      ELEVENLABS_AGENT_ID: "env-agent",
      ELEVENLABS_VOICE_ID: "env-voice",
      OPENAI_API_KEY: "env-openai",
      CLAWVOICE_ANALYSIS_MODEL: "gpt-4o",
      CLAWVOICE_MAIN_MEMORY_ACCESS: "read",
      CLAWVOICE_AUTO_EXTRACT_MEMORIES: "true",
      CLAWVOICE_RECORD_CALLS: "false",
      CLAWVOICE_AMD_ENABLED: "true",
      CLAWVOICE_RELAY_URL: "wss://env-relay.example"
    }
  );

  assert.equal(config.telnyxApiKey, "env-telnyx-key");
  assert.equal(config.telnyxConnectionId, "plugin-conn");
  assert.equal(config.telnyxPhoneNumber, "+15550001111");
  assert.equal(config.twilioAccountSid, "env-twilio-sid");
  assert.equal(config.twilioAuthToken, "env-twilio-token");
  assert.equal(config.twilioPhoneNumber, "+15550002222");
  assert.equal(config.deepgramApiKey, "env-deepgram");
  assert.equal(config.deepgramVoice, "aura-arcas-en");
  assert.equal(config.elevenlabsApiKey, "env-eleven");
  assert.equal(config.elevenlabsAgentId, "env-agent");
  assert.equal(config.elevenlabsVoiceId, "env-voice");
  assert.equal(config.openaiApiKey, "env-openai");
  assert.equal(config.analysisModel, "gpt-4o");
  assert.equal(config.mainMemoryAccess, "read");
  assert.equal(config.autoExtractMemories, true);
  assert.equal(config.recordCalls, false);
  assert.equal(config.amdEnabled, true);
  assert.equal(config.relayUrl, "wss://env-relay.example");
});

test("validateConfig passes for self-hosted telnyx + deepgram", () => {
  const config = resolveConfig(
    {
      mode: "self-hosted",
      telephonyProvider: "telnyx",
      voiceProvider: "deepgram-agent",
      telnyxApiKey: "a",
      telnyxConnectionId: "b",
      telnyxPhoneNumber: "+15550001111",
      deepgramApiKey: "c"
    },
    {}
  );

  const result = validateConfig(config);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("validateConfig passes for self-hosted twilio + deepgram", () => {
  const config = resolveConfig(
    {
      mode: "self-hosted",
      telephonyProvider: "twilio",
      voiceProvider: "deepgram-agent",
      twilioAccountSid: "sid",
      twilioAuthToken: "token",
      twilioPhoneNumber: "+15550002222",
      deepgramApiKey: "dg"
    },
    {}
  );

  const result = validateConfig(config);
  assert.equal(result.ok, true);
});

test("validateConfig fails for telnyx + elevenlabs when elevenlabs requirements missing", () => {
  const config = resolveConfig(
    {
      mode: "self-hosted",
      telephonyProvider: "telnyx",
      voiceProvider: "elevenlabs-conversational",
      telnyxApiKey: "a",
      telnyxConnectionId: "b",
      telnyxPhoneNumber: "+15550001111",
      deepgramApiKey: "dg"
    },
    {}
  );

  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("elevenlabsApiKey")));
  assert.ok(result.errors.some((message) => message.includes("elevenlabsAgentId")));
});

test("validateConfig requires serviceToken in managed mode", () => {
  const withoutToken = resolveConfig({ mode: "managed" }, {});
  const missingTokenResult = validateConfig(withoutToken);
  assert.equal(missingTokenResult.ok, false);
  assert.ok(missingTokenResult.errors.some((message) => message.includes("serviceToken")));

  const withToken = resolveConfig({ mode: "managed", serviceToken: "token" }, {});
  const withTokenResult = validateConfig(withToken);
  assert.equal(withTokenResult.ok, true);
});

test("validateConfig requires positive maxCallDuration", () => {
  const config = resolveConfig(
    {
      mode: "self-hosted",
      telephonyProvider: "telnyx",
      voiceProvider: "deepgram-agent",
      telnyxApiKey: "a",
      telnyxConnectionId: "b",
      telnyxPhoneNumber: "+15550001111",
      deepgramApiKey: "c",
      maxCallDuration: 0,
    },
    {},
  );

  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((message) =>
      message.includes("maxCallDuration must be a positive number of seconds"),
    ),
  );
});

test("validateConfig requires disclosure statement when disclosure is enabled", () => {
  const config = resolveConfig(
    {
      mode: "self-hosted",
      telephonyProvider: "telnyx",
      voiceProvider: "deepgram-agent",
      telnyxApiKey: "a",
      telnyxConnectionId: "b",
      telnyxPhoneNumber: "+15550001111",
      deepgramApiKey: "c",
      disclosureEnabled: true,
      disclosureStatement: "   ",
    },
    {},
  );

  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((message) =>
      message.includes(
        "disclosureStatement must be non-empty when disclosureEnabled is true",
      ),
    ),
  );
});
