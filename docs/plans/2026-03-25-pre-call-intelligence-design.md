# Pre-Call Intelligence — Design Document

**Goal:** Make the OpenClaw agent prepare intelligently before placing calls. The agent should gather context, identify unknowns, and ask the user only when necessary — then pack everything into the call's `purpose` field so the voice agent has full context.

**Approach:** Behavioral guidance via SKILL.md + minor tool description update. No new code paths or runtime changes.

---

## Problem

Today the `clawvoice_call` tool is a dumb dialer. The agent receives "call a plumber" and either asks the user for a phone number or immediately fails. It doesn't:

- Research plumbers and find phone numbers
- Check the user's calendar before scheduling calls
- Search email/messages for context on ongoing threads
- Ask critical clarifying questions before dialing
- Skip unnecessary questions for simple calls

## Design

### Where the intelligence lives

**SKILL.md** (`skills/clawvoice/SKILL.md`) — a new "Pre-Call Workflow" section. OpenClaw auto-loads this from the plugin package via the `"skills": ["clawvoice"]` manifest entry. No user setup needed.

**Tool description** — the `purpose` parameter on `clawvoice_call` gets a richer description hinting that the agent should pack context into it.

### Decision flow

When the user asks the agent to make a call:

1. **Classify** — Simple call ("call Mom") vs. task-oriented ("find a plumber and schedule them")
2. **Identify critical unknowns** — What must be known before dialing? (phone number, authorization level, time constraints)
3. **Identify nice-to-know context** — What would improve the call? (past interactions, preferences, availability)
4. **Gather context silently** — Use available tools (web search, memory, calendar, email) without asking permission
5. **Ask the user only if necessary** — Critical unknowns the agent can't resolve. Bundle up to 4 nice-to-know questions alongside critical ones. If only nice-to-know unknowns remain, skip asking.
6. **Place the call** — Pack all gathered context into `purpose` and `greeting`

### Question triage rules

- **Critical unknowns** (must ask): phone number (if unfindable), authorization decisions ("book it or just inquire?"), time-sensitive constraints
- **Nice-to-know** (bundle with critical, or skip): preferred times, budget range, specific preferences
- **One round max** — ask once, then call. Don't interrogate.
- **No questions needed** — simple calls ("call Mom", "call this number") dial immediately

### Context gathering rules (capability-aware)

The SKILL.md will reference capabilities generically so it works with any tool set:

- **Scheduling calls** — "If you have access to calendar tools (Google Calendar, Apple Calendar, or equivalent), check the user's availability before calling to schedule appointments."
- **Follow-up calls** — "If you can search email or messages, look for recent threads with this contact for context."
- **Unknown contacts/businesses** — "Use web search to find phone numbers, hours, reviews, and relevant details."
- **Returning contacts** — "Check voice-memory and main memory for prior call history and notes."
- **Don't over-research** — simple calls and calls where the user provides everything skip research entirely.

### How context reaches the voice agent

Already built in Tasks 1-2 of the previous plan:

- `purpose` parameter on `clawvoice_call` → injected into voice agent system prompt
- User profile from `voice-memory/user-profile.md` → injected via `buildCallPrompt()`
- `greeting` parameter → spoken at call start

The agent packs its research into `purpose`. Example:

```
clawvoice_call({
  phoneNumber: "+15551234567",
  purpose: "Schedule a plumber visit. Owner available Tue afternoon and Thu all day. Issue: kitchen sink leak, 2 days. Get earliest slot.",
  greeting: "Hi, I'm calling on behalf of Cody to schedule a plumbing appointment."
})
```

## Deliverables

1. **`skills/clawvoice/SKILL.md`** — Add "Pre-Call Workflow" section with decision flow, question triage, and context gathering rules
2. **`src/tools.ts`** — Update `purpose` parameter description to encourage richer context

## What this does NOT include

- No new tools or API endpoints
- No runtime code for "call planning" — the LLM agent handles all reasoning
- No hard dependencies on specific external tools (calendar, email, etc.)
- No changes to the voice bridge, post-call, or telephony layers

## Branch and PR

- New branch off main (separate from `fix/gateway-route-registration-and-config`)
- Separate PR since this is a behavioral change, not a code feature
