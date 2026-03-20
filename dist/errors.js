"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompanionModeError = void 0;
exports.isCompanionModeError = isCompanionModeError;
class CompanionModeError extends Error {
    constructor(message) {
        super(message);
        this.code = "COMPANION_MODE";
        this.name = "CompanionModeError";
    }
}
exports.CompanionModeError = CompanionModeError;
function isCompanionModeError(error) {
    if (error instanceof CompanionModeError) {
        return true;
    }
    if (typeof error !== "object" || error === null) {
        return false;
    }
    return error.code === "COMPANION_MODE";
}
