"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeE164 = normalizeE164;
exports.simulatedCallId = simulatedCallId;
function normalizeE164(phoneNumber) {
    if (phoneNumber.startsWith("+")) {
        const digits = phoneNumber.replace(/\D/g, "");
        if (digits.length < 10) {
            throw new Error("Invalid international phone number. Must contain at least 10 digits.");
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
