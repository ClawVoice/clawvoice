export type InboundEventType = "incoming_call" | "amd_machine_detected" | "amd_human_detected" | "voicemail_greeting" | "call_completed" | "call_failed";
export type AmdResult = "machine_start" | "human" | "fax" | "unknown";
export interface InboundCallEvent {
    eventType: InboundEventType;
    providerCallId: string;
    from: string;
    to: string;
    provider: "telnyx" | "twilio";
    timestamp: string;
    amdResult?: AmdResult;
    detail?: string;
}
export type InboundAction = "answer_and_bridge" | "send_to_voicemail" | "reject" | "log_only";
export interface InboundDecision {
    action: InboundAction;
    reason: string;
}
export interface InboundCallRecord {
    callId: string;
    providerCallId: string;
    from: string;
    to: string;
    provider: "telnyx" | "twilio";
    direction: "inbound";
    eventType: InboundEventType;
    decision: InboundDecision;
    amdResult?: AmdResult;
    receivedAt: string;
    completedAt?: string;
}
