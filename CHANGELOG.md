# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Non-blocking config diagnostics warnings at plugin init — missing credentials and misconfigured settings are now surfaced immediately via `api.log.warn()` rather than failing silently at first call time.
- Runtime credential failure tests for both Twilio and Telnyx call-start path.

### Fixed
- OpenClaw guide manifest example now uses the correct stable plugin id (`voice-assistant`) and correct default provider (`twilio`).

---

## [1.0.1] - 2026-03-16

### Added
- `package.json` now includes `openclaw.extensions` field required by the OpenClaw plugin installer.
- Named `activate` and `register` exports in plugin entry point for OpenClaw loader compatibility.

### Changed
- Plugin manifest `id` changed from `clawvoice/voice-assistant` to `voice-assistant` (shorter stable form used by OpenClaw runtime).
- Init-time config validation no longer hard-fails on missing provider credentials — the plugin can be installed and enabled before credentials are configured.
- Config schema `required` list cleared so OpenClaw's plugin host does not block enable when credentials are absent.
- Private ignore rules (internal tooling paths) moved from tracked `.gitignore` to local-only `.git/info/exclude`.

### Fixed
- History scrubbed to remove all internal development artifacts (BMAD planning files, reference code, `.beads` state, `.claude` commands) from all historical commits and tags.

---

## [1.0.0] - 2026-03-14

Initial production release. Implements all five epics and 17 user stories from the PRD.

### Added

**Core Plugin (Epic 1)**
- OpenClaw plugin scaffold with manifest, TypeScript build, and SDK integration.
- Three-tier config resolution (env → plugin config → defaults) with contextual validation.
- Interactive setup wizard (`clawvoice setup`) for provider credentials and preferences.
- Configurable disclosure statement spoken at call start (`disclosureEnabled`, `disclosureStatement`).
- Configurable max call duration with automatic termination (`maxCallDuration`).
- Enable/disable inbound call answering (`inboundEnabled`).
- Custom voice system prompt for agent persona and task framing (`voiceSystemPrompt`).

**Voice Bridge (Epic 2)**
- Audio codec negotiation with actionable diagnostics (μ-law 8 kHz, bidirectional).
- Deepgram Voice Agent settings builder with configurable TTS voice and system prompt composition.
- Real-time 160 → 3200-byte audio buffering for Twilio media stream compatibility.
- 5-second keepalive heartbeat over active voice WebSocket.
- Greeting grace period preventing false barge-in on agent greeting.
- Barge-in via Twilio `clear` command when `UserStartedSpeaking` event fires outside grace period.
- Function call dispatch for `end_call` and custom agent-invoked tools.
- Per-call transcript tracking (user and agent turns with timestamps).
- Heartbeat-based disconnection detection with 2-second timeout (NFR10).
- `DisconnectionRecord` with reason, detail, duration, and transcript length.
- Call summaries with `CallOutcome` (completed / partial / failed), failure list, and `RetryContext`.

**Safety and Isolation (Epic 3)**
- Voice-memory write isolation: all writes during a voice session are redirected to `voice-memory/` namespace.
- Configurable main-memory read access (`mainMemoryAccess`: `read` or `none`).
- Built-in always-denied tools for voice sessions (`exec`, `browser`, `web_fetch`).
- User-configurable additional denied tools list (`restrictTools`, `deniedTools`).
- Prompt injection detection with 8 pattern guards applied before response generation.
- Telnyx webhook signature verification using Ed25519 public-key cryptography.
- Twilio webhook signature verification using HMAC-SHA1.
- Post-call transcript and call record persistence to `voice-memory/calls/{callId}`.
- Configurable post-call notifications to Telegram, Discord, or Slack channels (`notifyTelegram`, `notifyDiscord`, `notifySlack`).

**CLI (Epic 4)**
- `clawvoice call <number>` — initiate outbound call with optional `--greeting` and `--purpose` flags.
- `clawvoice history` — list recent calls with outcome, duration, and status.
- `clawvoice history <callId>` — full call detail with transcript summary and retry context.
- `clawvoice status` — run health diagnostics with ✓/⚠/✗ per check and remediation guidance.
- `clawvoice test` — connectivity test showing pass/fail with remediation, secrets never exposed.
- `clawvoice promote` — list pending memory candidates and promote approved entries to main memory.

**Advanced Features (Epic 5)**
- Inbound call handling with AMD (Answering Machine Detection) classification.
- Per-decision routing: human → bridge, machine → voicemail, fax → reject.
- Telnyx and Twilio AMD callback routes.
- Pattern-based memory extraction from call transcripts (health, schedule, preference, relationship, interest categories).
- Pending/approved/rejected/promoted memory candidate workflow with `MemoryExtractionService`.
- Health diagnostics covering 8 checks: telephony credentials, voice credentials, webhook URL, disclosure, call duration, inbound status, mode, provider.

**Real telephony integration**
- Twilio adapter makes real calls via REST API (`https://api.twilio.com/2010-04-01/Accounts/{sid}/Calls.json`).
- Telnyx adapter makes real calls via REST API (`https://api.telnyx.com/v2/calls`).
- Both adapters throw immediately if credentials are missing (no silent simulation).
- Daily outbound call rate limit with per-day counter and reset (`dailyCallLimit`, default 50).

### Security
- Real cryptographic webhook verification (no stub validation).
- Built-in prompt injection guards in all voice sessions.
- Memory namespace isolation prevents voice session data from polluting main agent memory.
- Credentials never logged or exposed in diagnostic output.

---

## [0.1.0] - 2026-03-13

- Initial repository structure, documentation, and feature overview.

[Unreleased]: https://github.com/ClawVoice/clawvoice/compare/v1.0.0...HEAD
[1.0.1]: https://github.com/ClawVoice/clawvoice/compare/v1.0.0...02536b5
[1.0.0]: https://github.com/ClawVoice/clawvoice/compare/a6c9ceb...d58a040
[0.1.0]: https://github.com/ClawVoice/clawvoice/releases/tag/a6c9ceb
