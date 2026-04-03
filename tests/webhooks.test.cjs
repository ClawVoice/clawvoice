const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac, generateKeyPairSync, sign } = require("node:crypto");
const { verifyTelnyxSignature, verifyTwilioSignature } = require("../dist/webhooks/verify");

// Generate a real Ed25519 keypair for Telnyx tests
const { publicKey: ed25519PublicKey, privateKey: ed25519PrivateKey } =
  generateKeyPairSync("ed25519");

// Export the raw 32-byte public key as base64 (what Telnyx provides)
const publicKeyBase64 = ed25519PublicKey
  .export({ type: "spki", format: "der" })
  .subarray(12) // strip ASN.1 header to get raw 32-byte key
  .toString("base64");

function telnyxEd25519Sign(timestamp, payload) {
  const data = `${timestamp}|${payload}`;
  const sig = sign(null, Buffer.from(data), ed25519PrivateKey);
  return sig.toString("hex");
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
    it("rejects when no public key configured", () => {
      const result = verifyTelnyxSignature("{}", "sig-header", "ts-header", undefined);
      assert.equal(result.valid, false);
      assert.equal(result.provider, "telnyx");
      assert.match(result.reason, /public key/i);
    });

    it("rejects when signature header missing", () => {
      const result = verifyTelnyxSignature("{}", undefined, "ts-header", publicKeyBase64);
      assert.equal(result.valid, false);
      assert.match(result.reason, /missing/i);
    });

    it("rejects when timestamp header missing", () => {
      const result = verifyTelnyxSignature("{}", "sig-header-valid", undefined, publicKeyBase64);
      assert.equal(result.valid, false);
      assert.match(result.reason, /missing/i);
    });

    it("rejects when signature does not match", () => {
      const result = verifyTelnyxSignature(
        '{"data":"test"}',
        "aa".repeat(32),
        "1678901234",
        publicKeyBase64
      );
      assert.equal(result.valid, false);
    });

    it("accepts valid Ed25519 signature", () => {
      const timestamp = "1678901234";
      const payload = '{"data":{"event_type":"call.initiated"}}';
      const sig = telnyxEd25519Sign(timestamp, payload);

      const result = verifyTelnyxSignature(payload, sig, timestamp, publicKeyBase64);
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

    it("accepts signature when Twilio signs URL with non-standard port", () => {
      const authToken = "auth_token_port";
      const urlWithPort = "https://example.com:10000/clawvoice/webhooks/twilio/voice";
      const params = { CallSid: "CA456", CallStatus: "ringing" };
      const sig = twilioHmac(authToken, urlWithPort, params);

      // Verify passes when request URL includes the port (direct match)
      const result = verifyTwilioSignature(urlWithPort, params, sig, authToken);
      assert.equal(result.valid, true);
    });

    it("accepts signature signed without port when request URL has non-standard port", () => {
      const authToken = "auth_token_port2";
      const urlWithPort = "https://example.com:10000/clawvoice/webhooks/twilio/voice";
      const urlWithoutPort = "https://example.com/clawvoice/webhooks/twilio/voice";
      const params = { CallSid: "CA789", CallStatus: "ringing" };
      // Twilio signed the URL without port
      const sig = twilioHmac(authToken, urlWithoutPort, params);

      // Request arrives with port in URL, but signature was computed without port
      const result = verifyTwilioSignature(urlWithPort, params, sig, authToken);
      assert.equal(result.valid, true, "Should match after trying URL without port");
    });

    it("rejects signature when neither port variant matches", () => {
      const authToken = "auth_token_nomatch";
      const url = "https://example.com:10000/clawvoice/webhooks/twilio/voice";
      const params = { CallSid: "CA999", CallStatus: "ringing" };
      const sig = twilioHmac(authToken, "https://totally-different.com/webhook", params);

      const result = verifyTwilioSignature(url, params, sig, authToken);
      assert.equal(result.valid, false);
      assert.match(result.reason, /mismatch/i);
    });
  });

  describe("HTTP 401 rejection", () => {
    it("telnyx returns 401-appropriate result for missing key", () => {
      const result = verifyTelnyxSignature("{}", "sig", "ts", undefined);
      assert.equal(result.valid, false);
    });

    it("twilio returns 401-appropriate result for missing token", () => {
      const result = verifyTwilioSignature("url", {}, "sig", undefined);
      assert.equal(result.valid, false);
    });
  });
});
