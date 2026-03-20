"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyInboundEvent = classifyInboundEvent;
exports.decideInboundAction = decideInboundAction;
exports.buildInboundRecord = buildInboundRecord;
const node_crypto_1 = require("node:crypto");
function classifyInboundEvent(providerCallId, from, to, provider, amdResult) {
    let eventType;
    if (amdResult === "machine_start") {
        eventType = "amd_machine_detected";
    }
    else if (amdResult === "human") {
        eventType = "amd_human_detected";
    }
    else if (amdResult === "fax") {
        eventType = "call_failed";
    }
    else {
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
function decideInboundAction(event, config) {
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
    if (event.eventType === "incoming_call" ||
        event.eventType === "amd_human_detected") {
        return {
            action: "answer_and_bridge",
            reason: "Human caller detected — bridging to voice agent",
        };
    }
    return { action: "log_only", reason: "Unrecognized event — logging only" };
}
function createInboundCallId() {
    return `inbound-${(0, node_crypto_1.randomUUID)()}`;
}
function buildInboundRecord(event, decision) {
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
