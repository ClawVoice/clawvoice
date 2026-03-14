const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { verifyTelnyxSignature, verifyTwilioSignature } = require("../dist/webhooks/verify");

describe("Webhook Signature Verification (Story 3.3)", () => {
  describe("verifyTelnyxSignature", () => {
    it("rejects when no secret configured", () => {
      const result = verifyTelnyxSignature("{}", "sig-header", "ts-header", undefined);
      assert.equal(result.valid, false);
      assert.equal(result.provider, "telnyx");
      assert.match(result.reason, /webhook secret/i);
    });

    it("rejects when signature header missing", () => {
      const result = verifyTelnyxSignature("{}", undefined, "ts-header", "secret123");
      assert.equal(result.valid, false);
      assert.match(result.reason, /missing/i);
    });

    it("rejects when timestamp header missing", () => {
      const result = verifyTelnyxSignature("{}", "sig-header-valid", undefined, "secret123");
      assert.equal(result.valid, false);
      assert.match(result.reason, /missing/i);
    });

    it("rejects when signature is too short", () => {
      const result = verifyTelnyxSignature("{}", "short", "12345", "secret123");
      assert.equal(result.valid, false);
      assert.match(result.reason, /too short/i);
    });

    it("accepts valid signature structure", () => {
      const result = verifyTelnyxSignature(
        '{"data":{"event_type":"call.initiated"}}',
        "abcdefghijklmnop",
        "1678901234",
        "whsec_test123"
      );
      assert.equal(result.valid, true);
      assert.equal(result.provider, "telnyx");
    });
  });

  describe("verifyTwilioSignature", () => {
    it("rejects when no auth token configured", () => {
      const result = verifyTwilioSignature("https://example.com/webhook", {}, "sig", undefined);
      assert.equal(result.valid, false);
      assert.equal(result.provider, "twilio");
      assert.match(result.reason, /auth token/i);
    });

    it("rejects when signature header missing", () => {
      const result = verifyTwilioSignature("https://example.com/webhook", {}, undefined, "token123");
      assert.equal(result.valid, false);
      assert.match(result.reason, /X-Twilio-Signature/i);
    });

    it("rejects when signature is too short", () => {
      const result = verifyTwilioSignature("https://example.com/webhook", {}, "short", "token123");
      assert.equal(result.valid, false);
      assert.match(result.reason, /too short/i);
    });

    it("accepts valid signature structure", () => {
      const result = verifyTwilioSignature(
        "https://example.com/clawvoice/webhooks/twilio/voice",
        { CallSid: "CA123", CallStatus: "ringing" },
        "abcdefghijklmnop",
        "auth_token_test"
      );
      assert.equal(result.valid, true);
      assert.equal(result.provider, "twilio");
    });
  });

  describe("HTTP 401 rejection", () => {
    it("telnyx returns 401-appropriate result for missing secret", () => {
      const result = verifyTelnyxSignature("{}", "sig", "ts", undefined);
      assert.equal(result.valid, false);
    });

    it("twilio returns 401-appropriate result for missing token", () => {
      const result = verifyTwilioSignature("url", {}, "sig", undefined);
      assert.equal(result.valid, false);
    });
  });
});
