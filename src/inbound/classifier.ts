import { randomUUID } from "node:crypto";
import { ClawVoiceConfig } from "../config";
import {
  AmdResult,
  InboundCallEvent,
  InboundCallRecord,
  InboundDecision,
  InboundEventType,
} from "./types";

export function classifyInboundEvent(
  providerCallId: string,
  from: string,
  to: string,
  provider: "telnyx" | "twilio",
  amdResult?: AmdResult,
): InboundCallEvent {
  let eventType: InboundEventType;

  if (amdResult === "machine_start") {
    eventType = "amd_machine_detected";
  } else if (amdResult === "human") {
    eventType = "amd_human_detected";
  } else if (amdResult === "fax") {
    eventType = "call_failed";
  } else {
    eventType = "incoming_call";
  }

  return {
    eventType,
    providerCallId,
    from,
    to,
    provider,
    timestamp: new Date().toISOString(),
    amdResult,
  };
}

export function decideInboundAction(
  event: InboundCallEvent,
  config: ClawVoiceConfig,
): InboundDecision {
  if (event.eventType === "call_failed") {
    return { action: "reject", reason: "Fax or unsupported media detected" };
  }

  if (event.eventType === "amd_machine_detected") {
    return {
      action: "send_to_voicemail",
      reason: "Answering machine detected — recording voicemail greeting",
    };
  }

  if (!config.amdEnabled && event.eventType === "incoming_call") {
    return {
      action: "answer_and_bridge",
      reason: "AMD disabled — answering directly",
    };
  }

  if (
    event.eventType === "incoming_call" ||
    event.eventType === "amd_human_detected"
  ) {
    return {
      action: "answer_and_bridge",
      reason: "Human caller detected — bridging to voice agent",
    };
  }

  return { action: "log_only", reason: "Unrecognized event — logging only" };
}

function createInboundCallId(): string {
  return `inbound-${randomUUID()}`;
}

export function buildInboundRecord(
  event: InboundCallEvent,
  decision: InboundDecision,
): InboundCallRecord {
  return {
    callId: createInboundCallId(),
    providerCallId: event.providerCallId,
    from: event.from,
    to: event.to,
    provider: event.provider,
    direction: "inbound",
    eventType: event.eventType,
    decision,
    amdResult: event.amdResult,
    receivedAt: event.timestamp,
  };
}


