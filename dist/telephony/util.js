"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeE164 = normalizeE164;
exports.simulatedCallId = simulatedCallId;
function normalizeE164(phoneNumber) {
    if (phoneNumber.startsWith("+")) {
        const digits = phoneNumber.replace(/\D/g, "");
        // E.164 allows 7–15 digits total (some national plans are shorter than 10);
        // the previous >=10 floor rejected legitimate short international numbers.
        if (digits.length < 7 || digits.length > 15) {
            throw new Error("Invalid international phone number. Provide a valid E.164 number (7–15 digits).");
        }
        return `+${digits}`;
    }
    const digits = phoneNumber.replace(/\D/g, "");
    if (digits.length !== 10) {
        throw new Error("Invalid US phone number. Provide exactly 10 digits or valid E.164 number.");
    }
    return `+1${digits}`;
}
function simulatedCallId(prefix) {
    const now = Date.now();
    const random = Math.floor(Math.random() * 1000000)
        .toString()
        .padStart(6, "0");
    return `${prefix}-${now}-${random}`;
}
