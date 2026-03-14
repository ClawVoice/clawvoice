const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { verifyTelnyxSignature, verifyTwilioSignature } = require("../dist/webhooks/verify");

function telnyxHmac(secret, timestamp, payload) {
  return createHmac("sha256", secret)
    .update(`${timestamp}|${payload}`)
    .digest("hex");
}

function twilioHmac(authToken, url, params) {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return createHmac("sha1", authToken).update(data).digest("base64");
}

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

    it("rejects when signature does not match", () => {
      const result = verifyTelnyxSignature(
        '{"data":"test"}',
        "aa".repeat(32),
        "1678901234",
        "whsec_test123"
      );
      assert.equal(result.valid, false);
      assert.match(result.reason, /mismatch/i);
    });

    it("accepts valid HMAC-SHA256 signature", () => {
      const secret = "whsec_test_secret";
      const timestamp = "1678901234";
      const payload = '{"data":{"event_type":"call.initiated"}}';
      const sig = telnyxHmac(secret, timestamp, payload);

      const result = verifyTelnyxSignature(payload, sig, timestamp, secret);
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

    it("rejects when signature does not match", () => {
      const result = verifyTwilioSignature(
        "https://example.com/clawvoice/webhooks/twilio/voice",
        { CallSid: "CA123", CallStatus: "ringing" },
        "invalidbase64signature==",
        "auth_token_test"
      );
      assert.equal(result.valid, false);
      assert.match(result.reason, /mismatch/i);
    });

    it("accepts valid HMAC-SHA1 signature", () => {
      const authToken = "auth_token_test";
      const url = "https://example.com/clawvoice/webhooks/twilio/voice";
      const params = { CallSid: "CA123", CallStatus: "ringing" };
      const sig = twilioHmac(authToken, url, params);

      const result = verifyTwilioSignature(url, params, sig, authToken);
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
