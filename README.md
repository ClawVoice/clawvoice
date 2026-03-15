# ClawVoice

Voice calling plugin for OpenClaw. Give your AI agent a phone number.

## What It Does

ClawVoice connects your OpenClaw agent to the phone network. Your agent can receive and make phone calls, with real-time voice conversation powered by Deepgram Voice Agent or ElevenLabs Conversational AI.

**Key features:**
- **Two voice pipelines**: Deepgram Voice Agent (single WebSocket, lowest latency) or ElevenLabs Conversational AI (premium voice quality)
- **Voice memory isolation**: Phone calls write to a sandboxed `voice-memory/` namespace. Voice callers cannot corrupt your agent's main memory. Memory promotion to `MEMORY.md` requires explicit review.
- **Post-call analysis**: After every call, get a summary, mood analysis, topic extraction, and action items written to voice memory.
- **Inbound + outbound**: Your agent can take calls and initiate them.

## Quick Start

### 1. Install

Bring your own API keys. You control everything.
<br>

Configure your providers in `.env` or via `openclaw config set`:
- **Telephony**: Telnyx (recommended) or Twilio
- **Voice**: Deepgram Voice Agent or ElevenLabs Conversational AI
- **Analysis**: OpenAI (optional, falls back to OpenClaw's configured model)


```bash
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
openclaw config set clawvoice.telephonyProvider telnyx
openclaw config set clawvoice.telnyxApiKey YOUR_KEY
openclaw config set clawvoice.telnyxConnectionId YOUR_CONNECTION_ID
openclaw config set clawvoice.telnyxPhoneNumber +15551234567

# Voice (Deepgram Voice Agent)
openclaw config set clawvoice.voiceProvider deepgram-agent
openclaw config set clawvoice.deepgramApiKey YOUR_KEY

# Or set via .env file — see .env.example
```

### 4. Start

```bash
openclaw start
```

Your agent now answers calls to the configured phone number.

### 5. Make a test call

```bash
openclaw clawvoice call +15559876543
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

## Agent Tools

The plugin registers these tools for your OpenClaw agent:

| Tool | Description |
|------|-------------|
| `voice_assistant.call` | Initiate an outbound phone call |
| `voice_assistant.hangup` | End an active call |
| `voice_assistant.status` | Get status of active/recent calls |
| `voice_assistant.promote_memory` | Promote a voice memory to main memory |

## Architecture

```
Phone ──PSTN──> Telnyx ──WebSocket──> ClawVoice Plugin ──> OpenClaw Agent
                                           │
                                    ┌──────┴──────┐
                              Deepgram        ElevenLabs
                            Voice Agent      Conversational AI
                           (STT+LLM+TTS)    (STT+TTS, OpenClaw=LLM)
                                           │
                                    voice-memory/
                                   (sandboxed writes)
```

## Configuration Reference

See [`.env.example`](.env.example) for all environment variables.

Key settings in `openclaw.plugin.json` `configSchema`:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `telephonyProvider` | `"telnyx" \| "twilio"` | `"telnyx"` | PSTN provider |
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
