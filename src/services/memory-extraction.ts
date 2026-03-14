import { ClawVoiceConfig } from "../config";
import { TranscriptEntry } from "../voice/types";

export type MemoryCategory =
  | "preference"
  | "health"
  | "relationship"
  | "schedule"
  | "interest"
  | "other";

export type MemoryStatus = "pending" | "approved" | "rejected" | "promoted";

export interface MemoryCandidate {
  id: string;
  callId: string;
  category: MemoryCategory;
  content: string;
  confidence: number;
  sourceQuote: string;
  status: MemoryStatus;
  extractedAt: string;
  promotedAt?: string;
}

export interface ExtractionResult {
  callId: string;
  candidates: MemoryCandidate[];
  extractedAt: string;
}

export type MemoryWriter = (
  namespace: string,
  key: string,
  value: unknown,
) => Promise<void>;

export type MemoryReader = (
  namespace: string,
  key: string,
) => Promise<unknown>;

const CATEGORY_PATTERNS: Array<{
  category: MemoryCategory;
  pattern: RegExp;
}> = [
  { category: "health", pattern: /\b(medication|doctor|appointment|pain|health|symptom|medicine)\b/i },
  { category: "schedule", pattern: /\b(tomorrow|next week|monday|tuesday|wednesday|thursday|friday|at \d|o'clock|appointment)\b/i },
  { category: "preference", pattern: /\b(i (like|prefer|enjoy|love|hate|dislike)|my favorite|i always|i never)\b/i },
  { category: "relationship", pattern: /\b(my (son|daughter|wife|husband|friend|neighbor|sister|brother|mother|father))\b/i },
  { category: "interest", pattern: /\b(hobby|garden|cook|read|music|sport|travel|game)\b/i },
];

export class MemoryExtractionService {
  private readonly candidates = new Map<string, MemoryCandidate[]>();
  private memoryWriter: MemoryWriter | null = null;
  private memoryReader: MemoryReader | null = null;
  private idCounter = 0;

  public constructor(private readonly config: ClawVoiceConfig) {}

  public setMemoryWriter(writer: MemoryWriter): void {
    this.memoryWriter = writer;
  }

  public setMemoryReader(reader: MemoryReader): void {
    this.memoryReader = reader;
  }

  public extractFromTranscript(
    callId: string,
    transcript: TranscriptEntry[],
  ): ExtractionResult {
    const userTurns = transcript.filter((t) => t.speaker === "user");
    const found: MemoryCandidate[] = [];

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

  public getPendingCandidates(callId?: string): MemoryCandidate[] {
    if (callId) {
      return (this.candidates.get(callId) ?? []).filter(
        (c) => c.status === "pending",
      );
    }
    const all: MemoryCandidate[] = [];
    for (const list of this.candidates.values()) {
      all.push(...list.filter((c) => c.status === "pending"));
    }
    return all;
  }

  public getCandidate(memoryId: string): MemoryCandidate | undefined {
    for (const list of this.candidates.values()) {
      const found = list.find((c) => c.id === memoryId);
      if (found) return found;
    }
    return undefined;
  }

  public async approveAndPromote(
    memoryId: string,
  ): Promise<{ promoted: boolean; reason?: string }> {
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

  public rejectCandidate(memoryId: string): boolean {
    const candidate = this.getCandidate(memoryId);
    if (!candidate || candidate.status !== "pending") {
      return false;
    }
    candidate.status = "rejected";
    return true;
  }

  public getAllCandidates(): MemoryCandidate[] {
    const all: MemoryCandidate[] = [];
    for (const list of this.candidates.values()) {
      all.push(...list);
    }
    return all;
  }

  public resetIdCounter(): void {
    this.idCounter = 0;
  }
}
