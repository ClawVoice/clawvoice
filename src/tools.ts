import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import { ClawVoiceService } from "./services/clawvoice";
import { MemoryExtractionService } from "./services/memory-extraction";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function registerTools(
  api: PluginAPI,
  config: ClawVoiceConfig,
  callService: ClawVoiceService,
  memoryService?: MemoryExtractionService,
): void {
  api.tools.register({
    name: "clawvoice_call",
    description:
      "Initiate an outbound voice call. The voice agent on the call is a separate AI — it only knows what you tell it via the `purpose` field. You MUST provide a detailed purpose so the voice agent knows why it is calling, who it represents, and what to accomplish. Without purpose, the agent will not know what to say.",
    parameters: {
      type: "object",
      properties: {
        phoneNumber: {
          type: "string",
          description: "Phone number in E.164 format",
        },
        purpose: {
          type: "string",
          description:
            "REQUIRED. The voice agent's instructions for this call. This is the ONLY context the agent receives — it has no access to your conversation history. Include: (1) why you are calling, (2) who you are calling on behalf of, (3) specific questions to ask or information to convey, (4) any relevant details like account numbers, appointment preferences, prior interactions. Example: 'Calling Dr. Smith's office on behalf of Cody McLain to schedule a dental cleaning. Prefer mornings, any day next week. Insurance is Delta Dental.'",
        },
        greeting: {
          type: "string",
          description:
            "Custom opening line spoken at the start of the call. If omitted, a default disclosure greeting is used.",
        },
      },
      required: ["phoneNumber", "purpose"],
    },
    handler: async (input) => {
      const phoneNumber = readString(input.phoneNumber);
      if (!phoneNumber) {
        throw new Error(
          "phoneNumber is required and must be a non-empty string.",
        );
      }

      const purpose = readString(input.purpose);
      if (!purpose) {
        throw new Error(
          "purpose is required and must be a non-empty string. The voice agent needs detailed instructions to know what to say on the call.",
        );
      }
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
    name: "clawvoice_batch_call",
    description:
      "Make multiple sequential phone calls. Each call is placed one at a time — the next call " +
      "starts only after the previous one completes. Returns a consolidated summary report of all " +
      "calls when finished. Use this when you have a list of people to call.",
    parameters: {
      type: "object",
      properties: {
        calls: {
          type: "array",
          description: "List of calls to make sequentially",
          items: {
            type: "object",
            properties: {
              phoneNumber: {
                type: "string",
                description: "Phone number in E.164 format",
              },
              purpose: {
                type: "string",
                description: "Purpose/instructions for this specific call (see clawvoice_call for details)",
              },
              greeting: {
                type: "string",
                description: "Custom greeting for this call (optional)",
              },
            },
            required: ["phoneNumber", "purpose"],
          },
        },
      },
      required: ["calls"],
    },
    handler: async (input) => {
      const calls = input.calls;
      if (!Array.isArray(calls) || calls.length === 0) {
        throw new Error("calls must be a non-empty array.");
      }
      if (calls.length > 20) {
        throw new Error("Maximum 20 calls per batch to prevent abuse.");
      }

      interface BatchResult {
        phoneNumber: string;
        purpose: string;
        callId: string;
        outcome: string;
        durationMs: number;
        transcriptLength: number;
        error?: string;
      }

      const results: BatchResult[] = [];

      for (const entry of calls) {
        const phoneNumber = readString((entry as Record<string, unknown>).phoneNumber);
        const purpose = readString((entry as Record<string, unknown>).purpose);
        const greeting = readString((entry as Record<string, unknown>).greeting);

        if (!phoneNumber || !purpose) {
          results.push({
            phoneNumber: phoneNumber ?? "unknown",
            purpose: purpose ?? "unknown",
            callId: "",
            outcome: "skipped",
            durationMs: 0,
            transcriptLength: 0,
            error: "Missing phoneNumber or purpose",
          });
          continue;
        }

        try {
          const callResult = await callService.startCall({ phoneNumber, purpose, greeting });

          // Wait for the call to complete before starting the next one
          const summary = await callService.waitForCallCompletion(callResult.callId);

          results.push({
            phoneNumber,
            purpose,
            callId: callResult.callId,
            outcome: summary?.outcome ?? "unknown",
            durationMs: summary?.durationMs ?? 0,
            transcriptLength: summary?.transcriptLength ?? 0,
          });
        } catch (err) {
          results.push({
            phoneNumber,
            purpose,
            callId: "",
            outcome: "failed",
            durationMs: 0,
            transcriptLength: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Build consolidated report
      const completed = results.filter((r) => r.outcome === "completed").length;
      const failed = results.filter((r) => r.outcome === "failed" || r.outcome === "skipped").length;
      const partial = results.filter((r) => r.outcome === "partial").length;

      const lines: string[] = [];
      lines.push(`Batch call report: ${results.length} calls — ${completed} completed, ${partial} partial, ${failed} failed.`);
      lines.push("");
      for (const r of results) {
        const dur = r.durationMs > 0 ? `${Math.round(r.durationMs / 1000)}s` : "n/a";
        const status = r.error ? `${r.outcome} (${r.error})` : r.outcome;
        lines.push(`• ${r.phoneNumber}: ${status} | ${dur} | ${r.transcriptLength} turns | purpose: ${r.purpose.slice(0, 60)}`);
      }

      // Save batch report to voice-memory for the campaign report tool
      if (callService.getWorkspacePath()) {
        const fs = require("fs") as typeof import("fs");
        const path = require("path") as typeof import("path");
        const reportDir = path.join(callService.getWorkspacePath()!, "voice-memory", "campaigns");
        fs.mkdirSync(reportDir, { recursive: true });
        const reportId = `batch-${Date.now()}`;
        fs.writeFileSync(
          path.join(reportDir, `${reportId}.json`),
          JSON.stringify({ reportId, createdAt: new Date().toISOString(), results }, null, 2),
        );
      }

      return {
        content: lines.join("\n"),
        data: { results, completed, partial, failed, total: results.length },
      };
    },
  });

  api.tools.register({
    name: "clawvoice_campaign_report",
    description:
      "Generate a CSV report from recent call campaigns (batch calls). Returns a downloadable " +
      "CSV file with columns: Phone, Name, Company, Purpose, Outcome, Duration, Turns, Summary, Transcript. " +
      "Use after batch calling to give the user a spreadsheet-style report of all calls made.",
    parameters: {
      type: "object",
      properties: {
        callIds: {
          type: "array",
          description: "Specific call IDs to include. If omitted, includes all calls from the most recent batch.",
          items: { type: "string" },
        },
      },
    },
    handler: async (input) => {
      const fs = require("fs") as typeof import("fs");
      const path = require("path") as typeof import("path");
      const workspace = callService.getWorkspacePath();
      if (!workspace) {
        throw new Error("Workspace path not configured — cannot read call records.");
      }

      const callsDir = path.join(workspace, "voice-memory", "calls");
      const campaignsDir = path.join(workspace, "voice-memory", "campaigns");

      // Determine which call IDs to include
      let targetCallIds: string[] = [];
      if (Array.isArray(input.callIds) && input.callIds.length > 0) {
        targetCallIds = input.callIds.filter((id): id is string => typeof id === "string");
      } else {
        // Find most recent batch report
        try {
          const campaignFiles = fs.readdirSync(campaignsDir)
            .filter((f: string) => f.endsWith(".json"))
            .sort()
            .reverse();
          if (campaignFiles.length > 0) {
            const latestBatch = JSON.parse(fs.readFileSync(path.join(campaignsDir, campaignFiles[0]), "utf8")) as {
              results?: Array<{ callId?: string }>;
            };
            targetCallIds = (latestBatch.results ?? [])
              .map((r) => r.callId)
              .filter((id): id is string => typeof id === "string" && id.length > 0);
          }
        } catch { /* no campaigns */ }

        // Fallback: grab all call records
        if (targetCallIds.length === 0) {
          try {
            targetCallIds = fs.readdirSync(callsDir)
              .filter((f: string) => f.endsWith(".json"))
              .map((f: string) => f.replace(".json", ""))
              .slice(-20);
          } catch { /* no calls */ }
        }
      }

      if (targetCallIds.length === 0) {
        return { content: "No call records found.", data: { csv: "" } };
      }

      // Read each call record and build the CSV
      interface CallRow {
        phone: string; name: string; company: string; purpose: string;
        outcome: string; duration: string; turns: number; summary: string;
        transcript: string;
      }
      const rows: CallRow[] = [];

      for (const callId of targetCallIds) {
        try {
          const filePath = path.join(callsDir, `${callId}.json`);
          if (!fs.existsSync(filePath)) continue;
          const record = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
            callId: string; outcome: string; durationMs: number;
            transcript: Array<{ speaker: string; text: string }>;
            completedAt: string;
          };

          // Extract details from transcript
          const callerText = record.transcript.filter((e) => e.speaker === "user").map((e) => e.text).join(" ");
          const agentText = record.transcript.filter((e) => e.speaker === "agent").map((e) => e.text).join(" ");
          const nameMatch = callerText.match(/(?:my name is|this is|I'm|I am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)
            ?? agentText.match(/(?:your name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
          const companyMatch = (callerText + " " + agentText).match(/(?:company is|from|with)\s+([A-Z][A-Za-z\s]+?(?:Inc|LLC|Corp|Co|Ltd|Incorporated|Services)?)\b/i);

          // Build summary from last 2 agent turns
          const agentTurns = record.transcript.filter((e) => e.speaker === "agent");
          const summaryText = agentTurns.slice(-2).map((t) => t.text).join(" ").slice(0, 200);

          // Full transcript as readable text
          const transcriptText = record.transcript
            .map((e) => `${e.speaker === "agent" ? "Agent" : "Caller"}: ${e.text}`)
            .join(" | ");

          const dur = record.durationMs > 0
            ? `${Math.floor(record.durationMs / 60000)}m ${Math.round((record.durationMs % 60000) / 1000)}s`
            : "n/a";

          rows.push({
            phone: callId.startsWith("auto-") ? "(inbound)" : "",
            name: nameMatch?.[1]?.trim() ?? "",
            company: companyMatch?.[1]?.trim() ?? "",
            purpose: "",
            outcome: record.outcome,
            duration: dur,
            turns: record.transcript.length,
            summary: summaryText,
            transcript: transcriptText,
          });
        } catch { /* skip unreadable records */ }
      }

      // Generate CSV
      const escapeCsv = (s: string): string => {
        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const csvLines: string[] = [];
      csvLines.push("Phone,Name,Company,Purpose,Outcome,Duration,Turns,Summary,Transcript");
      for (const row of rows) {
        csvLines.push([
          row.phone, row.name, row.company, row.purpose, row.outcome,
          row.duration, String(row.turns), row.summary, row.transcript,
        ].map(escapeCsv).join(","));
      }
      const csv = csvLines.join("\n");

      // Save CSV to voice-memory
      const csvPath = path.join(workspace, "voice-memory", "campaigns", `report-${Date.now()}.csv`);
      fs.mkdirSync(path.dirname(csvPath), { recursive: true });
      fs.writeFileSync(csvPath, csv);

      return {
        content: `Campaign report generated: ${rows.length} calls.\nSaved to: ${csvPath}\n\n${csvLines.slice(0, 6).join("\n")}${rows.length > 5 ? `\n... (${rows.length - 5} more rows)` : ""}`,
        data: { csv, csvPath, rowCount: rows.length },
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
