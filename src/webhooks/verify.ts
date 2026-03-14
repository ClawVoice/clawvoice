import { createHmac, timingSafeEqual } from "node:crypto";
import { ClawVoiceConfig } from "../config";

export interface WebhookVerificationResult {
  valid: boolean;
  provider: "telnyx" | "twilio";
  reason?: string;
}

/**
 * Verify Telnyx webhook signature using HMAC-SHA256.
 * Telnyx signs `timestamp|payload` with the webhook signing secret.
 */
export function verifyTelnyxSignature(
  payload: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  secret: string | undefined
): WebhookVerificationResult {
  if (!secret) {
    return {
      valid: false,
      provider: "telnyx",
      reason: "No webhook secret configured (telnyxWebhookSecret)",
    };
  }
  if (!signatureHeader || !timestampHeader) {
    return {
      valid: false,
      provider: "telnyx",
      reason: "Missing telnyx-signature-ed25519 or telnyx-timestamp header",
    };
  }

  const expectedSig = createHmac("sha256", secret)
    .update(`${timestampHeader}|${payload}`)
    .digest("hex");

  const sigBuffer = Buffer.from(signatureHeader, "hex");
  const expectedBuffer = Buffer.from(expectedSig, "hex");

  if (sigBuffer.length !== expectedBuffer.length) {
    return {
      valid: false,
      provider: "telnyx",
      reason: "Signature length mismatch",
    };
  }

  const match = timingSafeEqual(sigBuffer, expectedBuffer);
  if (!match) {
    return { valid: false, provider: "telnyx", reason: "Signature mismatch" };
  }

  return { valid: true, provider: "telnyx" };
}

/**
 * Verify Twilio webhook signature using HMAC-SHA1.
 * Twilio computes HMAC-SHA1 of the request URL + sorted POST params.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | undefined,
  authToken: string | undefined
): WebhookVerificationResult {
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

  // Twilio signature = Base64(HMAC-SHA1(AuthToken, URL + sorted-params-concatenated))
  const sortedKeys = Object.keys(params).sort();
  let dataToSign = url;
  for (const key of sortedKeys) {
    dataToSign += key + params[key];
  }

  const expectedSig = createHmac("sha1", authToken)
    .update(dataToSign)
    .digest("base64");

  const sigBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expectedSig);

  if (sigBuffer.length !== expectedBuffer.length) {
    return {
      valid: false,
      provider: "twilio",
      reason: "Signature mismatch",
    };
  }

  const match = timingSafeEqual(sigBuffer, expectedBuffer);
  if (!match) {
    return { valid: false, provider: "twilio", reason: "Signature mismatch" };
  }

  return { valid: true, provider: "twilio" };
}

/**
 * Get the appropriate verification function for the configured provider.
 */
export function getVerifier(config: ClawVoiceConfig) {
  return config.telephonyProvider === "telnyx"
    ? { verify: verifyTelnyxSignature, secret: config.telnyxWebhookSecret }
    : { verify: verifyTwilioSignature, token: config.twilioAuthToken };
}
