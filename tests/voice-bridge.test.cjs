const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { negotiateCodec } = require("../dist/voice/types");
const { VoiceBridgeService } = require("../dist/voice/bridge");

function validConfig() {
  return {
    telephonyProvider: "twilio",
    voiceProvider: "deepgram-agent",
    deepgramApiKey: "dg-test-key",
    deepgramVoice: "aura-asteria-en",
    analysisModel: "gpt-4o-mini",
    mainMemoryAccess: "read",
    autoExtractMemories: true,
    maxCallDuration: 1800,
    dailyCallLimit: 50,
    disclosureEnabled: true,
    disclosureStatement: "This call is from an AI assistant.",
    recordCalls: false,
    amdEnabled: true,
    restrictTools: true,
    deniedTools: [],
    twilioAccountSid: "AC123",
    twilioAuthToken: "auth123",
    twilioPhoneNumber: "+15551234567",
    voiceSystemPrompt: "",
    inboundEnabled: true,
  };
}

function sessionConfig(overrides = {}) {
  return {
    callId: "call-test-001",
    providerCallId: "prov-001",
    voiceProviderUrl: "wss://agent.deepgram.com/v1/agent/converse",
    voiceProviderAuth: "dg-test-key",
    telephonyCodec: "mulaw",
    voiceProviderCodec: "mulaw",
    sampleRate: 8000,
    greeting: "Hello, this is a test greeting.",
    voiceModel: "aura-asteria-en",
    keepAliveIntervalMs: 5000,
    greetingGracePeriodMs: 3000,
    ...overrides,
  };
}

describe("negotiateCodec", () => {
  it("succeeds with matching mulaw 8kHz", () => {
    const result = negotiateCodec("mulaw", "mulaw", 8000);
    assert.equal(result.ok, true);
    assert.equal(result.telephonyCodec, "mulaw");
    assert.equal(result.sampleRate, 8000);
  });

  it("succeeds with mulaw telephony and pcm16 voice provider", () => {
    const result = negotiateCodec("mulaw", "pcm16", 8000);
    assert.equal(result.ok, true);
  });

  it("fails with unsupported telephony codec", () => {
    const result = negotiateCodec("pcm16", "mulaw", 8000);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("pcm16"));
    assert.ok(result.suggestion.length > 0);
  });

  it("fails with unsupported sample rate", () => {
    const result = negotiateCodec("mulaw", "mulaw", 16000);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("16000"));
  });
});

describe("VoiceBridgeService", () => {
  it("creates a session with valid codec negotiation", () => {
    const bridge = new VoiceBridgeService(validConfig());
    const event = bridge.createSession(sessionConfig());
    assert.equal(event.type, "connected");
    assert.equal(event.callId, "call-test-001");
    assert.ok(bridge.hasActiveBridge("call-test-001"));
  });

  it("returns error event on invalid codec", () => {
    const bridge = new VoiceBridgeService(validConfig());
    const event = bridge.createSession(
      sessionConfig({ telephonyCodec: "pcm16" }),
    );
    assert.equal(event.type, "error");
    assert.ok(event.data.error.includes("pcm16"));
    assert.ok(!bridge.hasActiveBridge("call-test-001"));
  });

  it("builds Deepgram-compatible settings message", () => {
    const bridge = new VoiceBridgeService(validConfig());
    const cfg = sessionConfig({ systemPrompt: "You are helpful." });
    const settings = bridge.buildSettingsMessage(cfg);
    assert.equal(settings.type, "Settings");
    assert.equal(settings.audio.input.encoding, "mulaw");
    assert.equal(settings.audio.input.sample_rate, 8000);
    assert.equal(settings.audio.output.encoding, "mulaw");
    assert.equal(settings.agent.greeting.text, cfg.greeting);
    assert.equal(settings.agent.think.instructions, "You are helpful.");
  });

  it("manages greeting grace period", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());
    assert.equal(bridge.isGreetingGraceActive("call-test-001"), true);
    bridge.endGreetingGrace("call-test-001");
    assert.equal(bridge.isGreetingGraceActive("call-test-001"), false);
  });

  it("buffers telephony audio and flushes at threshold", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    for (let i = 0; i < 19; i++) {
      const result = bridge.bufferTelephonyAudio(
        "call-test-001",
        Buffer.alloc(160, 0x7f),
      );
      assert.equal(result, null);
    }

    const flushed = bridge.bufferTelephonyAudio(
      "call-test-001",
      Buffer.alloc(160, 0x7f),
    );
    assert.ok(flushed !== null);
    assert.equal(flushed.length, 3200);
  });

  it("flush returns partial buffer content", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());
    bridge.bufferTelephonyAudio("call-test-001", Buffer.alloc(160, 0xaa));
    const partial = bridge.flushAudioBuffer("call-test-001");
    assert.ok(partial !== null);
    assert.equal(partial.length, 160);
  });

  it("tracks transcript entries", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());
    bridge.addTranscriptEntry("call-test-001", {
      speaker: "agent",
      text: "Hello!",
      timestamp: new Date().toISOString(),
    });
    bridge.addTranscriptEntry("call-test-001", {
      speaker: "user",
      text: "Hi there",
      timestamp: new Date().toISOString(),
    });
    const transcript = bridge.getTranscript("call-test-001");
    assert.equal(transcript.length, 2);
    assert.equal(transcript[0].speaker, "agent");
    assert.equal(transcript[1].speaker, "user");
  });

  it("destroys session and returns disconnected event", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());
    bridge.addTranscriptEntry("call-test-001", {
      speaker: "agent",
      text: "Goodbye",
      timestamp: new Date().toISOString(),
    });
    const event = bridge.destroySession("call-test-001");
    assert.equal(event.type, "disconnected");
    assert.equal(event.data.transcriptLength, 1);
    assert.ok(!bridge.hasActiveBridge("call-test-001"));
  });

  it("stopAll clears all active bridges", async () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig({ callId: "call-a" }));
    bridge.createSession(sessionConfig({ callId: "call-b" }));
    assert.equal(bridge.getActiveBridgeCount(), 2);
    await bridge.stopAll();
    assert.equal(bridge.getActiveBridgeCount(), 0);
  });

  it("starts keepalive timer on bridge", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());
    bridge.startKeepAlive("call-test-001", 5000);
    assert.ok(bridge.hasActiveBridge("call-test-001"));
    bridge.destroySession("call-test-001");
  });
});

describe("VoiceBridgeService — in-call tooling and turn-taking", () => {
  it("handles FunctionCallRequest and tracks pending calls", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    const result = bridge.handleVoiceAgentMessage("call-test-001", {
      type: "FunctionCallRequest",
      function_call_id: "fc-001",
      function_name: "calendar.lookup",
      input: { date: "2026-03-14" },
    });

    assert.equal(result.action, "function_call");
    assert.equal(result.request.id, "fc-001");
    assert.equal(result.request.name, "calendar.lookup");
    assert.deepEqual(result.request.input, { date: "2026-03-14" });

    const pending = bridge.getPendingFunctionCalls("call-test-001");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].name, "calendar.lookup");
  });

  it("completes a function call and removes from pending", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    bridge.handleVoiceAgentMessage("call-test-001", {
      type: "FunctionCallRequest",
      function_call_id: "fc-002",
      function_name: "web_search",
      input: { query: "weather" },
    });

    const completed = bridge.completeFunctionCall("call-test-001", {
      id: "fc-002",
      name: "web_search",
      output: "Sunny, 72F",
    });

    assert.equal(completed, true);
    assert.equal(bridge.getPendingFunctionCalls("call-test-001").length, 0);
  });

  it("handles UserStartedSpeaking as barge-in", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    const result = bridge.handleVoiceAgentMessage("call-test-001", {
      type: "UserStartedSpeaking",
    });

    assert.equal(result.action, "barge_in");
    assert.equal(result.duringGrace, true);
    assert.equal(bridge.getTurnState("call-test-001"), "user_speaking");
  });

  it("barge-in after grace period reports duringGrace false", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());
    bridge.endGreetingGrace("call-test-001");

    const result = bridge.handleVoiceAgentMessage("call-test-001", {
      type: "UserStartedSpeaking",
    });

    assert.equal(result.action, "barge_in");
    assert.equal(result.duringGrace, false);
  });

  it("handles AgentStartedSpeaking turn change", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    const result = bridge.handleVoiceAgentMessage("call-test-001", {
      type: "AgentStartedSpeaking",
    });

    assert.equal(result.action, "turn_change");
    assert.equal(result.state, "agent_speaking");
    assert.equal(bridge.getTurnState("call-test-001"), "agent_speaking");
  });

  it("handles ConversationText and adds transcript entry", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    const result = bridge.handleVoiceAgentMessage("call-test-001", {
      type: "ConversationText",
      role: "user",
      content: "What time is my appointment?",
    });

    assert.equal(result.action, "transcript");
    assert.equal(result.entry.speaker, "user");
    assert.equal(result.entry.text, "What time is my appointment?");

    const transcript = bridge.getTranscript("call-test-001");
    assert.equal(transcript.length, 1);
  });

  it("handles SettingsApplied message", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    const result = bridge.handleVoiceAgentMessage("call-test-001", {
      type: "SettingsApplied",
    });

    assert.equal(result.action, "settings_applied");
  });

  it("handles Error message from voice agent as disconnection", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    const result = bridge.handleVoiceAgentMessage("call-test-001", {
      type: "Error",
      message: "Model overloaded",
    });

    assert.equal(result.action, "disconnection");
    assert.equal(result.record.reason, "voice_provider_error");
    assert.equal(result.record.detail, "Model overloaded");
  });

  it("returns none for unknown message types", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    const result = bridge.handleVoiceAgentMessage("call-test-001", {
      type: "SomeUnknownType",
    });

    assert.equal(result.action, "none");
  });

  it("returns none for messages to non-existent sessions", () => {
    const bridge = new VoiceBridgeService(validConfig());
    const result = bridge.handleVoiceAgentMessage("no-such-call", {
      type: "SettingsApplied",
    });
    assert.equal(result.action, "none");
  });

  it("tracks turn state transitions through conversation flow", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    assert.equal(bridge.getTurnState("call-test-001"), "idle");

    bridge.handleVoiceAgentMessage("call-test-001", {
      type: "AgentStartedSpeaking",
    });
    assert.equal(bridge.getTurnState("call-test-001"), "agent_speaking");

    bridge.endGreetingGrace("call-test-001");
    bridge.handleVoiceAgentMessage("call-test-001", {
      type: "UserStartedSpeaking",
    });
    assert.equal(bridge.getTurnState("call-test-001"), "user_speaking");

    bridge.setTurnState("call-test-001", "idle");
    assert.equal(bridge.getTurnState("call-test-001"), "idle");
  });
});

describe("VoiceBridgeService — disconnection detection and recovery", () => {
  it("reports disconnection with reason and detail", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    const record = bridge.reportDisconnection(
      "call-test-001",
      "voice_provider_error",
      "WebSocket closed unexpectedly",
    );

    assert.ok(record !== null);
    assert.equal(record.callId, "call-test-001");
    assert.equal(record.reason, "voice_provider_error");
    assert.equal(record.detail, "WebSocket closed unexpectedly");
    assert.ok(record.detectedAt.length > 0);
    assert.ok(record.callDurationMs >= 0);
    assert.equal(record.transcriptLength, 0);
  });

  it("stores disconnection record on bridge for retrieval", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    assert.equal(bridge.getDisconnectionRecord("call-test-001"), null);

    bridge.reportDisconnection("call-test-001", "telephony_provider_error", "Twilio stream closed");

    const stored = bridge.getDisconnectionRecord("call-test-001");
    assert.ok(stored !== null);
    assert.equal(stored.reason, "telephony_provider_error");
  });

  it("invokes disconnection handler callback when registered", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    let capturedRecord = null;
    bridge.onDisconnection((record) => {
      capturedRecord = record;
    });

    bridge.reportDisconnection("call-test-001", "heartbeat_timeout", "No activity for 2000ms");

    assert.ok(capturedRecord !== null);
    assert.equal(capturedRecord.reason, "heartbeat_timeout");
    assert.equal(capturedRecord.callId, "call-test-001");
  });

  it("marks bridge as disconnected after reportDisconnection", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());
    bridge.startKeepAlive("call-test-001", 5000);

    bridge.reportDisconnection("call-test-001", "unknown", "Test disconnection");

    const record = bridge.getDisconnectionRecord("call-test-001");
    assert.ok(record !== null);
    assert.equal(record.reason, "unknown");
  });

  it("records activity from voice agent messages for heartbeat tracking", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    const before = Date.now();
    bridge.handleVoiceAgentMessage("call-test-001", {
      type: "SettingsApplied",
    });

    bridge.recordActivity("call-test-001");
    assert.ok(bridge.hasActiveBridge("call-test-001"));
  });

  it("records activity from telephony audio for heartbeat tracking", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    bridge.bufferTelephonyAudio("call-test-001", Buffer.alloc(160, 0x55));
    assert.ok(bridge.hasActiveBridge("call-test-001"));
  });

  it("handles Error message as disconnection with record", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    const result = bridge.handleVoiceAgentMessage("call-test-001", {
      type: "Error",
      message: "Model overloaded",
    });

    assert.equal(result.action, "disconnection");
    assert.equal(result.record.reason, "voice_provider_error");
    assert.equal(result.record.detail, "Model overloaded");
  });

  it("includes transcript length in disconnection record", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    bridge.addTranscriptEntry("call-test-001", {
      speaker: "agent",
      text: "Hello!",
      timestamp: new Date().toISOString(),
    });
    bridge.addTranscriptEntry("call-test-001", {
      speaker: "user",
      text: "Hi",
      timestamp: new Date().toISOString(),
    });

    const record = bridge.reportDisconnection(
      "call-test-001",
      "heartbeat_timeout",
      "No activity",
    );

    assert.equal(record.transcriptLength, 2);
  });

  it("returns null when reporting disconnection for unknown callId", () => {
    const bridge = new VoiceBridgeService(validConfig());
    const record = bridge.reportDisconnection("no-such-call", "unknown", "test");
    assert.equal(record, null);
  });

  it("startHeartbeatMonitor triggers disconnection on timeout", (t, done) => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());
    bridge.startKeepAlive("call-test-001", 5000);

    bridge.onDisconnection((record) => {
      assert.equal(record.reason, "heartbeat_timeout");
      assert.ok(record.detail.includes("100ms"));
      bridge.destroySession("call-test-001");
      done();
    });

    bridge.startHeartbeatMonitor("call-test-001", 100);
  });

  it("heartbeat monitor does not fire if activity is recorded", async () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());
    bridge.startKeepAlive("call-test-001", 5000);

    let disconnected = false;
    bridge.onDisconnection(() => {
      disconnected = true;
    });

    bridge.startHeartbeatMonitor("call-test-001", 200);

    await new Promise((r) => setTimeout(r, 80));
    bridge.recordActivity("call-test-001");

    await new Promise((r) => setTimeout(r, 80));
    bridge.recordActivity("call-test-001");

    await new Promise((r) => setTimeout(r, 80));

    assert.equal(disconnected, false);
    bridge.stopHeartbeatMonitor("call-test-001");
    bridge.destroySession("call-test-001");
  });
});

describe("Call Summary and Retry Context (Story 2.4)", () => {
  it("recordFailure stores failures retrievable via getFailures", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    bridge.recordFailure("call-test-001", {
      type: "tool_failure",
      description: "Calendar API timeout",
      timestamp: Date.now(),
    });
    bridge.recordFailure("call-test-001", {
      type: "missing_data",
      description: "User email not available",
      timestamp: Date.now(),
    });

    const failures = bridge.getFailures("call-test-001");
    assert.equal(failures.length, 2);
    assert.equal(failures[0].type, "tool_failure");
    assert.equal(failures[1].type, "missing_data");

    bridge.destroySession("call-test-001");
  });

  it("getFailures returns empty array for unknown callId", () => {
    const bridge = new VoiceBridgeService(validConfig());
    assert.deepEqual(bridge.getFailures("nonexistent"), []);
  });

  it("generateCallSummary returns null for unknown callId", () => {
    const bridge = new VoiceBridgeService(validConfig());
    assert.equal(bridge.generateCallSummary("nonexistent"), null);
  });

  it("generateCallSummary produces completed outcome when no failures", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    bridge.addTranscriptEntry("call-test-001", {
      speaker: "agent",
      text: "Hello, how can I help?",
      timestamp: Date.now(),
    });
    bridge.addTranscriptEntry("call-test-001", {
      speaker: "user",
      text: "I need an appointment",
      timestamp: Date.now(),
    });

    const summary = bridge.generateCallSummary("call-test-001");
    assert.equal(summary.callId, "call-test-001");
    assert.equal(summary.outcome, "completed");
    assert.equal(summary.transcriptLength, 2);
    assert.equal(summary.failures.length, 0);
    assert.equal(summary.pendingActions.length, 0);
    assert.equal(summary.retryContext, null);
    assert.equal(typeof summary.completedAt, "string");
    assert.ok(summary.completedAt.length > 0);

    bridge.destroySession("call-test-001");
  });

  it("generateCallSummary produces partial outcome with failures and retry context", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    bridge.addTranscriptEntry("call-test-001", {
      speaker: "agent",
      text: "Booking your appointment...",
      timestamp: Date.now(),
    });

    bridge.recordFailure("call-test-001", {
      type: "tool_failure",
      description: "Calendar service unreachable",
      timestamp: Date.now(),
    });

    const summary = bridge.generateCallSummary("call-test-001");
    assert.equal(summary.outcome, "partial");
    assert.equal(summary.failures.length, 1);
    assert.ok(summary.retryContext !== null);
    assert.equal(summary.retryContext.originalCallId, "call-test-001");
    assert.ok(summary.retryContext.failureReasons.length > 0);
    assert.ok(summary.retryContext.suggestedApproach.length > 0);

    bridge.destroySession("call-test-001");
  });

  it("generateCallSummary produces failed outcome for empty transcript with failure", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    bridge.recordFailure("call-test-001", {
      type: "disconnection",
      description: "Connection lost before any speech",
      timestamp: Date.now(),
    });

    const summary = bridge.generateCallSummary("call-test-001");
    assert.equal(summary.outcome, "failed");
    assert.ok(summary.retryContext !== null);

    bridge.destroySession("call-test-001");
  });

  it("generateCallSummary includes pending function calls as pending actions", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());
    bridge.startKeepAlive("call-test-001", 5000);

    bridge.addTranscriptEntry("call-test-001", {
      speaker: "user",
      text: "Book me in",
      timestamp: Date.now(),
    });

    // Simulate a function call request that remains pending
    bridge.handleVoiceAgentMessage("call-test-001", {
      type: "FunctionCallRequest",
      function_call_id: "fc-001",
      function_name: "book_appointment",
      input: { date: "tomorrow" },
    });

    const summary = bridge.generateCallSummary("call-test-001");
    assert.ok(summary.pendingActions.length > 0);
    assert.ok(summary.pendingActions.some((a) => a.includes("book_appointment")));

    bridge.destroySession("call-test-001");
  });

  it("retry context includes last transcript entries as summary", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    for (let i = 0; i < 5; i++) {
      bridge.addTranscriptEntry("call-test-001", {
        speaker: i % 2 === 0 ? "agent" : "user",
        text: `Message ${i + 1}`,
        timestamp: Date.now(),
      });
    }

    bridge.recordFailure("call-test-001", {
      type: "timeout",
      description: "LLM response timeout",
      timestamp: Date.now(),
    });

    const summary = bridge.generateCallSummary("call-test-001");
    assert.ok(summary.retryContext !== null);
    assert.ok(summary.retryContext.previousTranscriptSummary.length > 0);

    bridge.destroySession("call-test-001");
  });

  it("generateCallSummary includes disconnection in retry context reasons", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());
    bridge.startKeepAlive("call-test-001", 5000);

    bridge.addTranscriptEntry("call-test-001", {
      speaker: "agent",
      text: "Hello",
      timestamp: Date.now(),
    });

    bridge.reportDisconnection(
      "call-test-001",
      "voice_provider_error",
      "WS closed unexpectedly",
    );

    const summary = bridge.generateCallSummary("call-test-001");
    assert.ok(summary.retryContext !== null);
    assert.ok(
      summary.retryContext.failureReasons.some((r) =>
        r.includes("voice_provider_error"),
      ),
    );

    bridge.destroySession("call-test-001");
  });

  it("summary durationMs is a positive number", () => {
    const bridge = new VoiceBridgeService(validConfig());
    bridge.createSession(sessionConfig());

    bridge.addTranscriptEntry("call-test-001", {
      speaker: "agent",
      text: "Hi",
      timestamp: Date.now(),
    });

    const summary = bridge.generateCallSummary("call-test-001");
    assert.equal(typeof summary.durationMs, "number");
    assert.ok(summary.durationMs >= 0);

    bridge.destroySession("call-test-001");
  });
});
