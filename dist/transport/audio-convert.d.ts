/**
 * Audio format conversion utilities for bridging telephony (mulaw 8kHz)
 * with voice providers that use PCM (16kHz / 44.1kHz).
 *
 * Twilio Media Streams deliver mulaw-encoded 8kHz audio.
 * ElevenLabs Conversational AI expects PCM 16-bit 16kHz input
 * and produces PCM 16-bit 44.1kHz output.
 */
/**
 * Decode mulaw bytes to PCM 16-bit signed little-endian samples.
 * Input: Buffer of mulaw bytes (1 byte per sample at 8kHz).
 * Output: Buffer of PCM16 LE (2 bytes per sample).
 */
export declare function mulawToPcm16(mulaw: Buffer): Buffer;
/**
 * Encode PCM 16-bit signed little-endian samples to mulaw bytes.
 * Input: Buffer of PCM16 LE (2 bytes per sample).
 * Output: Buffer of mulaw bytes (1 byte per sample).
 */
export declare function pcm16ToMulaw(pcm: Buffer): Buffer;
/**
 * Resample PCM 16-bit audio from one rate to another using linear interpolation.
 * Input and output are little-endian Int16 buffers.
 *
 * For telephony bridging quality, linear interpolation is sufficient.
 * (Sinc interpolation would be better for music, but overkill for speech.)
 */
export declare function resamplePcm16(input: Buffer, fromRate: number, toRate: number): Buffer;
/**
 * Convert Twilio mulaw 8kHz audio to ElevenLabs PCM 16kHz 16-bit.
 * Twilio sends base64-encoded mulaw at 8kHz.
 * ElevenLabs expects base64-encoded PCM 16-bit at 16kHz.
 */
export declare function twilioToElevenLabs(mulawBuffer: Buffer): Buffer;
/**
 * Convert ElevenLabs PCM 16kHz 16-bit audio to Twilio mulaw 8kHz.
 * ElevenLabs Conversational AI sends PCM 16-bit at 16kHz (agent_output_audio_format: "pcm_16000").
 * Twilio expects base64-encoded mulaw at 8kHz.
 */
export declare function elevenLabsToTwilio(pcm16kBuffer: Buffer): Buffer;
