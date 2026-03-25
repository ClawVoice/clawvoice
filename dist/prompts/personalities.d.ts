/**
 * Pre-built voice AI personality templates.
 *
 * Each personality is a complete system prompt ready to inject into Deepgram
 * (via voiceSystemPrompt config) or paste into an ElevenLabs agent dashboard.
 *
 * Placeholders use {{OWNER_NAME}} — callers should replace before use.
 */
export interface Personality {
    /** Machine-readable key. */
    id: string;
    /** Human-readable label shown in menus. */
    name: string;
    /** One-line description for selection UI. */
    tagline: string;
    /** Full system prompt text. */
    prompt: string;
}
export declare const PERSONALITIES: readonly Personality[];
/**
 * Look up a personality by ID.
 */
export declare function getPersonality(id: string): Personality | undefined;
/**
 * Replace {{OWNER_NAME}} placeholder with the given name.
 * If ownerName is empty or undefined, replaces with "the user".
 */
export declare function personalizePrompt(prompt: string, ownerName?: string): string;
