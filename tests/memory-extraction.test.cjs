const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  MemoryExtractionService,
} = require("../dist/services/memory-extraction.js");

function validConfig(overrides = {}) {
  return {
    telephonyProvider: "twilio",
    voiceProvider: "deepgram-agent",
    deepgramVoice: "aura-asteria-en",
    analysisModel: "gpt-4o-mini",
    mainMemoryAccess: "read",
    autoExtractMemories: true,
    maxCallDuration: 1800,
    dailyCallLimit: 50,
    restrictTools: true,
    deniedTools: ["exec"],
    disclosureEnabled: false,
    disclosureStatement: "",
    notifyTelegram: false,
    notifyDiscord: false,
    notifySlack: false,
    voiceSystemPrompt: "",
    inboundEnabled: true,
    ...overrides,
  };
}

describe("MemoryExtractionService", () => {
  let service;

  beforeEach(() => {
    service = new MemoryExtractionService(validConfig());
    service.resetIdCounter();
  });

  describe("extractFromTranscript", () => {
    it("extracts health-related memories from user turns", () => {
      const transcript = [
        { speaker: "agent", text: "How are you today?", timestamp: "t1" },
        { speaker: "user", text: "I have a doctor appointment tomorrow", timestamp: "t2" },
      ];
      const result = service.extractFromTranscript("call-1", transcript);
      assert.equal(result.callId, "call-1");
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0].category, "health");
      assert.equal(result.candidates[0].status, "pending");
    });

    it("extracts preference memories", () => {
      const transcript = [
        { speaker: "user", text: "I like gardening in the morning", timestamp: "t1" },
      ];
      const result = service.extractFromTranscript("call-2", transcript);
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0].category, "preference");
    });

    it("extracts relationship memories", () => {
      const transcript = [
        { speaker: "user", text: "My daughter called me yesterday", timestamp: "t1" },
      ];
      const result = service.extractFromTranscript("call-3", transcript);
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0].category, "relationship");
    });

    it("ignores agent turns", () => {
      const transcript = [
        { speaker: "agent", text: "I like your medication reminder", timestamp: "t1" },
      ];
      const result = service.extractFromTranscript("call-4", transcript);
      assert.equal(result.candidates.length, 0);
    });

    it("returns empty for no matches", () => {
      const transcript = [
        { speaker: "user", text: "Hello there", timestamp: "t1" },
      ];
      const result = service.extractFromTranscript("call-5", transcript);
      assert.equal(result.candidates.length, 0);
    });
  });

  describe("getPendingCandidates", () => {
    it("returns pending candidates for a specific call", () => {
      service.extractFromTranscript("call-1", [
        { speaker: "user", text: "I have a doctor visit", timestamp: "t1" },
      ]);
      const pending = service.getPendingCandidates("call-1");
      assert.equal(pending.length, 1);
    });

    it("returns all pending candidates when no callId", () => {
      service.extractFromTranscript("call-1", [
        { speaker: "user", text: "I have a doctor visit", timestamp: "t1" },
      ]);
      service.extractFromTranscript("call-2", [
        { speaker: "user", text: "I like reading", timestamp: "t1" },
      ]);
      const pending = service.getPendingCandidates();
      assert.equal(pending.length, 2);
    });
  });

  describe("approveAndPromote", () => {
    it("promotes a candidate with memory writer", async () => {
      service.extractFromTranscript("call-1", [
        { speaker: "user", text: "I have a doctor visit", timestamp: "t1" },
      ]);
      const candidates = service.getPendingCandidates("call-1");
      const memoryId = candidates[0].id;

      let written = null;
      service.setMemoryWriter(async (ns, key, value) => {
        written = { ns, key, value };
      });

      const result = await service.approveAndPromote(memoryId);
      assert.equal(result.promoted, true);
      assert.equal(written.ns, "main");
      assert.ok(written.key.startsWith("voice-promoted/"));

      const candidate = service.getCandidate(memoryId);
      assert.equal(candidate.status, "promoted");
    });

    it("fails without memory writer", async () => {
      service.extractFromTranscript("call-1", [
        { speaker: "user", text: "I have a doctor visit", timestamp: "t1" },
      ]);
      const candidates = service.getPendingCandidates("call-1");
      const result = await service.approveAndPromote(candidates[0].id);
      assert.equal(result.promoted, false);
      assert.ok(result.reason.includes("No memory writer"));
    });

    it("fails for unknown memoryId", async () => {
      const result = await service.approveAndPromote("nonexistent");
      assert.equal(result.promoted, false);
      assert.ok(result.reason.includes("not found"));
    });

    it("fails for already promoted candidate", async () => {
      service.extractFromTranscript("call-1", [
        { speaker: "user", text: "I have a doctor visit", timestamp: "t1" },
      ]);
      const candidates = service.getPendingCandidates("call-1");
      service.setMemoryWriter(async () => {});
      await service.approveAndPromote(candidates[0].id);
      const result = await service.approveAndPromote(candidates[0].id);
      assert.equal(result.promoted, false);
      assert.ok(result.reason.includes("Already promoted"));
    });
  });

  describe("rejectCandidate", () => {
    it("rejects a pending candidate", () => {
      service.extractFromTranscript("call-1", [
        { speaker: "user", text: "I have a doctor visit", timestamp: "t1" },
      ]);
      const candidates = service.getPendingCandidates("call-1");
      const rejected = service.rejectCandidate(candidates[0].id);
      assert.equal(rejected, true);
      assert.equal(service.getCandidate(candidates[0].id).status, "rejected");
    });

    it("returns false for unknown candidate", () => {
      assert.equal(service.rejectCandidate("nonexistent"), false);
    });
  });
});
