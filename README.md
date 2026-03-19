# ClawVoice

Voice operations plugin for OpenClaw with standalone transport and optional companion mode. Add SMS, memory isolation, and safety controls around voice calls.

## What It Does

ClawVoice adds operational layers around OpenClaw voice workflows: SMS handling, memory isolation, tool restrictions, prompt-guarding, and post-call context.

ClawVoice supports two live-call modes:
- **standalone**: ClawVoice owns Twilio media transport internally (no `voice-call` plugin required)
- **companion**: OpenClaw `voice-call` owns transport, ClawVoice adds operations/safety layers

**Key features:**
- **Standalone transport available**: internal Twilio media stream receiver + voice provider bridge (Deepgram/ElevenLabs)
- **Companion mode available**: delegates live call media transport to OpenClaw `voice-call`
- **Voice memory isolation**: Phone calls write to a sandboxed `voice-memory/` namespace. Voice callers cannot corrupt your agent's main memory. Memory promotion to `MEMORY.md` requires explicit review.
- **Post-call analysis**: After every call, get a transcript, call summary with outcome/failures/retry context, and action items written to voice memory.
- **SMS send/receive**: Keep telephony text workflows in ClawVoice.

## Live Call Mode

- `callMode=standalone`: ClawVoice handles Twilio media transport directly.
- `callMode=companion` (default): OpenClaw `voice-call` handles live call audio.

Use standalone when you want a self-contained ClawVoice install. Use companion when you want OpenClaw `voice-call` to own transport.

Companion remains the default for backward compatibility; the quick start below shows standalone for new self-contained installs.

## Is This Worth It?

Yes. ClawVoice now supports both standalone transport and companion orchestration.

| Capability | OpenClaw `voice-call` | ClawVoice (standalone/companion) |
|---|---|---|
| Telephony/media transport | Primary owner in companion mode | Primary owner in standalone mode |
| Real-time call audio path | Primary owner in companion mode | Reimplemented in standalone mode |
| SMS workflows | Basic/adjacent | Primary owner |
| Memory isolation + promotion workflow | Limited | Primary owner |
| Prompt/tool safety guardrails for voice sessions | Limited | Primary owner |
| Post-call retry context + operational diagnostics | Basic | Primary owner |

Positioning: **ClawVoice can run standalone for end-to-end Twilio + voice transport, or as a companion layer when you prefer OpenClaw `voice-call` for transport ownership.**

## Migration Notes

If you are already on companion mode, your setup keeps working. To move to standalone mode:

1. Set mode and stream URL:

```bash
openclaw config set clawvoice.callMode standalone
openclaw config set clawvoice.twilioStreamUrl wss://your-host.example.com/media-stream
```

2. Update Twilio Voice webhook to `https://your-host.example.com/clawvoice/webhooks/twilio/voice`.
3. Keep Twilio SMS webhook on `https://your-host.example.com/clawvoice/webhooks/twilio/sms`.
4. Validate with `openclaw clawvoice test`.

## Quick Start

### 1. Install

Bring your own API keys. You control everything.
<br>

Configure your providers in `.env` or via `openclaw config set`:
- **Telephony**: Telnyx (recommended) or Twilio
- **Voice**: Deepgram Voice Agent or ElevenLabs Conversational AI
- **Analysis**: OpenAI (optional, falls back to OpenClaw's configured model)


```bash
openclaw plugins install @clawvoice/clawvoice
```

Optional (only for companion mode):

```bash
openclaw plugins install @openclaw/voice-call
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
openclaw config set clawvoice.callMode standalone
openclaw config set clawvoice.telephonyProvider twilio
openclaw config set clawvoice.twilioAccountSid YOUR_SID
openclaw config set clawvoice.twilioAuthToken YOUR_TOKEN
openclaw config set clawvoice.twilioPhoneNumber +15551234567
openclaw config set clawvoice.twilioStreamUrl wss://your-host.example.com/media-stream

# Voice (Deepgram Voice Agent)
openclaw config set clawvoice.voiceProvider deepgram-agent
openclaw config set clawvoice.deepgramApiKey YOUR_KEY

# Or set via .env file — see .env.example
```

### 4. Start

```bash
openclaw start
```

In standalone mode, ClawVoice handles live audio calls directly.
In companion mode, OpenClaw `voice-call` handles transport and ClawVoice adds SMS/memory/safety features on top.

### 5. Make a test call

```bash
openclaw clawvoice call +15559876543
```

In standalone mode, this places the call directly. In companion mode, initiate outbound calls with `openclaw voicecall initiate <number>`; `openclaw clawvoice call` may prompt you to use that command.

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

If you prefer companion mode transport ownership, use `openclaw voicecall initiate <number>` for live outbound calls.

## Agent Tools

The plugin registers these tools for your OpenClaw agent:

| Tool | Description |
|------|-------------|
| `clawvoice_call` | Initiate outbound call in standalone mode; in companion mode, use `voicecall_initiate` |
| `clawvoice_hangup` | End an active call |
| `clawvoice_status` | Get status of active/recent calls |
| `clawvoice_promote_memory` | Promote a voice memory to main memory |

## Architecture

Standalone mode:

```
Phone ──PSTN──> Twilio
                 │
                 └──> ClawVoice transport + operations
                        ├──> Deepgram/ElevenLabs voice
                        └──> OpenClaw Agent runtime
```

Companion mode:

```
Phone ──PSTN──> OpenClaw voice-call (transport/media)
                 │
                 └──> ClawVoice operations layer
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
| `callMode` | `"companion" \| "standalone"` | `"companion"` | Standalone uses ClawVoice transport; companion delegates to OpenClaw `voice-call` |
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
openclaw plugins install --link @clawvoice/clawvoice
```

## License

MIT
