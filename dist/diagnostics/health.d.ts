import { ClawVoiceConfig } from "../config";
export type CheckStatus = "pass" | "warn" | "fail";
export interface HealthCheck {
    name: string;
    status: CheckStatus;
    detail: string;
    remediation?: string;
}
export interface DiagnosticReport {
    overall: CheckStatus;
    checks: HealthCheck[];
    generatedAt: string;
}
export declare function runDiagnostics(config: ClawVoiceConfig, openclawConfig?: Record<string, unknown>): Promise<DiagnosticReport>;
/**
 * Detect @openclaw/voice-call — the built-in voice plugin that overlaps with
 * ClawVoice.  Both register voice tools/hooks, causing duplicate tool entries
 * and unpredictable routing when both are active.
 *
 * When the full OpenClaw config is available (initPlugin / wizard), callers
 * should pass it as `openclawConfig` so we can check
 * `plugins.entries["voice-call"]`.  Without it we fall back to a
 * `require.resolve` probe which only catches npm-installed copies.
 */
export declare function checkPluginConflict(openclawConfig?: Record<string, unknown>): HealthCheck;
