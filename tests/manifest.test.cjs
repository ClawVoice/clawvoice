const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("openclaw.plugin.json is valid JSON with required fields", () => {
  const manifestPath = path.resolve(__dirname, "..", "openclaw.plugin.json");
  const raw = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw);

  assert.equal(manifest.id, "clawvoice/voice-assistant");
  assert.equal(manifest.name, "ClawVoice");
  assert.equal(manifest.kind, "channel");
  assert.equal(manifest.entryPoint, "dist/index.js");
  assert.ok(Array.isArray(manifest.channels));
  assert.ok(manifest.channels.includes("voice"));
  assert.ok(Array.isArray(manifest.skills));
  assert.ok(manifest.skills.includes("voice-assistant"));
});

test("manifest entryPoint matches package.json main", () => {
  const manifestPath = path.resolve(__dirname, "..", "openclaw.plugin.json");
  const pkgPath = path.resolve(__dirname, "..", "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  assert.equal(manifest.entryPoint, pkg.main, "manifest entryPoint must match package.json main");
});

test("manifest configSchema has expected shape", () => {
  const manifestPath = path.resolve(__dirname, "..", "openclaw.plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  assert.ok(manifest.configSchema, "configSchema must exist");
  assert.equal(manifest.configSchema.type, "object");
  assert.ok(manifest.configSchema.properties, "configSchema.properties must exist");
  assert.ok(Array.isArray(manifest.configSchema.required), "configSchema.required must be an array");
});

test("manifest configSchema includes expanded Story 1.2 fields", () => {
  const manifestPath = path.resolve(__dirname, "..", "openclaw.plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const properties = manifest.configSchema.properties;

  const requiredKeys = [
    "serviceToken",
    "telnyxApiKey",
    "telnyxConnectionId",
    "telnyxPhoneNumber",
    "telnyxWebhookSecret",
    "twilioAccountSid",
    "twilioAuthToken",
    "twilioPhoneNumber",
    "deepgramApiKey",
    "deepgramVoice",
    "elevenlabsApiKey",
    "elevenlabsAgentId",
    "elevenlabsVoiceId",
    "openaiApiKey",
    "analysisModel",
    "mainMemoryAccess",
    "autoExtractMemories",
    "recordCalls",
    "disclosureEnabled",
    "disclosureStatement",
    "amdEnabled",
    "relayUrl"
  ];

  for (const key of requiredKeys) {
    assert.ok(properties[key], `configSchema.properties.${key} must exist`);
  }
});

test("dist/index.js exists after build", () => {
  const distPath = path.resolve(__dirname, "..", "dist", "index.js");
  assert.ok(fs.existsSync(distPath), "dist/index.js must exist (run npm run build first)");
});
