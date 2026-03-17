export class CompanionModeError extends Error {
  public readonly code = "COMPANION_MODE" as const;

  public constructor(message: string) {
    super(message);
    this.name = "CompanionModeError";
  }
}

export function isCompanionModeError(error: unknown): error is CompanionModeError {
  if (error instanceof CompanionModeError) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return (error as { code?: unknown }).code === "COMPANION_MODE";
}
