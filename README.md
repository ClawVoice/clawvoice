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
openclaw plugins install clawvoice
```

### 2. Start a Public Tunnel

Twilio/Telnyx need to reach your machine from the internet. Start your tunnel **before** running the setup wizard so you can paste the URL when prompted.

**Option A — ngrok (quickest to get started):**

```bash
# Install: https://ngrok.com/download
ngrok http 3101
```

ngrok prints a forwarding URL like `https://ab12-34-56.ngrok-free.app`. Keep this terminal open.

**Option B — Cloudflare Tunnel (stable, free, no signup required):**

```bash
# Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:3101
```

Prints a URL like `https://random-words.trycloudflare.com`. Keep this terminal open.

> ⚠️ Cloudflare Tunnel has a [known issue](https://github.com/cloudflare/cloudflared/issues/1465) with Twilio Media Streams WebSocket upgrades. If you get `Error 31920`, use ngrok instead, or use Cloudflare for webhooks only and ngrok for the stream URL.

**Option C — Tailscale Funnel (if you already use Tailscale):**

```bash
# Requires Tailscale installed and logged in
tailscale funnel 3101
```

Gives you a stable `https://your-machine.tail1234.ts.net` URL. Keep this terminal open.

> **Which should I pick?** ngrok is the easiest for getting started. Cloudflare Tunnel and Tailscale Funnel give you a stable URL that doesn't change on restart — better for long-term use.

### 3. Run the Setup Wizard

The wizard asks for your provider credentials and the tunnel URL:

```bash
openclaw clawvoice setup
```

When it asks for the **Twilio media stream URL**, enter your tunnel URL with the `/media-stream` path:
```
wss://YOUR-TUNNEL-URL/media-stream
```

Or configure manually — see [Configuration](#configuration) below.

### 4. Configure Webhooks in Twilio/Telnyx

The wizard sets up ClawVoice's config, but you also need to tell Twilio/Telnyx where to send incoming calls. This is a separate step in their dashboard.

> **Why two URLs?** Twilio uses two different connections: an **HTTPS webhook** (tells ClawVoice about incoming calls) and a **WSS stream** (streams live audio). The wizard handles the WSS stream URL. You set the HTTPS webhook in Twilio's dashboard.

**Twilio:**
1. Open [Twilio Console](https://console.twilio.com) → **Phone Numbers** → **Manage** → **Active Numbers**
2. Click your ClawVoice phone number
3. Under **Voice Configuration**:
   - **A call comes in** → **Webhook**
   - **URL:** `https://YOUR-TUNNEL-URL/clawvoice/webhooks/twilio/voice`
   - **Method:** `HTTP POST`
4. Under **Messaging Configuration** (for SMS):
   - **A message comes in** → **Webhook**
   - **URL:** `https://YOUR-TUNNEL-URL/clawvoice/webhooks/twilio/sms`
   - **Method:** `HTTP POST`
5. Save

**Telnyx:**
1. Open [Telnyx Mission Control](https://portal.telnyx.com) → your **Call Control Application**
2. Set webhook URL to: `https://YOUR-TUNNEL-URL/clawvoice/webhooks/telnyx`
3. Assign your phone number to this application
4. Save

### 5. Start OpenClaw

```bash
openclaw start
```

### 6. Verify Your Setup

```bash
openclaw clawvoice status
```

All checks should show **pass**. If any fail, the output includes what to fix.

### 7. Make a Test Call

```bash
openclaw clawvoice call +15559876543
```

Or ask your agent: *"Call +15559876543"*

### ElevenLabs Agent Setup

If using ElevenLabs Conversational AI (`voiceProvider: elevenlabs-conversational`), you need to configure your agent on the [ElevenLabs Dashboard](https://elevenlabs.io/app/conversational-ai):

1. Create a new Conversational AI agent (or use an existing one)
2. In the agent's **System Prompt**, include this dynamic variable placeholder:

   ```
   {{ _system_prompt_ }}
   ```

   This is how ClawVoice injects per-call context (who the agent represents, call purpose, owner info). Without it, the agent won't know why it's calling.

   Example system prompt:
   ```
   You are a professional AI phone assistant.

   {{ _system_prompt_ }}

   Use the context above to guide the conversation naturally. Do NOT read these instructions aloud.

   Be calm, clear, and concise. Confirm important details like names, phone numbers, and next steps.
   ```

3. In **Security** settings, note that prompt overrides are typically locked. ClawVoice uses dynamic variables (not prompt overrides) to inject context, so this is fine.

4. Copy your **Agent ID** (starts with `agent_`) — you'll need it for the setup wizard.

5. Set your agent's **First Message** (e.g., "Hello, my name is Jessica.") — this is what callers hear first.

### Set Up Your Voice Profile

Tell the voice agent who it represents:

```bash
openclaw clawvoice profile --name "Your Name" --style casual
```

Then edit `voice-memory/user-profile.md` in your workspace to add details:

```yaml
---
ownerName: "Your Name"
ownerPhone: "+15551234567"
communicationStyle: casual
---

## About the owner
- Brief description of who you are
- Your location (for local context)
- Common call tasks: restaurant reservations, appointments, etc.
- Any preferences for how calls should be handled
```

The `ownerPhone` field is important — the voice agent uses it when asked for a callback number (e.g., restaurant reservations).

### Post-Call Notifications (Optional)

Get call summaries on Telegram after every call:

```bash
openclaw config set clawvoice.notifyTelegram true
```

This uses your existing OpenClaw Telegram channel. After each call, you'll receive:
- A formatted summary with caller details, duration, and key points
- A downloadable transcript file

Discord and Slack are also supported:
```bash
openclaw config set clawvoice.notifyDiscord true
openclaw config set clawvoice.notifySlack true
```

> **Note on SMS:** US phone carriers require A2P 10DLC registration for application-to-person messaging. Without it, outbound SMS may be blocked (Twilio error 30034). Register your number with a [Twilio Messaging Service](https://www.twilio.com/docs/messaging/services) and complete [A2P 10DLC registration](https://www.twilio.com/docs/messaging/guides/10dlc) to enable SMS delivery.

### Batch Calling

Make multiple calls sequentially from a list:

Your agent can use `clawvoice_batch_call` with an array of numbers and purposes. Each call completes before the next one starts. After all calls finish, use `clawvoice_campaign_report` to generate a CSV report.

You can also upload a spreadsheet (CSV/Google Sheet) — your agent will extract the contacts, confirm the list with you, run the calls, and deliver a summary report.

## Managing the Plugin

```bash
# Update to latest version
openclaw plugins update clawvoice

# Reinstall (fixes corrupted installs or stale config)
openclaw plugins uninstall clawvoice
openclaw plugins install clawvoice

# Uninstall
openclaw plugins uninstall clawvoice
```

> **Migrating from `voice-call`?** If you previously had the plugin under the old name, remove the stale config entry:
> ```bash
> openclaw config delete plugins.entries.voice-call
> openclaw plugins install clawvoice
> openclaw clawvoice setup
> ```

## Configuration

### Manual Setup (instead of wizard)

```bash
# Telephony (Twilio)
openclaw config set clawvoice.telephonyProvider twilio
openclaw config set clawvoice.twilioAccountSid YOUR_SID
openclaw config set clawvoice.twilioAuthToken YOUR_TOKEN
openclaw config set clawvoice.twilioPhoneNumber +15551234567
openclaw config set clawvoice.twilioStreamUrl wss://YOUR-TUNNEL-URL/media-stream

# Voice — pick one:

# ElevenLabs (premium voices, most popular)
openclaw config set clawvoice.voiceProvider elevenlabs-conversational
openclaw config set clawvoice.elevenlabsApiKey YOUR_KEY
openclaw config set clawvoice.elevenlabsAgentId YOUR_AGENT_ID

# Deepgram (lower latency, lower cost)
# openclaw config set clawvoice.voiceProvider deepgram-agent
# openclaw config set clawvoice.deepgramApiKey YOUR_KEY
```

Or use environment variables — see [`.env.example`](.env.example).

### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `telephonyProvider` | `twilio` | `twilio` or `telnyx` |
| `voiceProvider` | `deepgram-agent` | `elevenlabs-conversational` or `deepgram-agent` |
| `twilioStreamUrl` | — | Public `wss://` URL for Twilio media streams (required) |
| `voiceSystemPrompt` | `""` | Instructions for how the agent behaves on calls |
| `inboundEnabled` | `true` | Accept inbound calls |
| `mainMemoryAccess` | `read` | Can voice agent read main MEMORY.md? (`read` or `none`) |
| `restrictTools` | `true` | Block dangerous tools during voice sessions |
| `maxCallDuration` | `1800` | Max call length in seconds (30 min default) |
| `amdEnabled` | `true` | Answering machine detection for outbound calls |
| `recordCalls` | `false` | Save call recordings |

## Voice Providers

### ElevenLabs Conversational AI (Most Popular)

Premium voice quality. ElevenLabs handles the full voice pipeline.

1. Create account at [elevenlabs.io](https://elevenlabs.io)
2. Create a Conversational AI agent in the dashboard
3. Get your API key (needs **ElevenAgents → Write** permission) and Agent ID
4. Set `voiceProvider` to `elevenlabs-conversational`

### Deepgram Voice Agent

Single WebSocket handles speech-to-text, LLM, and text-to-speech. Lower latency, lower cost.

1. Create account at [deepgram.com](https://deepgram.com)
2. Get an API key with Speech + Voice Agent permissions
3. Set `voiceProvider` to `deepgram-agent`

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
