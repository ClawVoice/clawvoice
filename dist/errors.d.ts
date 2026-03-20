export declare class CompanionModeError extends Error {
    readonly code: "COMPANION_MODE";
    constructor(message: string);
}
export declare function isCompanionModeError(error: unknown): error is CompanionModeError;
