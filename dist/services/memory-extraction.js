"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryExtractionService = void 0;
const CATEGORY_PATTERNS = [
    { category: "health", pattern: /\b(medication|doctor|appointment|pain|health|symptom|medicine)\b/i },
    { category: "schedule", pattern: /\b(tomorrow|next week|monday|tuesday|wednesday|thursday|friday|at \d|o'clock|appointment)\b/i },
    { category: "preference", pattern: /\b(i (like|prefer|enjoy|love|hate|dislike)|my favorite|i always|i never)\b/i },
    { category: "relationship", pattern: /\b(my (son|daughter|wife|husband|friend|neighbor|sister|brother|mother|father))\b/i },
    { category: "interest", pattern: /\b(hobby|garden|cook|read|music|sport|travel|game)\b/i },
];
class MemoryExtractionService {
    constructor(config) {
        this.config = config;
        this.candidates = new Map();
        this.memoryWriter = null;
        this.memoryReader = null;
        this.idCounter = 0;
    }
    setMemoryWriter(writer) {
        this.memoryWriter = writer;
    }
    setMemoryReader(reader) {
        this.memoryReader = reader;
    }
    extractFromTranscript(callId, transcript) {
        const userTurns = transcript.filter((t) => t.speaker === "user");
        const found = [];
        for (const turn of userTurns) {
            for (const { category, pattern } of CATEGORY_PATTERNS) {
                if (pattern.test(turn.text)) {
                    this.idCounter += 1;
                    found.push({
                        id: `mem-${callId}-${this.idCounter}`,
                        callId,
                        category,
                        content: turn.text,
                        confidence: 0.7,
                        sourceQuote: turn.text.slice(0, 200),
                        status: "pending",
                        extractedAt: new Date().toISOString(),
                    });
                    break;
                }
            }
        }
        this.candidates.set(callId, found);
        return {
            callId,
            candidates: found,
            extractedAt: new Date().toISOString(),
        };
    }
    getPendingCandidates(callId) {
        if (callId) {
            return (this.candidates.get(callId) ?? []).filter((c) => c.status === "pending");
        }
        const all = [];
        for (const list of this.candidates.values()) {
            all.push(...list.filter((c) => c.status === "pending"));
        }
        return all;
    }
    getCandidate(memoryId) {
        for (const list of this.candidates.values()) {
            const found = list.find((c) => c.id === memoryId);
            if (found)
                return found;
        }
        return undefined;
    }
    async approveAndPromote(memoryId) {
        const candidate = this.getCandidate(memoryId);
        if (!candidate) {
            return { promoted: false, reason: "Memory candidate not found." };
        }
        if (candidate.status === "promoted") {
            return { promoted: false, reason: "Already promoted." };
        }
        candidate.status = "approved";
        if (!this.memoryWriter) {
            return {
                promoted: false,
                reason: "No memory writer configured.",
            };
        }
        await this.memoryWriter("main", `voice-promoted/${candidate.id}`, {
            content: candidate.content,
            category: candidate.category,
            sourceCallId: candidate.callId,
            confidence: candidate.confidence,
            sourceQuote: candidate.sourceQuote,
            promotedAt: new Date().toISOString(),
        });
        candidate.status = "promoted";
        candidate.promotedAt = new Date().toISOString();
        return { promoted: true };
    }
    rejectCandidate(memoryId) {
        const candidate = this.getCandidate(memoryId);
        if (!candidate || candidate.status !== "pending") {
            return false;
        }
        candidate.status = "rejected";
        return true;
    }
    getAllCandidates() {
        const all = [];
        for (const list of this.candidates.values()) {
            all.push(...list);
        }
        return all;
    }
    resetIdCounter() {
        this.idCounter = 0;
    }
}
exports.MemoryExtractionService = MemoryExtractionService;
