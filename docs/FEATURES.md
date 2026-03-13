# ClawVoice Features

ClawVoice is a voice calling plugin for OpenClaw that adds PSTN voice channels for AI agents.

## Core Features

- OpenClaw voice channel plugin architecture (`kind: "channel"`, `channels: ["voice"]`).
- Inbound and outbound phone call support for agent-led conversations.
- Telephony provider support for Telnyx and Twilio.
- Voice provider configuration for Deepgram Agent and ElevenLabs Conversational modes.
- Agent tools for call workflows:
  - `voice_assistant.call`
  - `voice_assistant.hangup`
  - `voice_assistant.status`
  - `voice_assistant.promote_memory`
- Interactive setup wizard via CLI (`clawvoice setup`) for managed and self-hosted operation.
- Managed mode with service-token onboarding and relay configuration.
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

## Delivery Modes

- Self-hosted mode (bring your own provider credentials).
- Managed mode (service token + relay path).

## Interfaces Exposed

- Agent tool interface (`voice_assistant.*`).
- CLI interface (`openclaw clawvoice ...`).
- HTTP webhook routes (`/clawvoice/webhooks/...`).
- Hook integration for tool gating and memory write isolation.
