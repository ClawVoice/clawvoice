import { createHmac, verify as cryptoVerify, timingSafeEqual } from "node:crypto";
import { ClawVoiceConfig } from "../config";

export interface WebhookVerificationResult {
  valid: boolean;
  provider: "telnyx" | "twilio";
  reason?: string;
}

/**
 * Verify Telnyx webhook signature using Ed25519 public-key cryptography.
 * Telnyx sends `telnyx-signature-ed25519` and `telnyx-timestamp` headers.
 * The signed payload is `timestamp|payload`.
 * The `secret` parameter is the Ed25519 public key from the Telnyx dashboard.
 */
export function verifyTelnyxSignature(
  payload: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  publicKey: string | undefined,
): WebhookVerificationResult {
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

    const valid = cryptoVerify(
      null,
      Buffer.from(signedPayload),
      { key: publicKeyDer, format: "der", type: "spki" },
      signatureBytes,
    );

    if (!valid) {
      return { valid: false, provider: "telnyx", reason: "Signature mismatch" };
    }

    return { valid: true, provider: "telnyx" };
  } catch {
    return { valid: false, provider: "telnyx", reason: "Signature verification failed" };
  }
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
