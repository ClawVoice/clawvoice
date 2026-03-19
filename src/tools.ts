import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import { VoiceCallService } from "./services/voice-call";
import { MemoryExtractionService } from "./services/memory-extraction";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function registerTools(
  api: PluginAPI,
  config: ClawVoiceConfig,
  callService: VoiceCallService,
  memoryService?: MemoryExtractionService,
): void {
  api.tools.register({
    name: "clawvoice_call",
    description: "Initiate an outbound voice call",
    parameters: {
      type: "object",
      properties: {
        phoneNumber: {
          type: "string",
          description: "Phone number in E.164 format",
        },
        purpose: {
          type: "string",
          description: "Brief description of call purpose",
        },
        greeting: {
          type: "string",
          description: "Custom greeting spoken at call start (overrides default)",
        },
      },
      required: ["phoneNumber"],
    },
    handler: async (input) => {
      const phoneNumber = readString(input.phoneNumber);
      if (!phoneNumber) {
        throw new Error(
          "phoneNumber is required and must be a non-empty string.",
        );
      }

      const purpose = readString(input.purpose);
      const greeting = readString(input.greeting);
      const result = await callService.startCall({
        phoneNumber,
        purpose,
        greeting,
      });

      return {
        content: `${result.message} Greeting: \"${result.openingGreeting}\"`,
        data: {
          callId: result.callId,
          to: result.to,
          provider: config.telephonyProvider,
          purpose: purpose ?? null,
        },
      };
    },
  });

  api.tools.register({
    name: "clawvoice_hangup",
    description: "End an active voice call",
    parameters: {
      type: "object",
      properties: {
        callId: {
          type: "string",
          description: "Call ID to hang up. Omit for most recent.",
        },
      },
    },
    handler: async (input) => {
      const result = await callService.hangup(readString(input.callId));
      return {
        content: result.message,
        data: {
          callId: result.callId,
        },
      };
    },
  });

  api.tools.register({
    name: "clawvoice_send_text",
    description: "Send an SMS text message",
    parameters: {
      type: "object",
      properties: {
        phoneNumber: {
          type: "string",
          description: "Destination phone number in E.164 format",
        },
        message: {
          type: "string",
          description: "Text message body",
        },
      },
      required: ["phoneNumber", "message"],
    },
    handler: async (input) => {
      const phoneNumber = readString(input.phoneNumber);
      const message = readString(input.message);
      if (!phoneNumber) {
        throw new Error(
          "phoneNumber is required and must be a non-empty string.",
        );
      }
      if (!message) {
        throw new Error("message is required and must be non-empty.");
      }

      const result = await callService.sendText({ phoneNumber, message });
      return {
        content: result.message,
        data: {
          messageId: result.messageId,
          to: result.to,
          provider: config.telephonyProvider,
        },
      };
    },
  });

  api.tools.register({
    name: "clawvoice_text_status",
    description: "Show recent inbound and outbound text messages",
    parameters: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const texts = callService.getRecentTexts();
      if (texts.length === 0) {
        return {
          content: "No recent text messages.",
          data: { texts: [] },
        };
      }
      return {
        content: `There are ${texts.length} recent text message(s).`,
        data: { texts },
      };
    },
  });

  api.tools.register({
    name: "clawvoice_status",
    description: "Get active call status or post-call summary with retry context",
    parameters: {
      type: "object",
      properties: {
        callId: {
          type: "string",
          description: "Specific call ID to get summary for (optional)",
        },
      },
    },
    handler: async (input) => {
      const summaryCallId = readString(input.callId);
      if (summaryCallId) {
        const summary = callService.getCallSummary(summaryCallId);
        if (summary) {
          const failureText = summary.failures.length > 0
            ? ` Failures: ${summary.failures.map((f) => f.description).join("; ")}.`
            : "";
          const retryText = summary.retryContext
            ? ` Retry suggestion: ${summary.retryContext.suggestedApproach}`
            : "";
          return {
            content: `Call ${summaryCallId}: ${summary.outcome}.${failureText}${retryText}`,
            data: { summary },
          };
        }
      }

      const activeCalls = callService.getActiveCalls();
      return {
        content:
          activeCalls.length > 0
            ? `There are ${activeCalls.length} active call(s).`
            : "No active calls.",
        data: {
          activeCalls,
        },
      };
    },
  });

  api.tools.register({
    name: "clawvoice_promote_memory",
    description:
      "Review and promote a voice memory to main MEMORY.md. Requires operator confirmation.",
    parameters: {
      type: "object",
      properties: {
        memoryId: {
          type: "string",
          description: "ID of the voice memory entry to promote",
        },
        confirm: {
          type: "boolean",
          description:
            "Set to true to confirm promotion. First call without confirm to preview.",
        },
      },
      required: ["memoryId"],
    },
    handler: async (input) => {
      const memoryId = readString(input.memoryId);
      if (!memoryId) {
        throw new Error("memoryId is required.");
      }
      if (!memoryService) {
        return { content: "Memory extraction service not available." };
      }
      const candidate = memoryService.getCandidate(memoryId);
      if (!candidate) {
        return { content: `Memory candidate ${memoryId} not found.` };
      }
      const confirmed =
        input.confirm === true || input.confirm === "true";
      if (!confirmed) {
        return {
          content: `Preview: "${candidate.content}" (${candidate.category}, confidence: ${candidate.confidence}). Call again with confirm: true to promote.`,
          data: {
            memoryId,
            category: candidate.category,
            content: candidate.content,
            requiresConfirmation: true,
          },
        };
      }
      const result = await memoryService.approveAndPromote(memoryId);
      if (result.promoted) {
        return {
          content: `Memory ${memoryId} promoted to main memory (${candidate.category}).`,
          data: { memoryId, category: candidate.category },
        };
      }
      return { content: `Promotion failed: ${result.reason}` };
    },
  });

  api.tools.register({
    name: "clawvoice_clear_calls",
    description:
      "Force-clear stuck call slots. Use when 'maximum concurrent calls' error appears with no live call.",
    parameters: {
      type: "object",
      properties: {
        callId: {
          type: "string",
          description: "Specific call ID to clear",
        },
        confirmAll: {
          type: "boolean",
          description: "Set true to clear all stuck calls when callId is omitted",
        },
      },
      required: [],
    },
    handler: async (input) => {
      const callId = readString(input.callId);
      const confirmAll = input.confirmAll === true || input.confirmAll === "true";
      if (!callId && !confirmAll) {
        throw new Error("callId is required unless confirmAll is true.");
      }
      const cleared = callService.forceClear(callId || undefined);
      if (cleared.length === 0) {
        return { content: "No active call slots to clear." };
      }
      return {
        content:
          `Cleared ${cleared.length} stuck call slot(s): ${cleared.join(", ")}. ` +
          "This does not terminate provider-side calls.",
      };
    },
  });
}
