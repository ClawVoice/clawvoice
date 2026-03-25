# ClawVoice: Post-Call Summary, User Profile & Onboarding

**Date:** 2026-03-25
**Status:** Approved

## 1. Post-Call Summary Delivery

### Flow
1. `clawvoice_call` tool returns immediately: "Call placed to +1234567890. You'll receive a summary when the call ends."
2. When `onCallCompleted` fires:
   - Write transcript + summary to `voice-memory/calls/<callId>.json`
   - Write human-readable summary to `voice-memory/calls/<callId>.md`
   - Use `enqueueSystemEvent` (from OpenClaw's `system-events` chunk) to inject summary into the active session
   - Agent sees it on next turn and delivers to user immediately
3. Summary includes: duration, transcript, outcome, recording URL (if enabled), pending actions

### System Event Injection
- Import `enqueueSystemEvent` from OpenClaw's `system-events-*.js` chunk (same pattern as `registerPluginHttpRoute` from `webhook-ingress-*.js`)
- Inject into the session that originated the call (session key passed through the call flow)
- Fallback: write to `voice-memory/latest-summary.md` if system event injection fails

## 2. User Profile

### File: `voice-memory/user-profile.md`

```yaml
---
ownerName: ""
defaultGreeting: "Hi, I'm calling on behalf of {{ownerName}}"
communicationStyle: casual
---

## About the owner
(filled during onboarding)
```

### Per-Call Prompt Injection
- On every call, read `user-profile.md` from workspace `voice-memory/`
- Inject into `conversation_config_override.agent.prompt`:
  ```
  You are calling on behalf of {{ownerName}}.
  Call purpose: {{purpose}}

  Owner context:
  {{user-profile content}}
  ```
- `{{ownerName}}` templated everywhere — never hardcoded

### Where It Lives
- `<workspace>/voice-memory/user-profile.md` — single source of truth
- Read by the media-session-handler when creating auto-accept bridge sessions
- Read by ClawVoiceService.startCall when placing calls from the same instance

## 3. Onboarding Flow

### CLI Command: `clawvoice profile`
Prompts:
1. "What is the name of the person this agent represents?"
2. "How should the agent introduce itself? (casual/formal)"
3. "Any context the agent should know? (dietary restrictions, location, preferences)"

Saves to `voice-memory/user-profile.md`.

### Telegram Alternative
User can tell Pip: "update your voice profile — my name is X, I'm based in Y"
Pip writes to `voice-memory/user-profile.md` directly.

## 4. Call Recording

- Config: `recordCalls: true` in `plugins.entries.clawvoice.config`
- Twilio `Record=true` added to TwiML `<Connect>` element
- Recording URL included in post-call summary
- Recording link saved in call record JSON

## 5. Files Changed

### Modified
- `src/transport/elevenlabs-bridge.ts` — read user-profile, inject into prompt override
- `src/transport/media-session-handler.ts` — read user-profile for auto-accept sessions, system event injection
- `src/services/clawvoice.ts` — pass session key, read user-profile
- `src/services/post-call.ts` — system event injection, .md summary generation
- `src/tools.ts` — non-blocking call tool, return immediate + callback
- `src/telephony/twilio.ts` — Record param in TwiML, recording URL capture
- `src/cli.ts` — add `clawvoice profile` command

### New
- `voice-memory/user-profile.md` — created during onboarding (template in plugin)
