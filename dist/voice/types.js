"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.negotiateCodec = negotiateCodec;
/**
 * Negotiate audio codec between telephony provider and voice provider.
 *
 * Telephony side (Twilio/Telnyx) sends mulaw 8kHz.
 * Deepgram Voice Agent accepts mulaw 8kHz for input and produces mulaw 8kHz output.
 * If codecs don't match, return actionable diagnostic.
 */
function negotiateCodec(telephonyCodec, voiceProviderCodec, sampleRate) {
    const supportedTelephony = ["mulaw"];
    const supportedVoice = ["mulaw", "pcm16"];
    const supportedRates = [8000];
    if (!supportedTelephony.includes(telephonyCodec)) {
        return {
            ok: false,
            error: `Telephony codec "${telephonyCodec}" is not supported. Supported: ${supportedTelephony.join(", ")}.`,
            suggestion: "Set telephony provider to stream mulaw audio (default for Twilio/Telnyx media streams).",
        };
    }
    if (!supportedVoice.includes(voiceProviderCodec)) {
        return {
            ok: false,
            error: `Voice provider codec "${voiceProviderCodec}" is not supported. Supported: ${supportedVoice.join(", ")}.`,
            suggestion: "Configure voice provider to use mulaw or pcm16 encoding.",
        };
    }
    if (!supportedRates.includes(sampleRate)) {
        return {
            ok: false,
            error: `Sample rate ${sampleRate}Hz is not supported. Supported: ${supportedRates.join(", ")}Hz.`,
            suggestion: "Use 8000Hz sample rate for telephony audio.",
        };
    }
    return {
        ok: true,
        telephonyCodec,
        voiceProviderCodec,
        sampleRate,
    };
}
