import * as fs from "fs";
import * as path from "path";

export interface UserProfile {
  ownerName: string;
  communicationStyle: string;
  contextBlock: string;
  raw: string;
}

const DEFAULT_PROFILE: UserProfile = {
  ownerName: "",
  communicationStyle: "casual",
  contextBlock: "",
  raw: "",
};

export function readUserProfile(voiceMemoryDir: string): UserProfile {
  const filePath = path.join(voiceMemoryDir, "user-profile.md");
  if (!fs.existsSync(filePath)) return { ...DEFAULT_PROFILE };

  const raw = fs.readFileSync(filePath, "utf8");
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) return { ...DEFAULT_PROFILE, raw, contextBlock: raw.trim() };

  const yaml = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();
  const ownerName = extractYamlValue(yaml, "ownerName") || "";
  const communicationStyle = extractYamlValue(yaml, "communicationStyle") || "casual";

  return { ownerName, communicationStyle, contextBlock: body, raw };
}

function extractYamlValue(yaml: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = yaml.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "");
}

export function buildCallPrompt(profile: UserProfile, purpose?: string): string {
  const parts: string[] = [];
  if (profile.ownerName) {
    parts.push(`You are calling on behalf of ${profile.ownerName}.`);
  }
  if (purpose) {
    parts.push(`Call purpose: ${purpose}`);
  }
  if (profile.contextBlock) {
    parts.push(`\nOwner context:\n${profile.contextBlock}`);
  }
  return parts.join("\n");
}

/**
 * Escape a string for safe inclusion as a YAML value.
 * Wraps in double quotes if it contains characters that could cause YAML injection.
 */
function yamlSafeValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

export function writeDefaultProfile(voiceMemoryDir: string, ownerName: string, style?: string, context?: string): void {
  fs.mkdirSync(voiceMemoryDir, { recursive: true });
  const filePath = path.join(voiceMemoryDir, "user-profile.md");
  const safeName = yamlSafeValue(ownerName);
  const safeStyle = yamlSafeValue(style || "casual");
  const content = `---\nownerName: ${safeName}\ncommunicationStyle: ${safeStyle}\n---\n\n## About the owner\n${context || "(not yet configured — run clawvoice profile or tell your agent to update this)"}\n`;
  fs.writeFileSync(filePath, content);
}
