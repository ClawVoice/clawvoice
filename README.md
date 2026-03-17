# ClawVoice

Companion voice operations plugin for OpenClaw. Add SMS, memory isolation, and safety controls around voice calls.

## What It Does

ClawVoice adds operational layers around OpenClaw voice workflows: SMS handling, memory isolation, tool restrictions, prompt-guarding, and post-call context.

By default, ClawVoice runs in **companion mode** and expects OpenClaw's built-in `voice-call` plugin to handle live telephony audio transport.

**Key features:**
- **Companion mode by default**: delegates live call media transport to OpenClaw `voice-call`
- **Voice memory isolation**: Phone calls write to a sandboxed `voice-memory/` namespace. Voice callers cannot corrupt your agent's main memory. Memory promotion to `MEMORY.md` requires explicit review.
- **Post-call analysis**: After every call, get a transcript, call summary with outcome/failures/retry context, and action items written to voice memory.
- **SMS send/receive**: Keep telephony text workflows in ClawVoice.

## Live Call Mode

- `callMode=companion` (default): OpenClaw `voice-call` handles live call audio.
- `callMode=standalone`: legacy ClawVoice-managed Twilio media stream flow.

If your goal is reliable live calls today, use companion mode and enable both plugins.

## Is This Worth It?

Yes, if you use ClawVoice as the companion layer rather than duplicating transport.

| Capability | OpenClaw `voice-call` | ClawVoice (companion) |
|---|---|---|
| Telephony/media transport | Primary owner | Delegates by default |
| Real-time call audio path | Primary owner | Not reimplemented |
| SMS workflows | Basic/adjacent | Primary owner |
| Memory isolation + promotion workflow | Limited | Primary owner |
| Prompt/tool safety guardrails for voice sessions | Limited | Primary owner |
| Post-call retry context + operational diagnostics | Basic | Primary owner |

Positioning: **OpenClaw `voice-call` handles reliable call transport; ClawVoice adds governance and operations for production use.**

## Live Call Readiness (Current)

- `main` is not yet fully aligned with the companion architecture for live calls.
- The working companion pivot is currently in this branch and includes `callMode` defaults, companion guardrails, and updated docs.
- For production live calls now: run OpenClaw `voice-call` for transport and use this branch's companion behavior for ClawVoice features.

## Quick Start

### 1. Install

Bring your own API keys. You control everything.
<br>

Configure your providers in `.env` or via `openclaw config set`:
- **Telephony**: Telnyx (recommended) or Twilio
- **Voice**: Deepgram Voice Agent or ElevenLabs Conversational AI
- **Analysis**: OpenAI (optional, falls back to OpenClaw's configured model)


```bash
openclaw plugins install @openclaw/voice-call
openclaw plugins install @clawvoice/voice-assistant
```

### 2. Get API Keys

**Telephony** (pick one):
- [Telnyx](https://telnyx.com) - Create account, get API key, buy a phone number, set up a Call Control app
- [Twilio](https://twilio.com) - Create account, get SID + auth token, buy a phone number

**Voice** (pick one):
- [Deepgram](https://deepgram.com) - Create account, get API key (needed for both voice provider options)
- [ElevenLabs](https://elevenlabs.io) - Create account, get API key, create a Conversational AI agent (for Option B only)

### 3. Configure

```bash
# Telephony
openclaw config set clawvoice.callMode companion
openclaw config set clawvoice.telephonyProvider twilio
openclaw config set clawvoice.twilioAccountSid YOUR_SID
openclaw config set clawvoice.twilioAuthToken YOUR_TOKEN
openclaw config set clawvoice.twilioPhoneNumber +15551234567

# Voice (Deepgram Voice Agent)
openclaw config set clawvoice.voiceProvider deepgram-agent
openclaw config set clawvoice.deepgramApiKey YOUR_KEY

# Or set via .env file — see .env.example
```

### 4. Start

```bash
openclaw start
```

Your OpenClaw `voice-call` plugin handles live audio calls.
ClawVoice adds SMS/memory/safety features on top.

### 5. Make a test call

```bash
openclaw voicecall initiate +15559876543
```

Or ask your agent: *"Call +15559876543"*

## Voice Providers

### Deepgram Voice Agent (Recommended)

Single WebSocket handles STT + LLM + TTS. Lowest latency (~200ms round-trip).

- Uses Deepgram's Agent API
- TTS: Deepgram Aura voices (included) or ElevenLabs (BYOK, routed through Deepgram)
- Barge-in support (caller can interrupt)
- LLM routing happens inside Deepgram's infrastructure

### ElevenLabs Conversational AI

ElevenLabs handles the entire voice pipeline. Premium voice quality.

- Create an ElevenLabs Conversational AI agent in their dashboard
- Point it at your OpenClaw gateway's `/v1/chat/completions` endpoint
- ElevenLabs handles STT, turn-taking, and TTS
- OpenClaw provides the brain (tools, memory, personality)

## Voice Memory Isolation

Phone calls are inherently riskier than text — callers can attempt social engineering or prompt injection via voice. ClawVoice sandboxes all voice interactions:

```
~/.openclaw/workspace/
  MEMORY.md              # Main memory (text channels)
  memory/                # Main daily logs
  voice-memory/          # Voice-only sandbox
    VOICE-MEMORY.md      # Curated voice long-term memory
    2026-03-11.md        # Voice daily log
```

**Access rules:**
- Voice agent can READ main `MEMORY.md` (configurable)
- Voice agent can ONLY WRITE to `voice-memory/`
- Text channels don't see `voice-memory/` by default
- Memory promotion requires explicit review

### Promote voice memories

```bash
openclaw clawvoice promote
```

Reviews pending voice memories and lets you approve/reject promotion to main `MEMORY.md`.

## CLI Commands

```bash
openclaw clawvoice setup                   # Interactive setup wizard
openclaw clawvoice call <number>           # Initiate outbound call
openclaw clawvoice status                  # Show active calls and config
openclaw clawvoice promote                 # Review and promote voice memories
openclaw clawvoice history                 # Show recent call history
openclaw clawvoice test                    # Test voice pipeline connectivity
```

In companion mode, use `openclaw voicecall initiate <number>` for live outbound calls.

## Agent Tools

The plugin registers these tools for your OpenClaw agent:

| Tool | Description |
|------|-------------|
| `voice_assistant.call` | Initiate outbound call in standalone mode (companion mode returns guidance to use `voicecall.initiate`) |
| `voice_assistant.hangup` | End an active call |
| `voice_assistant.status` | Get status of active/recent calls |
| `voice_assistant.promote_memory` | Promote a voice memory to main memory |

## Architecture

```
Phone ──PSTN──> OpenClaw voice-call (transport/media)
                               │
                               ├──> OpenClaw Agent runtime
                               │
                               └──> ClawVoice companion layer
                                     - SMS workflows
                                     - memory isolation/promotion
                                     - safety guardrails
                                     - post-call summaries/retry context
```

## Configuration Reference

See [`.env.example`](.env.example) for all environment variables.

Key settings in `openclaw.plugin.json` `configSchema`:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `callMode` | `"companion" \| "standalone"` | `"companion"` | Companion delegates live call transport to OpenClaw `voice-call` |
| `telephonyProvider` | `"telnyx" \| "twilio"` | `"twilio"` | PSTN provider |
| `voiceProvider` | `"deepgram-agent" \| "elevenlabs-conversational"` | `"deepgram-agent"` | Voice pipeline |
| `voiceSystemPrompt` | `string` | `""` | Instructions for how the agent behaves on calls |
| `inboundEnabled` | `boolean` | `true` | Accept inbound calls (disable to only allow outbound) |
| `mainMemoryAccess` | `"read" \| "none"` | `"read"` | Can voice agent read main MEMORY.md? |
| `autoExtractMemories` | `boolean` | `true` | Extract memories from transcripts after calls |
| `restrictTools` | `boolean` | `true` | Restrict tool access for voice sessions |
| `amdEnabled` | `boolean` | `true` | Answering machine detection for outbound calls |
| `maxCallDuration` | `number` | `1800` | Maximum call length in seconds |
| `recordCalls` | `boolean` | `false` | Save call recordings |

## Customizing the Agent's Voice Persona

Set `voiceSystemPrompt` to control how your agent behaves on phone calls:

```bash
openclaw config set clawvoice.voiceSystemPrompt "You are a friendly customer support agent for Acme Corp. Be concise, helpful, and professional. Always confirm the caller's name before proceeding."
```

This prompt is injected into the voice agent's system instructions alongside OpenClaw's base personality. If left empty, the agent uses OpenClaw's default system prompt.

## Documentation

- [`docs/SETUP.md`](docs/SETUP.md) - Full setup guide with step-by-step instructions and configuration reference
- [`docs/FEATURES.md`](docs/FEATURES.md) - Complete feature list
- [`docs/COMPANION_POSITIONING.md`](docs/COMPANION_POSITIONING.md) - Built-in vs companion differentiation and rollout checklist

- [`docs/OPENCLAW_PLUGIN_GUIDE.md`](docs/OPENCLAW_PLUGIN_GUIDE.md) - Technical guide for building the OpenClaw plugin

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Development mode (watch + rebuild)
npm run dev

# Link for local OpenClaw testing
npm link
openclaw plugins install --link @clawvoice/voice-assistant
```

## License

MIT
