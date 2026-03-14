import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";

const VOICE_MEMORY_NAMESPACE = "voice-memory";

/**
 * Tools that are always blocked in voice sessions regardless of config.
 * These pose safety/security risks when executed via voice channel.
 */
const BUILT_IN_DENIED_TOOLS: readonly string[] = [
  "exec",
  "browser",
  "web_fetch",
] as const;

/**
 * Patterns in user/agent messages that indicate prompt injection attempts.
 * Matches common injection vectors: role override, system prompt leak, ignore instructions.
 */
const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(previous|prior|above|all)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /system\s*:\s*/i,
  /\[system\]/i,
  /pretend\s+(you\s+are|to\s+be|that)/i,
  /override\s+(your|the)\s+(instructions?|rules?|prompt)/i,
  /disregard\s+(your|the|all|previous)/i,
  /reveal\s+(your|the)\s+(system|original|initial)\s+(prompt|instructions?)/i,
] as const;

export function isVoiceSession(context: unknown): boolean {
  if (typeof context !== "object" || context === null) {
    return false;
  }
  const ctx = context as Record<string, unknown>;
  if (typeof ctx.session !== "object" || ctx.session === null) {
    return false;
  }
  const session = ctx.session as Record<string, unknown>;
  return session.channel === "voice";
}

export function getMemoryWritePolicy(config: ClawVoiceConfig): {
  namespace: string;
} {
  return { namespace: VOICE_MEMORY_NAMESPACE };
}

export function getMemoryReadPolicy(config: ClawVoiceConfig): {
  allowed: boolean;
  reason?: string;
} {
  if (config.mainMemoryAccess === "read") {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "Main memory access is disabled for voice sessions (mainMemoryAccess=none).",
  };
}

export function getToolDenyList(config: ClawVoiceConfig): string[] {
  const denied = new Set<string>(BUILT_IN_DENIED_TOOLS);
  if (config.restrictTools) {
    for (const tool of config.deniedTools) {
      denied.add(tool);
    }
  }
  return [...denied];
}

export function detectPromptInjection(text: string): {
  detected: boolean;
  pattern?: string;
} {
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { detected: true, pattern: pattern.source };
    }
  }
  return { detected: false };
}

export function registerHooks(api: PluginAPI, config: ClawVoiceConfig): void {
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
    const text =
      typeof event === "object" && event !== null
        ? String((event as Record<string, unknown>).text ?? "")
        : "";
    const result = detectPromptInjection(text);
    if (result.detected) {
      return {
        blocked: true,
        reason:
          "Voice session prompt-injection guard triggered. The message was blocked for safety.",
      };
    }
    return null;
  });
}
