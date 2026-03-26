export interface UserProfile {
    ownerName: string;
    ownerPhone: string;
    communicationStyle: string;
    contextBlock: string;
    raw: string;
}
export declare function readUserProfile(voiceMemoryDir: string): UserProfile;
export declare function buildCallPrompt(profile: UserProfile, purpose?: string): string;
export declare function writeDefaultProfile(voiceMemoryDir: string, ownerName: string, style?: string, context?: string): void;
