const test = require("node:test");
const assert = require("node:assert/strict");

const { registerTools } = require("../dist/tools.js");

function validConfig(overrides = {}) {
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

function createMockCallService() {
  return {
    calls: [],
    hangups: [],
    async startCall(input) {
      this.calls.push(input);
      return {
        callId: "call-123",
        to: "+15551234567",
        openingGreeting: input.greeting || "Hello",
        message: "Outbound call initiated via twilio.",
      };
    },
    async hangup(callId) {
      this.hangups.push(callId);
      return {
        callId: callId || "call-123",
        message:
          "Call ended with a polite closing and clean connection termination.",
      };
    },
    texts: [],
    async sendText(input) {
      this.texts.push(input);
      return {
        messageId: "sms-123",
        to: "+15551234567",
        message: "Outbound text sent via twilio.",
      };
    },
    getRecentTexts() {
      return this.texts.map((entry, index) => ({
        id: `sms-${index + 1}`,
        direction: "outbound",
        provider: "twilio",
        from: "+15550001111",
        to: entry.phoneNumber,
        body: entry.message,
        createdAt: new Date().toISOString(),
      }));
    },
    getCallSummary() {
      return undefined;
    },
    getActiveCalls() {
      return this.calls.length > 0
        ? [{ callId: "call-123", status: "in-progress" }]
        : [];
    },
  };
}

function registerAndGetTools(config, callService) {
  const state = { tools: [] };
  const api = {
    tools: {
      register(definition) {
        state.tools.push(definition);
      },
    },
  };

  registerTools(api, config, callService);
  return state.tools;
}

function getTool(tools, name) {
  return tools.find((tool) => tool.name === name);
}

test("registerTools registers expected tool names", () => {
  const tools = registerAndGetTools(validConfig(), createMockCallService());
  const names = tools.map((tool) => tool.name).sort();

  assert.deepEqual(names, [
    "voice_assistant.call",
    "voice_assistant.clear_calls",
    "voice_assistant.hangup",
    "voice_assistant.promote_memory",
    "voice_assistant.send_text",
    "voice_assistant.status",
    "voice_assistant.text_status",
  ]);
});

test("send_text handler sends message and returns structured response", async () => {
  const callService = createMockCallService();
  const tools = registerAndGetTools(validConfig(), callService);
  const smsTool = getTool(tools, "voice_assistant.send_text");

  const result = await smsTool.handler({
    phoneNumber: "+15559876543",
    message: "Hello from ClawVoice",
  });

  assert.equal(callService.texts.length, 1);
  assert.equal(callService.texts[0].phoneNumber, "+15559876543");
  assert.equal(callService.texts[0].message, "Hello from ClawVoice");
  assert.equal(result.data.messageId, "sms-123");
  assert.match(result.content, /Outbound text sent/);
});

test("call handler invokes call service and returns structured response", async () => {
  const callService = createMockCallService();
  const tools = registerAndGetTools(validConfig(), callService);
  const callTool = getTool(tools, "voice_assistant.call");

  const result = await callTool.handler({
    phoneNumber: "5551234567",
    purpose: "Book an appointment",
    greeting: "Hi there",
  });

  assert.equal(callService.calls.length, 1);
  assert.equal(callService.calls[0].phoneNumber, "5551234567");
  assert.equal(callService.calls[0].purpose, "Book an appointment");
  assert.equal(callService.calls[0].greeting, "Hi there");

  assert.match(result.content, /Outbound call initiated/);
  assert.equal(result.data.callId, "call-123");
  assert.equal(result.data.provider, "twilio");
});

test("call handler rejects empty phone number", async () => {
  const tools = registerAndGetTools(validConfig(), createMockCallService());
  const callTool = getTool(tools, "voice_assistant.call");

  await assert.rejects(
    () => callTool.handler({ phoneNumber: "  " }),
    /phoneNumber is required and must be a non-empty string/,
  );
});

test("hangup handler forwards optional call id", async () => {
  const callService = createMockCallService();
  const tools = registerAndGetTools(validConfig(), callService);
  const hangupTool = getTool(tools, "voice_assistant.hangup");

  await hangupTool.handler({ callId: "call-abc" });
  await hangupTool.handler({});

  assert.deepEqual(callService.hangups, ["call-abc", undefined]);
});

test("status handler reports active call count", async () => {
  const callService = createMockCallService();
  const tools = registerAndGetTools(validConfig(), callService);
  const callTool = getTool(tools, "voice_assistant.call");
  const statusTool = getTool(tools, "voice_assistant.status");

  const statusBefore = await statusTool.handler({});
  assert.equal(statusBefore.content, "No active calls.");

  await callTool.handler({ phoneNumber: "5551112222" });
  const statusAfter = await statusTool.handler({});
  assert.match(statusAfter.content, /There are 1 active call\(s\)/);
  assert.equal(Array.isArray(statusAfter.data.activeCalls), true);
});

test("status handler returns call summary when callId provided", async () => {
  const callService = createMockCallService();
  callService.getCallSummary = (callId) => ({
    callId,
    outcome: "partial",
    durationMs: 45000,
    transcriptLength: 8,
    failures: [
      {
        type: "tool_failure",
        description: "Calendar API timeout",
        timestamp: Date.now(),
      },
    ],
    pendingActions: ["book_appointment(date: tomorrow)"],
    retryContext: {
      originalCallId: callId,
      failureReasons: ["tool_failure: Calendar API timeout"],
      uncompletedActions: ["book_appointment(date: tomorrow)"],
      previousTranscriptSummary: "User requested appointment booking",
      suggestedApproach:
        "Retry with pre-resolved calendar availability to avoid API timeout.",
    },
    completedAt: new Date(),
  });

  const tools = registerAndGetTools(validConfig(), callService);
  const statusTool = getTool(tools, "voice_assistant.status");

  const result = await statusTool.handler({ callId: "call-456" });
  assert.match(result.content, /partial/i);
  assert.equal(result.data.summary.callId, "call-456");
  assert.equal(result.data.summary.outcome, "partial");
  assert.ok(result.data.summary.retryContext !== null);
});

test("status handler falls through to active calls when callId has no summary", async () => {
  const callService = createMockCallService();
  callService.getCallSummary = () => undefined;

  const tools = registerAndGetTools(validConfig(), callService);
  const statusTool = getTool(tools, "voice_assistant.status");

  const result = await statusTool.handler({ callId: "call-missing" });
  assert.match(result.content, /No active calls/);
});
