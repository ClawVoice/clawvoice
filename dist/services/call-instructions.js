"use strict";
/**
 * Shared outbound call instructions for voicemail and IVR handling.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OUTBOUND_CALL_INSTRUCTIONS = exports.IVR_INSTRUCTIONS = exports.VOICEMAIL_INSTRUCTIONS = void 0;
exports.VOICEMAIL_INSTRUCTIONS = "If you reach a voicemail, answering machine, or automated greeting that asks you to leave a message:\n" +
    "- Some systems beep, some just go silent — either way, start speaking after the greeting finishes\n" +
    "- Leave a clear, concise message: who is calling, on whose behalf, the purpose, and a callback number\n" +
    "- Keep the message under 30 seconds\n" +
    "- Then end the call\n" +
    "- If you hear a generic carrier voicemail (e.g. 'the person you are trying to reach is not available'), still leave a message";
exports.IVR_INSTRUCTIONS = "If you encounter an automated phone system (IVR):\n" +
    "- Listen to the options carefully\n" +
    '- If asked to press a number, say the number clearly (e.g., "one" or "zero")\n' +
    "- If asked to say your name, say the name of the person you represent\n" +
    "- If asked to hold, wait patiently\n" +
    "- If you reach a dead end, hang up";
exports.OUTBOUND_CALL_INSTRUCTIONS = `${exports.VOICEMAIL_INSTRUCTIONS}\n\n${exports.IVR_INSTRUCTIONS}`;
