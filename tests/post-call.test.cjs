const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { PostCallService } = require("../dist/services/post-call.js");

function baseConfig(overrides = {}) {
  return {
    telephonyProvider: "twilio",
    dailyCallLimit: 50,
    voiceProvider: "deepgram-agent",
    deepgramVoice: "aura-asteria-en",
    analysisModel: "gpt-4o-mini",
    mainMemoryAccess: "read",
    autoExtractMemories: true,
    maxCallDuration: 1800,
    disclosureEnabled: true,
    disclosureStatement: "AI calling.",
    recordCalls: false,
    amdEnabled: true,
    restrictTools: true,
    deniedTools: ["exec"],
    notifyTelegram: false,
    notifyDiscord: false,
    notifySlack: false,
    voiceSystemPrompt: "",
    inboundEnabled: true,
    ...overrides,
  };
}

function makeSummary(overrides = {}) {
  return {
    callId: "call-001",
    outcome: "completed",
    durationMs: 45000,
    transcriptLength: 6,
    failures: [],
    pendingActions: [],
    retryContext: null,
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTranscript() {
  return [
    { speaker: "agent", text: "Hello!", timestamp: new Date().toISOString() },
    { speaker: "user", text: "Hi there.", timestamp: new Date().toISOString() },
  ];
}

describe("PostCallService", () => {
  let service;

  beforeEach(() => {
    service = new PostCallService(baseConfig());
  });

  describe("persistence", () => {
    it("persists call record to voice-memory/calls/ namespace", async () => {
      const written = [];
      service.setMemoryWriter(async (ns, key, val) => {
        written.push({ ns, key, val });
      });

      const summary = makeSummary();
      const transcript = makeTranscript();
      const result = await service.processCompletedCall(summary, transcript);

      assert.equal(result.persisted, true);
      assert.equal(written.length, 1);
      assert.equal(written[0].ns, "voice-memory");
      assert.equal(written[0].key, "calls/call-001");
      assert.equal(written[0].val.callId, "call-001");
      assert.equal(written[0].val.transcript.length, 2);
      assert.equal(typeof written[0].val.persistedAt, "string");
    });

    it("returns persisted=false when no memory writer set", async () => {
      const result = await service.processCompletedCall(makeSummary(), makeTranscript());
      assert.equal(result.persisted, false);
    });

    it("skips duplicate calls (idempotent)", async () => {
      const written = [];
      service.setMemoryWriter(async (ns, key, val) => {
        written.push({ ns, key, val });
      });

      const summary = makeSummary();
      await service.processCompletedCall(summary, makeTranscript());
      const result = await service.processCompletedCall(summary, makeTranscript());

      assert.equal(result.persisted, false);
      assert.equal(result.notified, false);
      assert.equal(written.length, 1);
    });
  });

  describe("notifications", () => {
    it("delivers summary to configured channels", async () => {
      const svc = new PostCallService(baseConfig({ notifyDiscord: true, notifySlack: true }));
      const notifications = [];
      svc.setNotificationSender(async (n) => { notifications.push(n); });

      const result = await svc.processCompletedCall(makeSummary(), makeTranscript());

      assert.equal(result.notified, true);
      assert.equal(notifications.length, 2);
      assert.equal(notifications[0].channel, "discord");
      assert.equal(notifications[1].channel, "slack");
      assert.equal(notifications[0].callId, "call-001");
    });

    it("returns notified=false when no channels configured", async () => {
      const notifications = [];
      service.setNotificationSender(async (n) => { notifications.push(n); });

      const result = await service.processCompletedCall(makeSummary(), makeTranscript());

      assert.equal(result.notified, false);
      assert.equal(notifications.length, 0);
    });

    it("returns notified=false when no sender set", async () => {
      const svc = new PostCallService(baseConfig({ notifyTelegram: true }));
      const result = await svc.processCompletedCall(makeSummary(), makeTranscript());
      assert.equal(result.notified, false);
    });
  });

  describe("formatSummaryText", () => {
    it("includes duration and transcript count", () => {
      const text = service.formatSummaryText(makeSummary(), makeTranscript());
      assert.match(text, /call-001/);
      assert.match(text, /Call Summary/);
      assert.match(text, /45s/);
      assert.match(text, /2 turns/);
    });

    it("includes failures when present", () => {
      const summary = makeSummary({
        outcome: "partial",
        failures: [{ type: "tool_failure", description: "calendar unavailable", timestamp: new Date().toISOString() }],
        pendingActions: ["schedule_meeting()"],
        retryContext: {
          originalCallId: "call-001",
          failureReasons: ["calendar unavailable"],
          uncompletedActions: ["schedule_meeting()"],
          previousTranscriptSummary: "user: please schedule",
          suggestedApproach: "Retry with calendar access",
        },
      });
      const text = service.formatSummaryText(summary, makeTranscript());
      assert.match(text, /calendar unavailable/);
    });
  });

  describe("tracking", () => {
    it("tracks processed calls", async () => {
      assert.equal(service.isProcessed("call-001"), false);
      assert.equal(service.getProcessedCount(), 0);

      await service.processCompletedCall(makeSummary(), makeTranscript());

      assert.equal(service.isProcessed("call-001"), true);
      assert.equal(service.getProcessedCount(), 1);
    });
  });
});
