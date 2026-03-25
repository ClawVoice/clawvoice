# ClawVoice Post-Call, User Profile & Onboarding — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ClawVoice deliver call summaries immediately, inject user/call context into ElevenLabs, and provide an onboarding flow for the user profile.

**Architecture:** User profile lives in `voice-memory/user-profile.md`. Per-call context (purpose + user profile) is injected via ElevenLabs `conversation_config_override`. Post-call summaries are delivered immediately via OpenClaw's `enqueueSystemEvent`. The `clawvoice_call` tool returns immediately; summary delivery is async.

**Tech Stack:** TypeScript, Node.js, OpenClaw plugin SDK, ElevenLabs Conversational AI WebSocket API, Twilio API

**Repo:** `C:\Users\neoco\clawvoice-pr` (fork of github.com/clawvoice/clawvoice)
**Branch:** `fix/gateway-route-registration-and-config`
**Build:** `npm run build` (tsc)
**Test:** `npm test` (node --test)
**Live install:** `C:\Users\neoco\.openclaw-pip\extensions\clawvoice\` (copy dist/ after build to test live)

---

### Task 1: User Profile — file reader utility

**Files:**
- Create: `src/services/user-profile.ts`
- Test: `tests/user-profile.test.cjs`

**Step 1: Write the test**

```javascript
// tests/user-profile.test.cjs
const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("readUserProfile", () => {
  it("returns default when file does not exist", () => {
    const { readUserProfile } = require("../dist/services/user-profile.js");
    const result = readUserProfile("/nonexistent/path");
    assert.strictEqual(result.ownerName, "");
    assert.strictEqual(typeof result.contextBlock, "string");
  });

  it("reads ownerName from YAML frontmatter", () => {
    const { readUserProfile } = require("../dist/services/user-profile.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-test-"));
    const file = path.join(dir, "user-profile.md");
    fs.writeFileSync(file, "---\nownerName: Alex Harper\n---\n\n## About\nLikes sushi.\n");
    const result = readUserProfile(dir);
    assert.strictEqual(result.ownerName, "Alex Harper");
    assert.ok(result.contextBlock.includes("Likes sushi"));
    fs.rmSync(dir, { recursive: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/user-profile.test.cjs`
Expected: FAIL (module not found)

**Step 3: Implement**

```typescript
// src/services/user-profile.ts
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
  const match = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
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

export function writeDefaultProfile(voiceMemoryDir: string, ownerName: string, style?: string, context?: string): void {
  fs.mkdirSync(voiceMemoryDir, { recursive: true });
  const filePath = path.join(voiceMemoryDir, "user-profile.md");
  const content = `---\nownerName: ${ownerName}\ncommunicationStyle: ${style || "casual"}\n---\n\n## About the owner\n${context || "(not yet configured — run clawvoice profile or tell your agent to update this)"}\n`;
  fs.writeFileSync(filePath, content);
}
```

**Step 4: Run test, verify pass**

Run: `npm run build && node --test tests/user-profile.test.cjs`

**Step 5: Commit**

```bash
git add src/services/user-profile.ts tests/user-profile.test.cjs
git commit -m "feat: add user profile reader and prompt builder"
```

---

### Task 2: Inject user profile into ElevenLabs bridge

**Files:**
- Modify: `src/transport/media-session-handler.ts` — read profile in auto-accept path
- Modify: `src/transport/elevenlabs-bridge.ts` — use profile in config override
- Modify: `src/services/clawvoice.ts` — pass workspace path to handler

**Step 1: Update TwilioMediaSessionHandler options type**

Add `workspacePath?: string` to handler options. In the auto-accept bridge session creation, read the user profile and set `systemPrompt` using `buildCallPrompt`.

**Step 2: Update ElevenLabs bridge**

The `conversation_config_override.agent.prompt` should use the full prompt from `buildCallPrompt` (already in `sessionConfig.systemPrompt`). No changes needed if sessionConfig.systemPrompt is set correctly.

**Step 3: Update ClawVoiceService**

Pass `workspacePath` (from config or detected) to the media session handler constructor so it can find `voice-memory/user-profile.md`.

**Step 4: Build and test**

Run: `npm run build && npm test`

**Step 5: Copy to live install and test with a real call**

```bash
cp -r dist/* ~/.openclaw-pip/extensions/clawvoice/dist/
# Restart gateway and test
```

**Step 6: Commit**

```bash
git add src/transport/media-session-handler.ts src/transport/elevenlabs-bridge.ts src/services/clawvoice.ts
git commit -m "feat: inject user profile context into ElevenLabs calls"
```

---

### Task 3: Post-call summary via system event injection

**Files:**
- Modify: `src/services/post-call.ts` — add system event delivery
- Modify: `src/services/clawvoice.ts` — wire onCallCompleted with system event
- Modify: `src/transport/media-session-handler.ts` — trigger post-call on close
- Test: `tests/post-call.test.cjs` (extend existing)

**Step 1: Add system event injection to PostCallService**

Add a method `setSystemEventEmitter(fn)` that accepts a function matching OpenClaw's `enqueueSystemEvent(text, options?)` signature. In `deliverSummary`, call this emitter with a formatted summary string.

**Step 2: Wire system event in index.ts**

In `initPlugin`, resolve `enqueueSystemEvent` from OpenClaw's `system-events-*.js` chunk (same dynamic import pattern as `registerPluginHttpRoute`). Pass it to `postCall.setSystemEventEmitter()`.

**Step 3: Format the summary for delivery**

```
📞 Call Summary — [callId]
Duration: Xs | Turns: N
To: +1234567890

Transcript:
> Agent: Hello, I'm calling on behalf of Cody...
> Callee: Hi, how can I help?
> Agent: I'd like to book a table for 2...

Outcome: completed
Recording: [URL if enabled]
```

**Step 4: Ensure onCallCompleted in media-session-handler triggers PostCallService**

Already partially implemented — extend to include system event delivery.

**Step 5: Build, test, commit**

```bash
npm run build && npm test
git add src/services/post-call.ts src/services/clawvoice.ts src/transport/media-session-handler.ts src/index.ts
git commit -m "feat: deliver post-call summary via OpenClaw system event"
```

---

### Task 4: User profile onboarding CLI

**Files:**
- Modify: `src/cli.ts` — add `clawvoice profile` command
- Test: manual (interactive CLI)

**Step 1: Add profile command**

Add a `clawvoice profile` subcommand that:
1. Reads existing profile (if any) and shows current values
2. Prompts for ownerName, communicationStyle, context
3. Writes to `voice-memory/user-profile.md` using `writeDefaultProfile`

**Step 2: Build and test manually**

```bash
npm run build
openclaw --profile pip clawvoice profile
```

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add clawvoice profile onboarding command"
```

---

### Task 5: Call recording support

**Files:**
- Modify: `src/telephony/twilio.ts` — add Record to TwiML
- Modify: `src/config.ts` — ensure recordCalls config is read
- Modify: `src/services/post-call.ts` — include recording URL in summary

**Step 1: Add Record attribute to TwiML**

In `startCall`, if `config.recordCalls` is true, add `record="record-from-answer"` to the `<Connect>` element.

**Step 2: Capture recording URL**

Twilio sends the recording URL via the status callback. Add a route handler for `/clawvoice/webhooks/twilio/recording` that captures the URL and associates it with the callId.

**Step 3: Include in summary**

When generating the summary, include the recording URL if available.

**Step 4: Build, test, commit**

```bash
npm run build && npm test
git add src/telephony/twilio.ts src/config.ts src/services/post-call.ts src/routes.ts
git commit -m "feat: add call recording support with URL in summary"
```

---

### Task 6: Push to PR and update dist

**Step 1: Build final**

```bash
npm run build && npm test
```

**Step 2: Copy dist to live install**

```bash
cp -r dist/* ~/.openclaw-pip/extensions/clawvoice/dist/
```

**Step 3: Full integration test**

1. Restart gateway
2. Tell Pip to call your number with a specific purpose
3. Verify: agent introduces itself with context, responds to speech
4. After call ends, verify: summary delivered via Telegram immediately

**Step 4: Push**

```bash
git push origin fix/gateway-route-registration-and-config
```
