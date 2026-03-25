"use strict";
/**
 * Audio format conversion utilities for bridging telephony (mulaw 8kHz)
 * with voice providers that use PCM (16kHz / 44.1kHz).
 *
 * Twilio Media Streams deliver mulaw-encoded 8kHz audio.
 * ElevenLabs Conversational AI expects PCM 16-bit 16kHz input
 * and produces PCM 16-bit 44.1kHz output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mulawToPcm16 = mulawToPcm16;
exports.pcm16ToMulaw = pcm16ToMulaw;
exports.resamplePcm16 = resamplePcm16;
exports.twilioToElevenLabs = twilioToElevenLabs;
exports.elevenLabsToTwilio = elevenLabsToTwilio;
// ---- mulaw ↔ PCM 16-bit conversion ----
/**
 * ITU-T G.711 mulaw-to-linear16 decode table (256 entries).
 * Each mulaw byte maps to a signed 16-bit PCM sample.
 */
const MULAW_DECODE_TABLE = new Int16Array(256);
{
    const BIAS = 0x84;
    const CLIP = 32635;
    for (let i = 0; i < 256; i++) {
        const sign = i & 0x80;
        let exponent = (i >> 4) & 0x07;
        let mantissa = i & 0x0f;
        // Invert all bits for mulaw
        exponent = (~exponent) & 0x07;
        mantissa = (~mantissa) & 0x0f;
        let sample = ((mantissa << 1) | 1) << (exponent + 2);
        sample -= BIAS;
        if (sample > CLIP)
            sample = CLIP;
        if (sample < -CLIP)
            sample = -CLIP;
        MULAW_DECODE_TABLE[i] = sign ? sample : -sample;
    }
}
/**
 * mulaw-to-linear16 lookup table for encoding.
 * Built once at module load.
 */
const MULAW_ENCODE_TABLE = new Uint8Array(65536);
{
    const BIAS = 0x84;
    const CLIP = 32635;
    const EXP_LUT = [0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
        4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
        5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
        6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
        6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
        6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
        6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
        7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
        7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
        7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
        7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
        7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
        7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
        7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
        7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7];
    for (let i = 0; i < 65536; i++) {
        const sample = (i < 32768) ? i : i - 65536; // interpret as signed
        let sign;
        let magnitude;
        if (sample < 0) {
            sign = 0x80;
            magnitude = -sample;
        }
        else {
            sign = 0;
            magnitude = sample;
        }
        if (magnitude > CLIP)
            magnitude = CLIP;
        magnitude += BIAS;
        const exponent = EXP_LUT[(magnitude >> 7) & 0xff];
        const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
        MULAW_ENCODE_TABLE[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
    }
}
/**
 * Decode mulaw bytes to PCM 16-bit signed little-endian samples.
 * Input: Buffer of mulaw bytes (1 byte per sample at 8kHz).
 * Output: Buffer of PCM16 LE (2 bytes per sample).
 */
function mulawToPcm16(mulaw) {
    const pcm = Buffer.allocUnsafe(mulaw.length * 2);
    for (let i = 0; i < mulaw.length; i++) {
        pcm.writeInt16LE(MULAW_DECODE_TABLE[mulaw[i]], i * 2);
    }
    return pcm;
}
/**
 * Encode PCM 16-bit signed little-endian samples to mulaw bytes.
 * Input: Buffer of PCM16 LE (2 bytes per sample).
 * Output: Buffer of mulaw bytes (1 byte per sample).
 */
function pcm16ToMulaw(pcm) {
    const sampleCount = Math.floor(pcm.length / 2);
    const mulaw = Buffer.allocUnsafe(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
        const sample = pcm.readInt16LE(i * 2);
        // Map signed 16-bit [-32768..32767] to unsigned 16-bit index [0..65535]
        mulaw[i] = MULAW_ENCODE_TABLE[(sample + 65536) & 0xffff];
    }
    return mulaw;
}
// ---- Sample rate conversion ----
/**
 * Resample PCM 16-bit audio from one rate to another using linear interpolation.
 * Input and output are little-endian Int16 buffers.
 *
 * For telephony bridging quality, linear interpolation is sufficient.
 * (Sinc interpolation would be better for music, but overkill for speech.)
 */
function resamplePcm16(input, fromRate, toRate) {
    if (fromRate === toRate) {
        return input;
    }
    const inputSamples = Math.floor(input.length / 2);
    if (inputSamples === 0) {
        return Buffer.alloc(0);
    }
    const ratio = fromRate / toRate;
    const outputSamples = Math.max(1, Math.floor((inputSamples - 1) / ratio) + 1);
    const output = Buffer.allocUnsafe(outputSamples * 2);
    for (let i = 0; i < outputSamples; i++) {
        const srcPos = i * ratio;
        const srcIndex = Math.min(inputSamples - 1, Math.floor(srcPos));
        const nextIndex = Math.min(inputSamples - 1, srcIndex + 1);
        const frac = srcPos - Math.floor(srcPos);
        const s0 = input.readInt16LE(srcIndex * 2);
        const s1 = input.readInt16LE(nextIndex * 2);
        const interpolated = Math.round(s0 + frac * (s1 - s0));
        output.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
    }
    return output;
}
// ---- Convenience functions for the Twilio ↔ ElevenLabs pipeline ----
/**
 * Convert Twilio mulaw 8kHz audio to ElevenLabs PCM 16kHz 16-bit.
 * Twilio sends base64-encoded mulaw at 8kHz.
 * ElevenLabs expects base64-encoded PCM 16-bit at 16kHz.
 */
function twilioToElevenLabs(mulawBuffer) {
    const pcm8k = mulawToPcm16(mulawBuffer);
    return resamplePcm16(pcm8k, 8000, 16000);
}
/**
 * Convert ElevenLabs PCM 16kHz 16-bit audio to Twilio mulaw 8kHz.
 * ElevenLabs Conversational AI sends PCM 16-bit at 16kHz (agent_output_audio_format: "pcm_16000").
 * Twilio expects base64-encoded mulaw at 8kHz.
 */
function elevenLabsToTwilio(pcm16kBuffer) {
    const pcm8k = resamplePcm16(pcm16kBuffer, 16000, 8000);
    return pcm16ToMulaw(pcm8k);
}
