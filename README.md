# ClawVoice

Give your OpenClaw agent a phone number. It can make and receive calls, send texts, and remember conversations — all through your existing Twilio or Telnyx account.

## What You Get

- **Phone calls**: Your agent answers inbound calls and can place outbound calls
- **Two voice engines**: Deepgram Voice Agent (low latency) or ElevenLabs Conversational AI (premium voices)
- **SMS**: Send and receive text messages through the same phone number
- **Memory isolation**: Voice calls write to a separate sandbox so callers can't corrupt your agent's main memory
- **Post-call summaries**: Transcripts, action items, and call outcomes after every call
- **Safety guardrails**: Tool restrictions, call duration limits, AI disclosure, and answering machine detection

## Quick Start

### 1. Install

```bash
openclaw plugins install @clawvoice/clawvoice
```

### 2. Run the Setup Wizard

The wizard walks you through provider selection, API keys, and tunnel configuration:

```bash
openclaw clawvoice setup
```

Or configure manually — see [Configuration](#configuration) below.

### 3. Set Up a Public Tunnel

Twilio and Telnyx need to reach your machine over the internet. If OpenClaw runs on your laptop or home server, you need a tunnel.

**Using ngrok (quickest to get started):**

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3334
```

Copy the `https://` URL ngrok gives you, then configure ClawVoice:

```bash
openclaw config set clawvoice.twilioStreamUrl wss://YOUR-NGROK-URL/media-stream
```

Set your Twilio phone number's voice webhook to:
```
https://YOUR-NGROK-URL/clawvoice/webhooks/twilio/voice
```

**Using Cloudflare Tunnel (stable, free, recommended for long-term use):**

```bash
# Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:3334
```

Same idea — use the tunnel URL for webhooks and stream URL.

> **Note:** Cloudflare Tunnel has a [known issue](https://github.com/cloudflare/cloudflared/issues/1465) with WebSocket upgrades for Twilio Media Streams. If you hit this, use ngrok for the media stream URL and Cloudflare for webhooks, or use ngrok for both.

### 4. Start OpenClaw

```bash
openclaw start
```

### 5. Make a Test Call

```bash
openclaw clawvoice call +15559876543
```

Or ask your agent: *"Call +15559876543"*

## Configuration

### Manual Setup (instead of wizard)

```bash
# Telephony (Twilio)
openclaw config set clawvoice.telephonyProvider twilio
openclaw config set clawvoice.twilioAccountSid YOUR_SID
openclaw config set clawvoice.twilioAuthToken YOUR_TOKEN
openclaw config set clawvoice.twilioPhoneNumber +15551234567
openclaw config set clawvoice.twilioStreamUrl wss://YOUR-TUNNEL-URL/media-stream

# Voice (Deepgram — recommended)
openclaw config set clawvoice.voiceProvider deepgram-agent
openclaw config set clawvoice.deepgramApiKey YOUR_KEY
```

Or use environment variables — see [`.env.example`](.env.example).

### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `telephonyProvider` | `twilio` | `twilio` or `telnyx` |
| `voiceProvider` | `deepgram-agent` | `deepgram-agent` or `elevenlabs-conversational` |
| `twilioStreamUrl` | — | Public `wss://` URL for Twilio media streams (required) |
| `voiceSystemPrompt` | `""` | Instructions for how the agent behaves on calls |
| `inboundEnabled` | `true` | Accept inbound calls |
| `mainMemoryAccess` | `read` | Can voice agent read main MEMORY.md? (`read` or `none`) |
| `restrictTools` | `true` | Block dangerous tools during voice sessions |
| `maxCallDuration` | `1800` | Max call length in seconds (30 min default) |
| `amdEnabled` | `true` | Answering machine detection for outbound calls |
| `recordCalls` | `false` | Save call recordings |

## Voice Providers

### Deepgram Voice Agent (Recommended)

Single WebSocket handles speech-to-text, LLM, and text-to-speech. Lowest latency.

1. Create account at [deepgram.com](https://deepgram.com)
2. Get an API key with Speech + Voice Agent permissions
3. Set `voiceProvider` to `deepgram-agent`

### ElevenLabs Conversational AI

Premium voice quality. ElevenLabs handles the full voice pipeline.

1. Create account at [elevenlabs.io](https://elevenlabs.io)
2. Create a Conversational AI agent in the dashboard
3. Get your API key and Agent ID
4. Set `voiceProvider` to `elevenlabs-conversational`

## Voice Memory Isolation

Voice calls are riskier than text — callers can attempt social engineering. ClawVoice sandboxes all voice interactions:

```
~/.openclaw/workspace/
  MEMORY.md              # Main memory (text channels)
  voice-memory/          # Voice-only sandbox
    VOICE-MEMORY.md      # Voice long-term memory
    2026-03-11.md        # Voice daily log
```

- Voice agent can **read** main memory (configurable)
- Voice agent can **only write** to `voice-memory/`
- Promotion to main memory requires explicit review via `openclaw clawvoice promote`

## CLI Commands

```bash
openclaw clawvoice setup        # Interactive setup wizard
openclaw clawvoice call <num>   # Place an outbound call
openclaw clawvoice status       # Show active calls and config health
openclaw clawvoice promote      # Review and promote voice memories
openclaw clawvoice history      # Recent call history
openclaw clawvoice test         # Test voice pipeline connectivity
```

## Agent Tools

These tools are available to your OpenClaw agent:

| Tool | Description |
|------|-------------|
| `clawvoice_call` | Place an outbound phone call |
| `clawvoice_hangup` | End an active call |
| `clawvoice_send_text` | Send an SMS message |
| `clawvoice_text_status` | Check SMS delivery status |
| `clawvoice_status` | Get call status and diagnostics |
| `clawvoice_promote_memory` | Promote a voice memory to main memory |
| `clawvoice_clear_calls` | Clear completed call records |

## Architecture

```
Phone ──PSTN──> Twilio/Telnyx
                  │
                  ├──webhook──> ClawVoice (call control, SMS, safety)
                  │               └──> OpenClaw Agent (tools, memory, personality)
                  │
                  └──media stream──> ClawVoice (audio bridge)
                                       └──> Deepgram or ElevenLabs (voice AI)
```

## Documentation

- [`docs/SETUP.md`](docs/SETUP.md) — Full setup guide with provider-specific instructions
- [`docs/FEATURES.md`](docs/FEATURES.md) — Complete feature list

## Development

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript
npm test           # Run all tests
npm run dev        # Watch mode

# Local OpenClaw testing
npm run build && openclaw plugins install --link .
```

## License

MIT
