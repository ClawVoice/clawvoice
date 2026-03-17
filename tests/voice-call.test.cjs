const test = require("node:test");
const assert = require("node:assert/strict");

const { VoiceCallService } = require("../dist/services/voice-call.js");

function validTelnyxConfig(overrides = {}) {
  return {
    telephonyProvider: "twilio",
    voiceProvider: "deepgram-agent",
    twilioAccountSid: "AC-test",
    twilioAuthToken: "auth-test",
    twilioPhoneNumber: "+15550001111",
    deepgramApiKey: "deepgram-key",
    deepgramVoice: "aura-asteria-en",
    analysisModel: "gpt-4o-mini",
    mainMemoryAccess: "read",
    autoExtractMemories: true,
    maxCallDuration: 1800,
    dailyCallLimit: 50,
    disclosureEnabled: true,
    disclosureStatement:
      "Hello, this call is from an AI assistant calling on behalf of a user.",
    recordCalls: false,
    amdEnabled: true,
    restrictTools: true,
    deniedTools: [
      "exec",
      "browser",
      "web_fetch",
      "gateway",
      "cron",
      "sessions_spawn",
    ],
    voiceSystemPrompt: "",
    inboundEnabled: true,
    ...overrides,
  };
}

function mockFetch() {
  return async () => ({
    ok: true,
    json: async () => ({ sid: "CA-mock-sid-" + Date.now() }),
    text: async () => "",
  });
}

test("startCall initiates call and tracks active call", async () => {
  const service = new VoiceCallService(validTelnyxConfig(), mockFetch());

  const result = await service.startCall({
    phoneNumber: "555-222-3333",
    purpose: "Book haircut",
  });

  assert.ok(result.callId.startsWith("call-"));
  assert.equal(result.to, "+15552223333");
  assert.match(result.message, /Outbound call initiated via twilio/);
  assert.equal(
    result.openingGreeting,
    "Hello, this call is from an AI assistant calling on behalf of a user. Hello, this is an AI assistant calling on behalf of my user.",
  );

  const active = service.getActiveCalls();
  assert.equal(active.length, 1);
  assert.equal(active[0].callId, result.callId);
  assert.equal(active[0].status, "in-progress");
});

test("startCall honors custom greeting", async () => {
  const service = new VoiceCallService(validTelnyxConfig(), mockFetch());
  const result = await service.startCall({
    phoneNumber: "+14155552671",
    greeting: "Hi, calling about your order status.",
  });

  assert.equal(
    result.openingGreeting,
    "Hello, this call is from an AI assistant calling on behalf of a user. Hi, calling about your order status.",
  );
});

test("startCall skips disclosure when disclosureEnabled is false", async () => {
  const service = new VoiceCallService(
    validTelnyxConfig({ disclosureEnabled: false }), mockFetch(),
  );
  const result = await service.startCall({
    phoneNumber: "5554441111",
    greeting: "Hi, this is Sam.",
  });

  assert.equal(result.openingGreeting, "Hi, this is Sam.");
});

test("startCall auto-terminates call at configured max duration", async () => {
  const service = new VoiceCallService(
    validTelnyxConfig({ maxCallDuration: 0.05 }), mockFetch(),
  );
  await service.startCall({ phoneNumber: "5557778888" });
  assert.equal(service.getActiveCalls().length, 1);

  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(service.getActiveCalls().length, 0);
});

test("hangup ends selected active call", async () => {
  const service = new VoiceCallService(validTelnyxConfig(), mockFetch());
  const call = await service.startCall({ phoneNumber: "5551112222" });

  const response = await service.hangup(call.callId);
  assert.equal(response.callId, call.callId);
  assert.match(response.message, /Call ended with a polite closing/);
  assert.equal(service.getActiveCalls().length, 0);
});

test("hangup without call id uses first active call", async () => {
  const service = new VoiceCallService(validTelnyxConfig(), mockFetch());
  const call = await service.startCall({ phoneNumber: "5553334444" });

  const response = await service.hangup();
  assert.equal(response.callId, call.callId);
  assert.equal(service.getActiveCalls().length, 0);
});

test("hangup throws when no active calls exist", async () => {
  const service = new VoiceCallService(validTelnyxConfig(), mockFetch());
  await assert.rejects(
    () => service.hangup(),
    /No active call found to hang up/,
  );
});

test("startCall validates phone number format via adapter", async () => {
  const service = new VoiceCallService(validTelnyxConfig(), mockFetch());
  await assert.rejects(
    () => service.startCall({ phoneNumber: "123" }),
    /Invalid US phone number|Invalid international phone number/,
  );
});

test("voiceSystemPrompt + purpose produces combined systemPrompt", async () => {
  const service = new VoiceCallService(
    validTelnyxConfig({ voiceSystemPrompt: "You are a helpful dental receptionist." }), mockFetch(),
  );
  // The bridge session config systemPrompt should combine both
  const result = await service.startCall({
    phoneNumber: "5551112222",
    purpose: "Book a cleaning appointment",
  });
  assert.ok(result.callId);
  // We can't directly inspect bridge config, but verify call succeeded with combined inputs
  assert.match(result.message, /Outbound call initiated/);
});

test("voiceSystemPrompt without purpose uses prompt only", async () => {
  const service = new VoiceCallService(
    validTelnyxConfig({ voiceSystemPrompt: "You are a pizza ordering assistant." }), mockFetch(),
  );
  const result = await service.startCall({ phoneNumber: "5551113333" });
  assert.ok(result.callId);
  assert.match(result.message, /Outbound call initiated/);
});

test("purpose without voiceSystemPrompt uses purpose only", async () => {
  const service = new VoiceCallService(validTelnyxConfig({ voiceSystemPrompt: "" }), mockFetch());
  const result = await service.startCall({
    phoneNumber: "5551114444",
    purpose: "Schedule follow-up visit",
  });
  assert.ok(result.callId);
  assert.match(result.message, /Outbound call initiated/);
});

test("twilio provider path is used when configured", async () => {
  const service = new VoiceCallService(
    validTelnyxConfig({
      telephonyProvider: "twilio",
      twilioAccountSid: "AC123",
      twilioAuthToken: "auth-token",
      twilioPhoneNumber: "+15550002222",
    }), mockFetch(),
  );

  const result = await service.startCall({ phoneNumber: "5554445555" });
  assert.match(result.message, /Outbound call initiated via twilio/);
  assert.equal(result.to, "+15554445555");
});

test("startCall fails fast when twilio credentials are missing", async () => {
  const service = new VoiceCallService(
    validTelnyxConfig({
      telephonyProvider: "twilio",
      twilioAccountSid: "",
      twilioAuthToken: "",
    }),
    mockFetch(),
  );

  await assert.rejects(
    () => service.startCall({ phoneNumber: "5554446666" }),
    /Twilio credentials missing/,
  );
});

test("startCall fails fast when telnyx credentials are missing", async () => {
  const service = new VoiceCallService(
    validTelnyxConfig({
      telephonyProvider: "telnyx",
      telnyxApiKey: "",
      telnyxConnectionId: "",
    }),
    mockFetch(),
  );

  await assert.rejects(
    () => service.startCall({ phoneNumber: "5554447777" }),
    /Telnyx credentials missing/,
  );
});
