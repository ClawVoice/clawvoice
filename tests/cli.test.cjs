const test = require("node:test");
const assert = require("node:assert/strict");

const { runSetupWizard, registerCLI } = require("../dist/cli.js");

function createPrompter(answers) {
  const queue = [...answers];
  return {
    ask: async () => {
      const next = queue.shift();
      return typeof next === "string" ? next : "";
    },
    close: () => {}
  };
}

function createApi() {
  const state = {
    saved: null,
    logs: []
  };

  const api = {
    config: {
      async setMany(values) {
        state.saved = values;
      }
    },
    log: {
      info(message, metadata) {
        state.logs.push({ message, metadata });
      }
    }
  };

  return { api, state };
}

test("runSetupWizard collects twilio + elevenlabs credentials", async () => {
  const { api, state } = createApi();
  const prompter = createPrompter([
    "twilio",              // telephony provider
    "AC123",               // twilio account SID
    "auth123",             // twilio auth token
    "+15551112222",        // twilio phone number
    "no",                  // use detected ngrok tunnel? (or this is the stream URL if ngrok not detected)
    "wss://my-tunnel.ngrok-free.dev/media-stream",  // manual stream URL
    "elevenlabs-conversational",  // voice provider
    "dg-key",              // deepgram API key
    "el-key",              // elevenlabs API key
    "agent-1",             // elevenlabs agent ID
    "yes",                 // confirmed ElevenLabs agent setup?
    "no",                  // auto-configure Twilio webhooks?
  ]);

  await runSetupWizard(api, [], prompter);

  assert.equal(state.saved.telephonyProvider, "twilio");
  assert.equal(state.saved.twilioAccountSid, "AC123");
  assert.equal(state.saved.twilioAuthToken, "auth123");
  assert.equal(state.saved.twilioPhoneNumber, "+15551112222");
  assert.equal(state.saved.twilioStreamUrl, "wss://my-tunnel.ngrok-free.dev/media-stream");
  assert.equal(state.saved.voiceProvider, "elevenlabs-conversational");
  assert.equal(state.saved.deepgramApiKey, "dg-key");
  assert.equal(state.saved.elevenlabsApiKey, "el-key");
  assert.equal(state.saved.elevenlabsAgentId, "agent-1");
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].metadata.deepgramApiKey, "dg-k...");
});

// --- Story 4.1: CLI Call Initiation ---

function createMockCallService() {
  const calls = [];
  const summaries = {};
  return {
    calls,
    summaries,
    async startCall(request) {
      const entry = { ...request, callId: "call-mock-001" };
      calls.push(entry);
      return {
        callId: "call-mock-001",
        to: request.phoneNumber,
        openingGreeting: request.greeting || "Hello, this is an AI assistant calling on behalf of my user.",
        message: "Outbound call initiated via telnyx."
      };
    },
    async hangup() { return { callId: "call-mock-001", message: "Call ended." }; },
    getActiveCalls() { return calls.map((c) => ({ callId: c.callId, to: c.phoneNumber, provider: "telnyx", status: "in-progress", startedAt: new Date().toISOString() })); },
    getCallSummary(callId) { return summaries[callId] || null; }
  };
}

function createCliApi() {
  const registered = [];
  const logs = [];
  return {
    api: {
      cli: { register(def) { registered.push(def); } },
      log: { info(msg, meta) { logs.push({ message: msg, metadata: meta }); } }
    },
    registered,
    logs
  };
}

function validCliConfig() {
  return {
    telephonyProvider: "twilio",
    voiceProvider: "deepgram-agent",
    twilioAccountSid: "AC-test",
    twilioAuthToken: "auth-test",
    twilioPhoneNumber: "+15550001111",
    deepgramApiKey: "dg",
    maxCallDuration: 1800,
    dailyCallLimit: 50,
    restrictTools: true,
    deniedTools: [],
    mainMemoryAccess: "read",
    deepgramVoice: "evelyn",
    disclosureEnabled: true,
    disclosureStatement: "This is an AI call.",
    voiceSystemPrompt: "",
    inboundEnabled: true
  };
}

test("clawvoice call shows usage when no phone number provided", async () => {
  const { api, registered, logs } = createCliApi();
  const callService = createMockCallService();
  registerCLI(api, validCliConfig(), callService);

  const callCmd = registered.find((c) => c.name === "clawvoice call");
  assert.ok(callCmd);
  await callCmd.run([]);
  assert.ok(logs.some((l) => l.message.includes("Usage")));
});

test("clawvoice call initiates call with phone number", async () => {
  const { api, registered, logs } = createCliApi();
  const callService = createMockCallService();
  registerCLI(api, validCliConfig(), callService);

  const callCmd = registered.find((c) => c.name === "clawvoice call");
  await callCmd.run(["+15559998888"]);
  assert.equal(callService.calls.length, 1);
  assert.equal(callService.calls[0].phoneNumber, "+15559998888");
  assert.ok(logs.some((l) => l.message === "Call started"));
});

test("clawvoice call passes --greeting flag", async () => {
  const { api, registered } = createCliApi();
  const callService = createMockCallService();
  registerCLI(api, validCliConfig(), callService);

  const callCmd = registered.find((c) => c.name === "clawvoice call");
  await callCmd.run(["+15559998888", "--greeting", "Hi there!"]);
  assert.equal(callService.calls[0].greeting, "Hi there!");
});

test("clawvoice call prints error when startCall fails", async () => {
  const { api, registered, logs } = createCliApi();
  const callService = createMockCallService();
  callService.startCall = async () => {
    throw new Error("Cannot initiate call — missing configuration");
  };
  registerCLI(api, validCliConfig(), callService);

  const callCmd = registered.find((c) => c.name === "clawvoice call");
  await callCmd.run(["+15559998888"]);

  assert.ok(logs.some((l) => l.message === "Call failed"));
});

test("clawvoice sms rejects non-E.164 phone numbers", async () => {
  const { api, registered, logs } = createCliApi();
  const callService = createMockCallService();
  registerCLI(api, validCliConfig(), callService);

  const smsCmd = registered.find((c) => c.name === "clawvoice sms");
  assert.ok(smsCmd);
  await smsCmd.run(["5559998888", "--message", "hello"]);

  assert.ok(logs.some((l) => l.message.includes("E.164")));
});

// --- Story 4.2: CLI Call History ---

test("clawvoice history shows no calls when empty", async () => {
  const { api, registered, logs } = createCliApi();
  const callService = createMockCallService();
  registerCLI(api, validCliConfig(), callService);

  const historyCmd = registered.find((c) => c.name === "clawvoice history");
  await historyCmd.run([]);
  assert.ok(logs.some((l) => l.message.includes("No recent calls")));
});

test("clawvoice history shows call detail when callId has summary", async () => {
  const { api, registered, logs } = createCliApi();
  const callService = createMockCallService();
  callService.summaries["call-detail-1"] = {
    callId: "call-detail-1",
    outcome: "completed",
    durationMs: 65000,
    transcriptLength: 10,
    failures: [],
    pendingActions: [],
    retryContext: null,
    completedAt: new Date().toISOString()
  };
  registerCLI(api, validCliConfig(), callService);

  const historyCmd = registered.find((c) => c.name === "clawvoice history");
  await historyCmd.run(["call-detail-1"]);
  assert.ok(logs.some((l) => l.message === "Call detail" && l.metadata.outcome === "completed"));
});
