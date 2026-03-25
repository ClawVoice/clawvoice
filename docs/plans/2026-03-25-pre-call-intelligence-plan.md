# Pre-Call Intelligence — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Teach the OpenClaw agent to prepare intelligently before placing calls — gathering context, triaging questions, and packing research into the call's purpose field.

**Architecture:** Behavioral guidance in SKILL.md (auto-loaded by OpenClaw from plugin package) + minor tool description update. No new runtime code.

**Tech Stack:** Markdown (SKILL.md), TypeScript (tool description string)

**Repo:** `C:\Users\neoco\clawvoice-pr` (fork of github.com/clawvoice/clawvoice)
**Branch:** New branch `feat/pre-call-intelligence` off current HEAD
**Build:** `npm run build` (tsc)
**Test:** `npm test` (node --test)

---

### Task 1: Create new branch

**Step 1: Create and switch to new branch**

```bash
git checkout -b feat/pre-call-intelligence
```

**Step 2: Verify**

```bash
git branch --show-current
```
Expected: `feat/pre-call-intelligence`

---

### Task 2: Add Pre-Call Workflow section to SKILL.md

**Files:**
- Modify: `skills/clawvoice/SKILL.md` — insert new section after "## Guardrails" block (before "## URL Configuration")

**Step 1: Insert the Pre-Call Workflow section**

Add this content between the `## Guardrails` section and the `## URL Configuration — CRITICAL` section:

```markdown
## Pre-Call Workflow

Before placing a call with `clawvoice_call`, follow this workflow. The goal is to give the voice agent everything it needs to succeed — packed into the `purpose` and `greeting` fields.

### 1. Classify the request

- **Simple call** — user provides a number and intent ("call Mom", "call +15551234567 and ask about the order"). Go straight to step 5.
- **Task-oriented call** — user wants a goal accomplished ("find a plumber", "schedule a dentist appointment", "follow up on the insurance claim"). Continue to step 2.

### 2. Identify what you must know before dialing

These are **critical unknowns** — the call cannot proceed without them:

- **Phone number** — if not provided, you must find it (search web, check memory, ask user)
- **Authorization level** — should you book/commit/agree to something, or only inquire? If unclear, ask.
- **Time-sensitive constraints** — does this need to happen today? Is there a deadline?

If all critical unknowns are resolved, skip to step 4.

### 3. Ask the user (one round only)

- Ask all critical questions in a single message.
- Bundle up to 4 nice-to-know questions alongside the critical ones (preferences, budget, timing details).
- If there are **only** nice-to-know unknowns and no critical ones — skip asking entirely and proceed to call.
- **Never ask more than one round of questions.** Gather what you can, then call.

### 4. Gather context using your available tools

Do this silently — do not ask permission to research. Use whatever tools you have access to:

- **Scheduling a call?** Check calendar tools (Google Calendar, Apple Calendar, Outlook, or equivalent) for the user's availability. Include specific open time slots in the call purpose.
- **Following up on something?** Search email, messages, or conversation history for recent context with this contact.
- **Need a phone number or business info?** Use web search to find it. Check hours of operation, reviews, or service details that would help the call.
- **Contacted before?** Check voice-memory and main memory for prior call history, outcomes, and notes about this contact.
- **Don't over-research.** Simple calls and calls where the user already provided everything need no research. Only gather context when the task warrants it.

### 5. Place the call with full context

Pack everything you gathered into the `purpose` field. The voice agent receives this as its briefing.

**Good example — scheduling call with research:**
```
clawvoice_call({
  phoneNumber: "+15551234567",
  purpose: "Schedule a plumber visit for kitchen sink leak (started 2 days ago, under-sink pipe joint). Owner is available Tuesday after 2pm and all day Thursday. Get the earliest available slot. Budget is flexible. Ask about emergency rates if they can come sooner.",
  greeting: "Hi, I'm calling on behalf of Cody to schedule a plumbing appointment."
})
```

**Good example — simple call, no research needed:**
```
clawvoice_call({
  phoneNumber: "+15559876543",
  purpose: "Ask about the status of order #12345, placed last week.",
  greeting: "Hi, I'm calling to check on an order."
})
```

**What NOT to do:**
- Do not place a scheduling call without checking the user's calendar (if you have access).
- Do not ask the user for a phone number you can easily find via web search.
- Do not ask "should I check your calendar?" — just check it.
- Do not send a vague purpose like "call plumber" — include the details you gathered.
```

**Step 2: Verify the file renders correctly**

Read the file back and confirm the new section is properly placed and formatted.

**Step 3: Commit**

```bash
git add skills/clawvoice/SKILL.md
git commit -m "feat: add pre-call intelligence workflow to SKILL.md"
```

---

### Task 3: Update clawvoice_call tool description

**Files:**
- Modify: `src/tools.ts:29-30` — update the `purpose` parameter description

**Step 1: Update the description**

Change the `purpose` property description from:

```typescript
description: "Brief description of call purpose",
```

to:

```typescript
description: "Call context and objectives for the voice agent. Include relevant details gathered from research — availability, preferences, account info, prior interactions, or specific questions to ask. The more context provided, the more effective the call.",
```

**Step 2: Build**

```bash
npm run build
```

**Step 3: Run tests to verify nothing breaks**

```bash
npm test
```

The only test that references tool descriptions is `index.test.cjs` (counts tools). This change modifies a description string, not the tool count, so all tests should pass.

**Step 4: Commit**

```bash
git add src/tools.ts
git commit -m "feat: enrich clawvoice_call purpose parameter description"
```

---

### Task 4: Copy dist to live install, push, and create PR

**Step 1: Copy dist**

```bash
cp -r dist/* ~/.openclaw-pip/extensions/clawvoice/dist/
cp skills/clawvoice/SKILL.md ~/.openclaw-pip/extensions/clawvoice/skills/clawvoice/SKILL.md
```

**Step 2: Push and create PR**

```bash
git push origin feat/pre-call-intelligence
```

Create PR with title: "feat: pre-call intelligence workflow for smarter call preparation"

Body should reference the design doc at `docs/plans/2026-03-25-pre-call-intelligence-design.md`.
