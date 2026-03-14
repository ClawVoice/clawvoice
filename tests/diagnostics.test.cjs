const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { runDiagnostics } = require("../dist/diagnostics/health.js");

function validConfig(overrides = {}) {
  return {
    telephonyProvider: "twilio",
    voiceProvider: "deepgram-agent",
    deepgramVoice: "aura-asteria-en",
    deepgramApiKey: "dg-key-123",
    analysisModel: "gpt-4o-mini",
    mainMemoryAccess: "read",
    autoExtractMemories: true,
    maxCallDuration: 1800,
    restrictTools: true,
    deniedTools: ["exec"],
    disclosureEnabled: true,
    disclosureStatement: "This call is from an AI.",
    notifyTelegram: false,
    notifyDiscord: false,
    notifySlack: false,
    twilioAccountSid: "AC123",
    twilioAuthToken: "auth-token",
    telnyxApiKey: "",
    telnyxWebhookSecret: "",
    elevenlabsApiKey: "",
    elevenlabsAgentId: "",
    voiceSystemPrompt: "",
    inboundEnabled: true,
    ...overrides,
  };
}

describe("Diagnostics (Story 5.3)", () => {
  it("all pass with valid twilio+deepgram config", () => {
    const report = runDiagnostics(validConfig());
    assert.equal(report.overall, "pass");
    assert.ok(report.checks.every((c) => c.status === "pass"));
  });

  it("fails when twilio credentials missing", () => {
    const report = runDiagnostics(validConfig({ twilioAccountSid: "", twilioAuthToken: "" }));
    const cred = report.checks.find((c) => c.name === "telephony-credentials");
    assert.equal(cred.status, "fail");
    assert.ok(cred.remediation.includes("TWILIO_ACCOUNT_SID"));
  });

  it("fails when deepgram API key missing", () => {
    const report = runDiagnostics(validConfig({ deepgramApiKey: "" }));
    const cred = report.checks.find((c) => c.name === "voice-credentials");
    assert.equal(cred.status, "fail");
    assert.ok(cred.remediation.includes("DEEPGRAM_API_KEY"));
  });

  it("warns when telnyx webhook secret missing", () => {
    const report = runDiagnostics(validConfig({
      telephonyProvider: "telnyx",
      telnyxApiKey: "key-123",
      telnyxWebhookSecret: "",
    }));
    const webhook = report.checks.find((c) => c.name === "webhook-config");
    assert.equal(webhook.status, "warn");
  });

  it("warns when maxCallDuration exceeds 2 hours", () => {
    const report = runDiagnostics(validConfig({ maxCallDuration: 8000 }));
    const dur = report.checks.find((c) => c.name === "call-duration");
    assert.equal(dur.status, "warn");
  });

  it("fails when maxCallDuration is invalid", () => {
    const report = runDiagnostics(validConfig({ maxCallDuration: -1 }));
    const dur = report.checks.find((c) => c.name === "call-duration");
    assert.equal(dur.status, "fail");
  });

  it("includes remediation text on failures", () => {
    const report = runDiagnostics(validConfig({ deepgramApiKey: "" }));
    const cred = report.checks.find((c) => c.name === "voice-credentials");
    assert.ok(cred.remediation);
    assert.ok(cred.remediation.length > 10);
  });

  it("does not expose secret values in detail text", () => {
    const report = runDiagnostics(validConfig());
    for (const check of report.checks) {
      assert.ok(!check.detail.includes("dg-key-123"), `${check.name} leaks secret`);
      assert.ok(!check.detail.includes("AC123"), `${check.name} leaks secret`);
      assert.ok(!check.detail.includes("auth-token"), `${check.name} leaks secret`);
    }
  });

  it("elevenlabs credentials fail when not configured", () => {
    const report = runDiagnostics(validConfig({
      voiceProvider: "elevenlabs-conversational",
      elevenlabsApiKey: "",
      elevenlabsAgentId: "",
    }));
    const cred = report.checks.find((c) => c.name === "voice-credentials");
    assert.equal(cred.status, "fail");
    assert.ok(cred.remediation.includes("ELEVENLABS_API_KEY"));
  });
});
