import { ClawVoiceConfig } from "../config";
import { AmdResult, InboundCallEvent, InboundCallRecord, InboundDecision } from "./types";
export declare function classifyInboundEvent(providerCallId: string, from: string, to: string, provider: "telnyx" | "twilio", amdResult?: AmdResult): InboundCallEvent;
export declare function decideInboundAction(event: InboundCallEvent, config: ClawVoiceConfig): InboundDecision;
export declare function buildInboundRecord(event: InboundCallEvent, decision: InboundDecision): InboundCallRecord;
