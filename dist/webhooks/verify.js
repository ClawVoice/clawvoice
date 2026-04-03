"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyTelnyxSignature = verifyTelnyxSignature;
exports.verifyTwilioSignature = verifyTwilioSignature;
exports.getVerifier = getVerifier;
const node_crypto_1 = require("node:crypto");
/**
 * Verify Telnyx webhook signature using Ed25519 public-key cryptography.
 * Telnyx sends `telnyx-signature-ed25519` and `telnyx-timestamp` headers.
 * The signed payload is `timestamp|payload`.
 * The `secret` parameter is the Ed25519 public key from the Telnyx dashboard.
 */
function verifyTelnyxSignature(payload, signatureHeader, timestampHeader, publicKey) {
    if (!publicKey) {
        return {
            valid: false,
            provider: "telnyx",
            reason: "No webhook public key configured (telnyxWebhookSecret)",
        };
    }
    if (!signatureHeader || !timestampHeader) {
        return {
            valid: false,
            provider: "telnyx",
            reason: "Missing telnyx-signature-ed25519 or telnyx-timestamp header",
        };
    }
    try {
        const signedPayload = `${timestampHeader}|${payload}`;
        const signatureBytes = Buffer.from(signatureHeader, "hex");
        const publicKeyDer = Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            Buffer.from(publicKey, "base64"),
        ]);
        const valid = (0, node_crypto_1.verify)(null, Buffer.from(signedPayload), { key: publicKeyDer, format: "der", type: "spki" }, signatureBytes);
        if (!valid) {
            return { valid: false, provider: "telnyx", reason: "Signature mismatch" };
        }
        return { valid: true, provider: "telnyx" };
    }
    catch {
        return { valid: false, provider: "telnyx", reason: "Signature verification failed" };
    }
}
function computeTwilioSignature(authToken, url, params) {
    const sortedKeys = Object.keys(params).sort();
    let dataToSign = url;
    for (const key of sortedKeys) {
        dataToSign += key + params[key];
    }
    return (0, node_crypto_1.createHmac)("sha1", authToken).update(dataToSign).digest("base64");
}
function twilioSignatureMatches(signatureHeader, expectedSig) {
    const sigBuffer = Buffer.from(signatureHeader);
    const expectedBuffer = Buffer.from(expectedSig);
    if (sigBuffer.length !== expectedBuffer.length)
        return false;
    return (0, node_crypto_1.timingSafeEqual)(sigBuffer, expectedBuffer);
}
/**
 * Verify Twilio webhook signature using HMAC-SHA1.
 * Twilio computes HMAC-SHA1 of the request URL + sorted POST params.
 *
 * Twilio is inconsistent about whether the port is included in the signed
 * URL, so we check both with and without the port — matching the official
 * Twilio Node SDK's `validateRequest` behaviour.
 */
function verifyTwilioSignature(url, params, signatureHeader, authToken) {
    if (!authToken) {
        return {
            valid: false,
            provider: "twilio",
            reason: "No auth token configured (twilioAuthToken)",
        };
    }
    if (!signatureHeader) {
        return {
            valid: false,
            provider: "twilio",
            reason: "Missing X-Twilio-Signature header",
        };
    }
    // Build candidate URLs: the original, plus a variant with/without port.
    const urlsToTry = [url];
    try {
        const parsed = new URL(url);
        if (parsed.port) {
            const withoutPort = new URL(url);
            withoutPort.port = "";
            urlsToTry.push(withoutPort.toString());
        }
        else {
            const withStdPort = new URL(url);
            withStdPort.port = parsed.protocol === "https:" ? "443" : "80";
            urlsToTry.push(withStdPort.toString());
        }
    }
    catch { /* malformed URL — fall through to single-url check */ }
    for (const candidate of urlsToTry) {
        const expected = computeTwilioSignature(authToken, candidate, params);
        if (twilioSignatureMatches(signatureHeader, expected)) {
            return { valid: true, provider: "twilio" };
        }
    }
    return { valid: false, provider: "twilio", reason: "Signature mismatch" };
}
/**
 * Get the appropriate verification function for the configured provider.
 */
function getVerifier(config) {
    return config.telephonyProvider === "telnyx"
        ? { verify: verifyTelnyxSignature, secret: config.telnyxWebhookSecret }
        : { verify: verifyTwilioSignature, token: config.twilioAuthToken };
}
