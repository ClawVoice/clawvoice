"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isVoiceSession = isVoiceSession;
exports.getMemoryWritePolicy = getMemoryWritePolicy;
exports.getMemoryReadPolicy = getMemoryReadPolicy;
exports.getToolDenyList = getToolDenyList;
exports.detectPromptInjection = detectPromptInjection;
exports.registerHooks = registerHooks;
const VOICE_MEMORY_NAMESPACE = "voice-memory";
/**
 * Tools that are always blocked in voice sessions regardless of config.
 * These pose safety/security risks when executed via voice channel.
 */
const BUILT_IN_DENIED_TOOLS = [
    "exec",
    "browser",
    "web_fetch",
];
/**
 * Patterns in user/agent messages that indicate prompt injection attempts.
 * Matches common injection vectors: role override, system prompt leak, ignore instructions.
 */
const PROMPT_INJECTION_PATTERNS = [
    /ignore\s+(previous|prior|above|all)\s+(instructions?|prompts?|rules?)/i,
    /you\s+are\s+now\s+(a|an|the)\s+/i,
    /system\s*:\s*/i,
    /\[system\]/i,
    /pretend\s+(you\s+are|to\s+be|that)/i,
    /override\s+(your|the)\s+(instructions?|rules?|prompt)/i,
    /disregard\s+(your|the|all|previous)/i,
    /reveal\s+(your|the)\s+(system|original|initial)\s+(prompt|instructions?)/i,
];
function isVoiceSession(context) {
    if (typeof context !== "object" || context === null) {
        return false;
    }
    const ctx = context;
    if (typeof ctx.session !== "object" || ctx.session === null) {
        return false;
    }
    const session = ctx.session;
    return session.channel === "voice";
}
function getMemoryWritePolicy(config) {
    return { namespace: VOICE_MEMORY_NAMESPACE };
}
function getMemoryReadPolicy(config) {
    if (config.mainMemoryAccess === "read") {
        return { allowed: true };
    }
    return {
        allowed: false,
        reason: "Main memory access is disabled for voice sessions (mainMemoryAccess=none).",
    };
}
function getToolDenyList(config) {
    const denied = new Set(BUILT_IN_DENIED_TOOLS);
    if (config.restrictTools) {
        for (const tool of config.deniedTools) {
            denied.add(tool);
        }
    }
    return [...denied];
}
function detectPromptInjection(text) {
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
        if (pattern.test(text)) {
            return { detected: true, pattern: pattern.source };
        }
    }
    return { detected: false };
}
function registerHooks(api, config) {
    api.hooks.on("before_tool_execute", (_event, context) => {
        if (!isVoiceSession(context)) {
            return null;
        }
        return { deniedTools: getToolDenyList(config) };
    });
    api.hooks.on("before_memory_write", (_event, context) => {
        if (!isVoiceSession(context)) {
            return null;
        }
        const policy = getMemoryWritePolicy(config);
        return { namespace: policy.namespace };
    });
    api.hooks.on("before_memory_read", (_event, context) => {
        if (!isVoiceSession(context)) {
            return null;
        }
        const policy = getMemoryReadPolicy(config);
        if (!policy.allowed) {
            return { blocked: true, reason: policy.reason };
        }
        return null;
    });
    api.hooks.on("before_response", (event, context) => {
        if (!isVoiceSession(context)) {
            return null;
        }
        const text = typeof event === "object" && event !== null
            ? String(event.text ?? "")
            : "";
        const result = detectPromptInjection(text);
        if (result.detected) {
            return {
                blocked: true,
                reason: "Voice session prompt-injection guard triggered. The message was blocked for safety.",
            };
        }
        return null;
    });
}
