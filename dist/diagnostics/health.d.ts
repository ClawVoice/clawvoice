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
export declare function runDiagnostics(config: ClawVoiceConfig): DiagnosticReport;
