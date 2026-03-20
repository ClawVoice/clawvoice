import { ClawVoiceConfig } from "../config";
import { TranscriptEntry } from "../voice/types";
export type MemoryCategory = "preference" | "health" | "relationship" | "schedule" | "interest" | "other";
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
export type MemoryWriter = (namespace: string, key: string, value: unknown) => Promise<void>;
export type MemoryReader = (namespace: string, key: string) => Promise<unknown>;
export declare class MemoryExtractionService {
    private readonly config;
    private readonly candidates;
    private memoryWriter;
    private memoryReader;
    private idCounter;
    constructor(config: ClawVoiceConfig);
    setMemoryWriter(writer: MemoryWriter): void;
    setMemoryReader(reader: MemoryReader): void;
    extractFromTranscript(callId: string, transcript: TranscriptEntry[]): ExtractionResult;
    getPendingCandidates(callId?: string): MemoryCandidate[];
    getCandidate(memoryId: string): MemoryCandidate | undefined;
    approveAndPromote(memoryId: string): Promise<{
        promoted: boolean;
        reason?: string;
    }>;
    rejectCandidate(memoryId: string): boolean;
    getAllCandidates(): MemoryCandidate[];
    resetIdCounter(): void;
}
