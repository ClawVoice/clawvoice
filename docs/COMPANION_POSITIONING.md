# ClawVoice Companion Positioning

## One-Line Positioning

OpenClaw `voice-call` provides reliable live-call transport; ClawVoice provides the production guardrails and operational workflows around those calls.

## Why Run Both Plugins

| Dimension | OpenClaw `voice-call` | ClawVoice Companion |
|---|---|---|
| Core responsibility | Telephony + media transport | Governance + operations layer |
| Live call audio path | Primary owner | Delegated by default |
| Inbound/outbound call transport reliability | Primary owner | Not reimplemented |
| SMS workflow handling | Minimal/basic | Primary owner |
| Memory isolation + promotion review | Limited | Primary owner |
| Tool/prompt safety for voice sessions | Limited | Primary owner |
| Post-call summaries + retry context | Basic | Primary owner |
| Operational diagnostics for companion features | Limited | Primary owner |

## What ClawVoice Should NOT Own

To avoid overlap and reduce failure surface area, ClawVoice should not own:

- A separate media stream WebSocket server for live call transport
- Competing Twilio/Telnyx live-audio bridge infrastructure when `voice-call` is present
- Parallel call transport routing logic that conflicts with OpenClaw `voice-call`

## What ClawVoice Should Own

- SMS send/receive orchestration
- Voice-memory sandboxing and controlled promotion to main memory
- Prompt/tool guardrails specific to voice interactions
- Post-call operational intelligence (summary, failures, retry guidance)
- Companion diagnostics and safety posture visibility

## Live-Call Readiness Checklist

- OpenClaw `voice-call` plugin is installed and enabled
- ClawVoice `callMode` is set to `companion`
- Twilio voice webhooks point to OpenClaw `voice-call` endpoints
- Twilio SMS webhook points to ClawVoice `/clawvoice/webhooks/twilio/sms`
- `openclaw voicecall initiate` works end-to-end with two-way audio
- ClawVoice status/diagnostics and post-call companion workflows pass
