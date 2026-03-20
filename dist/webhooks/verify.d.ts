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
export declare function verifyTelnyxSignature(payload: string, signatureHeader: string | undefined, timestampHeader: string | undefined, publicKey: string | undefined): WebhookVerificationResult;
/**
 * Verify Twilio webhook signature using HMAC-SHA1.
 * Twilio computes HMAC-SHA1 of the request URL + sorted POST params.
 */
export declare function verifyTwilioSignature(url: string, params: Record<string, string>, signatureHeader: string | undefined, authToken: string | undefined): WebhookVerificationResult;
/**
 * Get the appropriate verification function for the configured provider.
 */
export declare function getVerifier(config: ClawVoiceConfig): {
    verify: typeof verifyTelnyxSignature;
    secret: string | undefined;
    token?: undefined;
} | {
    verify: typeof verifyTwilioSignature;
    token: string | undefined;
    secret?: undefined;
};
