"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readUserProfile = readUserProfile;
exports.buildCallPrompt = buildCallPrompt;
exports.writeDefaultProfile = writeDefaultProfile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_PROFILE = {
    ownerName: "",
    ownerPhone: "",
    communicationStyle: "casual",
    contextBlock: "",
    raw: "",
};
function readUserProfile(voiceMemoryDir) {
    const filePath = path.join(voiceMemoryDir, "user-profile.md");
    if (!fs.existsSync(filePath))
        return { ...DEFAULT_PROFILE };
    const raw = fs.readFileSync(filePath, "utf8");
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!frontmatterMatch)
        return { ...DEFAULT_PROFILE, raw, contextBlock: raw.trim() };
    const yaml = frontmatterMatch[1];
    const body = frontmatterMatch[2].trim();
    const ownerName = extractYamlValue(yaml, "ownerName") || "";
    const ownerPhone = extractYamlValue(yaml, "ownerPhone") || "";
    const communicationStyle = extractYamlValue(yaml, "communicationStyle") || "casual";
    return { ownerName, ownerPhone, communicationStyle, contextBlock: body, raw };
}
function extractYamlValue(yaml, key) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = yaml.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, "m"));
    return match?.[1]?.trim().replace(/^["']|["']$/g, "");
}
function buildCallPrompt(profile, purpose) {
    const parts = [];
    if (profile.ownerName) {
        parts.push(`You are calling on behalf of ${profile.ownerName}.`);
    }
    if (profile.ownerPhone) {
        parts.push(`Owner's phone number: ${profile.ownerPhone}. Use this when asked for a callback number or contact number.`);
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
function yamlSafeValue(value) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}
function writeDefaultProfile(voiceMemoryDir, ownerName, style, context) {
    fs.mkdirSync(voiceMemoryDir, { recursive: true });
    const filePath = path.join(voiceMemoryDir, "user-profile.md");
    const safeName = yamlSafeValue(ownerName);
    const safeStyle = yamlSafeValue(style || "casual");
    const content = `---\nownerName: ${safeName}\ncommunicationStyle: ${safeStyle}\n---\n\n## About the owner\n${context || "(not yet configured — run clawvoice profile or tell your agent to update this)"}\n`;
    fs.writeFileSync(filePath, content);
}
