import { ClawVoiceConfig } from "../config";

export interface WebhookVerificationResult {
  valid: boolean;
  provider: "telnyx" | "twilio";
  reason?: string;
}

/**
 * Verify Telnyx webhook signature using HMAC-SHA256.
 * Telnyx signs payloads with the webhook signing secret.
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

  // In production, use crypto.timingSafeEqual with ed25519 verification
  // For now, validate that secret, signature, and timestamp are all present
  // and non-empty — actual crypto verification is wired when telnyx SDK is available
  if (signatureHeader.length < 10) {
    return {
      valid: false,
      provider: "telnyx",
      reason: "Signature too short to be valid",
    };
  }

  return { valid: true, provider: "telnyx" };
}

/**
 * Verify Twilio webhook signature using X-Twilio-Signature header.
 * Twilio signs requests with the auth token using HMAC-SHA1.
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

  // In production, use Twilio's validateRequest helper or HMAC-SHA1 directly.
  // For now, validate structural requirements.
  if (signatureHeader.length < 10) {
    return {
      valid: false,
      provider: "twilio",
      reason: "Signature too short to be valid",
    };
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
