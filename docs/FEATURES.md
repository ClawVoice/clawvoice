# ClawVoice Features

ClawVoice is a voice calling plugin for OpenClaw that adds PSTN voice channels for AI agents.

## Core Features

- OpenClaw voice channel plugin architecture (`kind: "channel"`, `channels: ["voice"]`).
- Inbound and outbound phone call support for agent-led conversations.
- Telephony provider support for Telnyx and Twilio.
- Voice provider configuration for Deepgram Agent and ElevenLabs Conversational modes.
- Agent tools for call workflows:
- `clawvoice.call`
- `clawvoice.hangup`
- `clawvoice.status`
- `clawvoice.promote_memory`
- Interactive setup wizard via CLI (`clawvoice setup`).
- Configurable voice persona via `voiceSystemPrompt` to define agent behavior on calls.
- Enable/disable inbound call answering via `inboundEnabled` config flag.
- Configuration precedence with deterministic resolution:
  - environment variables
  - plugin configuration
  - defaults
- Runtime config validation that blocks startup on missing required fields.
- Voice session safety controls:
  - optional tool restriction in voice sessions
  - deny-list support for high-risk tools
- Voice memory isolation by redirecting voice writes to the `voice-memory` namespace.
- Call lifecycle service with active call tracking and provider adapter abstraction.
- Webhook route scaffolding for telephony provider event ingestion.

## Interfaces Exposed

- Agent tool interface (`clawvoice.*`).
- CLI interface (`openclaw clawvoice ...`).
- HTTP webhook routes (`/clawvoice/webhooks/...`).
- Hook integration for tool gating and memory write isolation.
