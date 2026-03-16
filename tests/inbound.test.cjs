const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyInboundEvent,
  decideInboundAction,
  buildInboundRecord,
} = require("../dist/inbound/classifier.js");

function baseConfig(overrides) {
  return {
    telephonyProvider: "twilio",
    dailyCallLimit: 50,
    voiceProvider: "deepgram-agent",
    amdEnabled: true,
    restrictTools: true,
    deniedTools: ["exec"],
    mainMemoryAccess: "read",
    maxCallDuration: 1800,
    disclosureEnabled: true,
    disclosureStatement: "AI call.",
    voiceSystemPrompt: "",
    inboundEnabled: true,
    ...overrides,
  };
}

describe("Inbound Event Classification (Story 5.1)", () => {
  it("classifies incoming call with no AMD result", () => {
    const event = classifyInboundEvent("CA123", "+15551234", "+15559999", "twilio");
    assert.equal(event.eventType, "incoming_call");
    assert.equal(event.providerCallId, "CA123");
    assert.equal(event.from, "+15551234");
    assert.equal(event.provider, "twilio");
  });

  it("classifies AMD machine detection", () => {
    const event = classifyInboundEvent("CA123", "+15551234", "+15559999", "twilio", "machine_start");
    assert.equal(event.eventType, "amd_machine_detected");
    assert.equal(event.amdResult, "machine_start");
  });

  it("classifies AMD human detection", () => {
    const event = classifyInboundEvent("CA123", "+15551234", "+15559999", "telnyx", "human");
    assert.equal(event.eventType, "amd_human_detected");
    assert.equal(event.amdResult, "human");
  });

  it("classifies fax as call_failed", () => {
    const event = classifyInboundEvent("CA123", "+15551234", "+15559999", "twilio", "fax");
    assert.equal(event.eventType, "call_failed");
  });

  it("includes timestamp", () => {
    const before = new Date().toISOString();
    const event = classifyInboundEvent("CA123", "+15551234", "+15559999", "twilio");
    assert.ok(event.timestamp >= before);
  });
});

describe("Inbound Decision Logic (Story 5.1)", () => {
  it("bridges human caller", () => {
    const event = classifyInboundEvent("CA1", "+1555", "+1999", "twilio", "human");
    const decision = decideInboundAction(event, baseConfig());
    assert.equal(decision.action, "answer_and_bridge");
  });

  it("sends machine to voicemail", () => {
    const event = classifyInboundEvent("CA1", "+1555", "+1999", "twilio", "machine_start");
    const decision = decideInboundAction(event, baseConfig());
    assert.equal(decision.action, "send_to_voicemail");
  });

  it("rejects fax", () => {
    const event = classifyInboundEvent("CA1", "+1555", "+1999", "twilio", "fax");
    const decision = decideInboundAction(event, baseConfig());
    assert.equal(decision.action, "reject");
  });

  it("bridges incoming call when AMD disabled", () => {
    const event = classifyInboundEvent("CA1", "+1555", "+1999", "twilio");
    const decision = decideInboundAction(event, baseConfig({ amdEnabled: false }));
    assert.equal(decision.action, "answer_and_bridge");
    assert.match(decision.reason, /AMD disabled/);
  });

  it("bridges plain incoming call", () => {
    const event = classifyInboundEvent("CA1", "+1555", "+1999", "telnyx");
    const decision = decideInboundAction(event, baseConfig());
    assert.equal(decision.action, "answer_and_bridge");
  });
});

describe("Inbound Record Building (Story 5.1)", () => {
  it("builds record with correct fields", () => {
    const event = classifyInboundEvent("CA1", "+1555", "+1999", "twilio", "human");
    const decision = { action: "answer_and_bridge", reason: "test" };
    const record = buildInboundRecord(event, decision);
    assert.equal(record.direction, "inbound");
    assert.equal(record.provider, "twilio");
    assert.equal(record.from, "+1555");
    assert.ok(record.callId.startsWith("inbound-"));
    assert.equal(record.decision.action, "answer_and_bridge");
  });

  it("preserves AMD result in record", () => {
    const event = classifyInboundEvent("CA1", "+1555", "+1999", "telnyx", "machine_start");
    const decision = { action: "send_to_voicemail", reason: "test" };
    const record = buildInboundRecord(event, decision);
    assert.equal(record.amdResult, "machine_start");
    assert.equal(record.eventType, "amd_machine_detected");
  });
});
