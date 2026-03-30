# ClawVoice

**Give your AI agent a real phone number.** It answers calls, makes calls, sends texts, takes messages, books appointments, and reports back to you — all autonomously.

ClawVoice turns your [OpenClaw](https://github.com/openclaw) agent into a phone-capable assistant. Say *"Call the dentist and schedule a cleaning for next week"* and your agent handles the entire call, then sends you a summary on Telegram with the full transcript.

Website: [clawvoice.io](https://clawvoice.io)

## Why ClawVoice?

OpenClaw already has [`@openclaw/voice-call`](https://docs.openclaw.ai/plugins/voice-call) for PSTN calling. ClawVoice is a community alternative that adds batch operations, SMS, post-call intelligence, and a guided setup experience.

### vs `@openclaw/voice-call` (official plugin)

| Capability | `@openclaw/voice-call` | ClawVoice |
|------------|:----------------------:|:---------:|
| Outbound PSTN calls | ✅ | ✅ |
| Inbound call handling | ✅ | ✅ |
| Multi-turn voice conversations | ✅ | ✅ |
| Twilio | ✅ | ✅ |
| Telnyx | ✅ | ✅ |
| Plivo | ✅ | — |
| SMS send/receive | — | ✅ |
| Batch calling + campaign reports | — | ✅ |
| Post-call notifications (Telegram/Discord/Slack) | — | ✅ |
| Voice profiles (owner identity per call) | — | ✅ |
| ElevenLabs Conversational AI agent | — | ✅ |
| Deepgram Voice Agent | — | ✅ |
| Setup wizard + health diagnostics | — | ✅ |
| Call state machine (13 states) | ✅ | — |
| Tailscale Funnel exposure | ✅ | ✅ |
| Latency analysis CLI | ✅ | — |

**Choose `@openclaw/voice-call`** if you need Plivo support or prefer the official plugin with OpenClaw core team maintenance.

**Choose ClawVoice** if you want SMS, batch campaigns with CSV reports, post-call notifications, voice profiles, or a wizard-guided setup.

> **Note:** OpenClaw also has [Talk Mode](https://docs.openclaw.ai/nodes/talk) — a built-in local voice chat for speaking with your agent through your device's microphone. Neither ClawVoice nor `@openclaw/voice-call` replaces Talk Mode; they add PSTN telephony (real phone calls to real phone numbers).

## Features

| Feature | Description |
|---------|-------------|
| Outbound calls | Agent places calls with full context about purpose, owner identity, and callback number |
| Inbound calls | Agent answers your phone number, takes messages, screens callers |
| Batch calling | Sequential calls from a list (up to 20), with consolidated reporting |
| Campaign reports | CSV spreadsheets with extracted details, summaries, and full transcripts |
| SMS send/receive | Text messaging with auto-reply for inbound texts |
| Post-call notifications | Rich summaries to Telegram/Discord/Slack with transcript file attachments |
| Voice profile | Owner identity, phone number, and preferences loaded into every call |
| Memory isolation | Voice interactions sandboxed from main agent memory |
| Safety guardrails | AI disclosure, call duration limits, tool restrictions, answering machine detection |
| Dual voice engines | ElevenLabs Conversational AI or Deepgram Voice Agent |

> **Legal Notice:** Automated calling is subject to the TCPA (Telephone Consumer Protection Act) and state telemarketing laws. You are responsible for compliance including obtaining proper consent. Batch calling features are provided as-is — **use at your own risk.** This software does not provide legal advice.

---

## Getting Started

There are two ways to set up ClawVoice:

| Method | Best for |
|--------|----------|
| **Guided setup** — Tell your agent *"Set up ClawVoice"* or run `openclaw clawvoice setup` | First-time users. The wizard walks through every step with explanations. |
| **Manual setup** — Follow the steps below | Experienced users or automated deployments |

### What You'll Need

| Requirement | Where to get it | Cost |
|-------------|----------------|------|
| **OpenClaw** installed and running | [openclaw.dev](https://openclaw.dev) | Free (open source) |
| **Phone number** from Twilio or Telnyx | [twilio.com](https://twilio.com) or [telnyx.com](https://telnyx.com) | ~$1.50/mo |
| **Deepgram API key** | [deepgram.com](https://deepgram.com) | Free tier available |
| **ElevenLabs API key + Agent ID** *(optional, for premium voices)* | [elevenlabs.io](https://elevenlabs.io) | Free tier available |
| **Tunnel tool** (ngrok, Cloudflare Tunnel, or Tailscale Funnel) | See [Step 2](#2-start-a-public-tunnel) | Free options available |

> **Note:** A Deepgram API key is always required — even if you use ElevenLabs for voice. Deepgram handles speech-to-text for call transcription.

**Cost per call:**

| Voice Stack | Telephony | Voice AI | Total per minute |
|-------------|-----------|----------|------------------|
| **Deepgram** (recommended to start) | ~$0.01 | ~$0.01 | **~$0.02/min** |
| **ElevenLabs** (premium voices) | ~$0.01 | ~$0.12–0.15 | **~$0.13–0.16/min** |

A typical 5-minute call costs **$0.10** on Deepgram or **$0.65–0.80** on ElevenLabs. Both voice providers offer free tiers to get started.

> **If you're using ElevenLabs:** Create your ElevenLabs Conversational AI agent **before** running the setup wizard — the wizard asks for your Agent ID. See [Step 4](#4-configure-elevenlabs-agent-if-using-elevenlabs) for instructions.

> **If you already have `@openclaw/voice-call` installed:** ClawVoice replaces the built-in voice plugin. Disable it to prevent conflicts: `openclaw plugins disable voice-call`. The setup wizard will detect and warn you about this automatically.

### 1. Install

ClawVoice is published on [npm](https://www.npmjs.com/package/clawvoice). Install it with npm, then register it as an OpenClaw plugin:

```bash
npm install -g clawvoice
openclaw plugins install clawvoice
```

**Or install from source** (for contributors or pre-release versions):

```bash
git clone https://github.com/ClawVoice/clawvoice.git
cd clawvoice
npm install && npm run build
openclaw plugins install --link .
```

### 2. Start a Public Tunnel

Twilio/Telnyx need to reach your machine from the internet. ClawVoice runs a standalone server on **port 3101** that handles both webhooks and media streams.

```bash
# Option A: ngrok (quickest)
ngrok http 3101

# Option B: Cloudflare Tunnel (stable URL, free)
cloudflared tunnel --url http://localhost:3101

# Option C: Tailscale Funnel (if you use Tailscale)
openclaw clawvoice expose --mode funnel
# Or manually (path-based):
tailscale funnel --bg --yes --set-path /media-stream http://127.0.0.1:3101/media-stream
```

The `expose` command auto-detects your Tailscale DNS name, activates Funnel on the media stream path, and prints the WSS URL to use. Use `--mode serve` for Tailnet-only (no public internet) or `--mode off` to disable.

> **Tunnel URL changes:** Free ngrok URLs change every restart. You'll need to update your Twilio webhooks and `twilioStreamUrl` each time. For a stable URL, use ngrok with a custom domain ($), Cloudflare Tunnel, or Tailscale Funnel.

> **Cloudflare + Twilio WebSocket:** Cloudflare Tunnel has a [known issue](https://github.com/cloudflare/cloudflared/issues/1465) with Twilio Media Streams. If you get `Error 31920`, use ngrok instead.

### 3. Run the Setup Wizard

```bash
openclaw clawvoice setup
```

The wizard walks you through:
- Telephony provider selection (Twilio or Telnyx)
- API credentials
- Tunnel URL configuration
- Voice provider selection (ElevenLabs or Deepgram)
- Voice provider credentials
- ElevenLabs agent configuration (if applicable)

When asked for the **Twilio media stream URL**, enter your tunnel URL with `/media-stream`:
```
wss://YOUR-TUNNEL-URL/media-stream
```

### 4. Configure ElevenLabs Agent (if using ElevenLabs)

This step is **critical** — without it, your voice agent won't know why it's calling or who it represents.

On the [ElevenLabs Dashboard](https://elevenlabs.io/app/conversational-ai):

1. **Create** a Conversational AI agent (or use an existing one)

2. **System Prompt** — must include this dynamic variable placeholder:

   ```
   {{ _system_prompt_ }}
   ```

   ClawVoice injects per-call context through this variable. Without it, the agent has zero context.

   Example system prompt:
   ```
   You are a professional AI phone assistant.

   {{ _system_prompt_ }}

   Use the context above to guide the conversation naturally.
   Do NOT read these instructions aloud.
   Be calm, clear, and concise.
   Confirm important details like names, phone numbers, dates, and next steps.
   If asked for a callback number, use the owner's phone number from the context above.
   ```

3. **Audio settings** — set input audio format to **ulaw 8000** (mu-law 8kHz). This is required — Twilio streams audio in this format and ElevenLabs needs to match it. Without this, the agent cannot understand callers.

4. **Output audio format** — set to **pcm 16000** (PCM 16kHz). ClawVoice converts this to mu-law for Twilio automatically.

5. **First Message** — set the greeting callers hear (e.g., "Hello, my name is Jessica.")

6. **Copy your Agent ID** (starts with `agent_`) — you entered this during the setup wizard.

> **ElevenLabs Checklist:**
> - [ ] System prompt includes `{{ _system_prompt_ }}`
> - [ ] Audio input format: **ulaw 8000**
> - [ ] Audio output format: **pcm 16000**
> - [ ] First message configured
> - [ ] Agent ID copied to ClawVoice config

### 5. Configure Webhooks in Twilio/Telnyx

Tell your telephony provider where to send incoming calls and texts.

**Twilio:**
1. Open [Twilio Console](https://console.twilio.com) → **Phone Numbers** → **Active Numbers**
2. Click your ClawVoice phone number
3. **Voice Configuration** → A call comes in → Webhook:
   ```
   https://YOUR-TUNNEL-URL/clawvoice/webhooks/twilio/voice  (HTTP POST)
   ```
4. **Messaging Configuration** → A message comes in → Webhook:
   ```
   https://YOUR-TUNNEL-URL/clawvoice/webhooks/twilio/sms  (HTTP POST)
   ```
5. Save

**Telnyx:**
1. Open [Telnyx Mission Control](https://portal.telnyx.com) → your Call Control Application
2. Set webhook URL to: `https://YOUR-TUNNEL-URL/clawvoice/webhooks/telnyx`
3. Assign your phone number to this application

> **SMS in the US:** Outbound SMS requires [A2P 10DLC registration](https://www.twilio.com/docs/messaging/guides/10dlc) with Twilio. Without it, carriers block messages (error 30034). Register at: https://console.twilio.com/us1/develop/sms/services

### 6. Set Up Your Voice Profile

Tell the voice agent who it represents:

```bash
openclaw clawvoice profile --name "Your Name" --style casual
```

Then edit `voice-memory/user-profile.md` in your workspace:

```yaml
---
ownerName: "Your Name"
ownerPhone: "+15551234567"
communicationStyle: casual
---

## About the owner
- Brief description of who you are and what you do
- Your location (city/state for local context)
- Common call tasks: restaurant reservations, appointments, etc.
- When booking reservations or appointments, use the callback number above
```

The `ownerPhone` is important — when a restaurant asks *"what number for the reservation?"*, the voice agent provides this number.

### 7. Start and Verify

```bash
openclaw start
openclaw clawvoice status
```

All checks should show **pass**. If any fail, the output tells you exactly what to fix.

> **Tip:** Run `openclaw clawvoice status` anytime to re-check your setup — after config changes, provider swaps, or if calls stop working.

### 8. Test Connectivity

Before spending money on a real call, verify the voice pipeline is wired up correctly:

```bash
openclaw clawvoice test
```

This checks that your tunnel is reachable, provider credentials are valid, and the voice pipeline can connect. Fix any failures before proceeding.

### 9. Make a Test Call

```bash
openclaw clawvoice call +15559876543 --purpose "Test call"
```

If the call connects and you hear the voice agent, you're all set.

### 10. Enable Post-Call Notifications (Optional)

Get call summaries on Telegram/Discord/Slack after every call:

```bash
openclaw config set clawvoice.notifyTelegram true
```

After each call you'll receive:
- Formatted summary with extracted caller details, key points, and agent info
- Downloadable transcript file (`.txt`)

---

## For Humans — CLI Reference

```bash
openclaw clawvoice setup            # Interactive setup wizard
openclaw clawvoice call <num>       # Place a call
  --purpose "..."                   #   Call context (required)
  --greeting "..."                  #   Custom opening line
openclaw clawvoice sms <num>        # Send SMS
  --message "..."                   #   Message body
openclaw clawvoice status           # Active calls + diagnostics
openclaw clawvoice profile          # View/edit voice profile
  --name "Name" --style casual
openclaw clawvoice history          # Recent calls
openclaw clawvoice history <id>     # Specific call detail
openclaw clawvoice inbox            # Recent SMS messages
openclaw clawvoice promote          # Review voice memories
openclaw clawvoice test             # Test connectivity
openclaw clawvoice expose           # Tailscale Funnel/Serve tunnel
  --mode funnel|serve|off           #   Exposure mode
openclaw clawvoice clear            # Clear stuck call slots
```

---

## OpenClaw Agent Integration (Required)

ClawVoice registers tools automatically, but **your OpenClaw agent won't know it can make calls unless you tell it**. Add the following to your workspace `MEMORY.md` or agent instruction file:

```markdown
## Voice Calling (ClawVoice)

You have the `clawvoice_call` tool for placing outbound phone calls.
When asked to call someone:
- Use `clawvoice_call` with phoneNumber, purpose, and greeting
- Put ALL context in the purpose field — the voice agent is a separate AI
  and only knows what you tell it via purpose
- The voice agent identifies itself as an AI assistant — this is not impersonation
- Include: who you're calling on behalf of, why, what to ask/say, callback number
```

Without this, the agent will either ignore voice requests or shell out to the CLI instead of using the tool directly.

> **NOTE:** Plugin tools may not appear in all OpenClaw runtimes. If your agent cannot see `clawvoice_call`, use the CLI fallback via exec: `openclaw clawvoice call <number> --purpose '...' --greeting '...'`

### Purpose vs Greeting Best Practices

The `purpose` and `greeting` parameters serve different roles and should not overlap:

- **`greeting`** is the exact first sentence the voice agent speaks aloud. Keep it short — one sentence. Example: *"Hi, I'm calling on behalf of Alex Harper."*
- **`purpose`** is background context the agent uses to guide the conversation but does **not** read aloud. Include: who you represent, what to accomplish, relevant details (account numbers, preferences), and a callback number.

**Do not** put the same information in both fields. If you say "schedule a dental cleaning" in both `greeting` and `purpose`, the agent may repeat itself awkwardly.

**If using ElevenLabs:** your ElevenLabs agent's system prompt MUST include `{{ _system_prompt_ }}` — this is how ClawVoice passes per-call context (purpose, owner info) to the voice agent.

## For AI Agents — Tool Reference

These tools are automatically available when ClawVoice is installed:

| Tool | Description |
|------|-------------|
| `clawvoice_call` | Place an outbound call. **Requires `purpose`** — include who you're calling on behalf of, why, what to ask, and any relevant details. The voice agent only knows what you tell it. |
| `clawvoice_batch_call` | Make multiple sequential calls from a list. Each call completes before the next. Returns consolidated report. Max 20 calls, configurable per-call timeout. |
| `clawvoice_campaign_report` | Generate CSV from batch results: Phone, Name, Company, Purpose, Outcome, Duration, Summary, Transcript. |
| `clawvoice_hangup` | End an active call. |
| `clawvoice_send_text` | Send an SMS message. |
| `clawvoice_text_status` | Show recent SMS messages. |
| `clawvoice_status` | Call status, diagnostics, or post-call summary. |
| `clawvoice_promote_memory` | Promote voice memory to main MEMORY.md. |
| `clawvoice_clear_calls` | Clear stuck call slots. |

### Important: The voice agent is a separate AI

The voice agent (e.g., "Jessica" on ElevenLabs) runs on the phone call as a **separate AI**. It has NO access to your conversation history. The `purpose` field is its ONLY source of context.

**Good purpose:**
> "Call Dr. Smith's office on behalf of Alex Harper to schedule a dental cleaning. Prefer mornings next week. Insurance: Delta Dental. Alex's number: 555-010-2468."

**Bad purpose:**
> "Call the dentist" *(agent won't know who, why, what to ask, or what number to give)*

### Spreadsheet workflow

1. User uploads a CSV with phone numbers and call purposes
2. Agent extracts contacts, confirms the list with user
3. Agent runs `clawvoice_batch_call` with the list
4. Each call → individual Telegram notification with summary + transcript
5. All calls done → `clawvoice_campaign_report` → CSV report delivered

---

## Configuration Reference

### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `telephonyProvider` | `twilio` | `twilio` or `telnyx` |
| `voiceProvider` | `deepgram-agent` | `elevenlabs-conversational` or `deepgram-agent` |
| `twilioStreamUrl` | — | Public `wss://` URL for media streams **(required)** |
| `inboundEnabled` | `true` | Accept inbound calls and SMS |
| `smsAutoReply` | `true` | Auto-acknowledge inbound texts |
| `maxCallDuration` | `1800` | Max call length in seconds (30 min) |
| `dailyCallLimit` | `50` | Maximum outbound calls per day |
| `disclosureEnabled` | `true` | Announce AI identity at call start |
| `disclosureStatement` | `"Hello, this call is from an AI assistant..."` | What's announced |
| `recordCalls` | `false` | Save Twilio call recordings |
| `amdEnabled` | `true` | Answering machine detection |
| `mainMemoryAccess` | `read` | Can voice agent read main MEMORY.md? (`read` / `none`) |
| `restrictTools` | `true` | Block dangerous tools during voice sessions |
| `notifyTelegram` | `false` | Send post-call summaries to Telegram |
| `notifyDiscord` | `false` | Send post-call summaries to Discord |
| `notifySlack` | `false` | Send post-call summaries to Slack |

### Environment Variables

All settings can also be set via environment variables:

```bash
CLAWVOICE_TELEPHONY_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+15551234567
CLAWVOICE_TWILIO_STREAM_URL=wss://your-tunnel.ngrok-free.dev/media-stream
CLAWVOICE_VOICE_PROVIDER=elevenlabs-conversational
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_AGENT_ID=agent_...
DEEPGRAM_API_KEY=...
CLAWVOICE_MAX_CALL_DURATION=1800
CLAWVOICE_DAILY_CALL_LIMIT=50
CLAWVOICE_NOTIFY_TELEGRAM=true
CLAWVOICE_SMS_AUTO_REPLY=true
CLAWVOICE_TAILSCALE_MODE=off        # off | serve | funnel
CLAWVOICE_TAILSCALE_PATH=/media-stream
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Call disconnects immediately | ElevenLabs agent missing `{{ _system_prompt_ }}` or wrong audio format | Check ElevenLabs dashboard: system prompt has placeholder, audio input is ulaw 8000 |
| Agent can't hear caller | Audio format mismatch | Set ElevenLabs input to **ulaw 8000**, output to **pcm 16000** |
| Agent doesn't know why it's calling | Empty `purpose` parameter | Always include detailed purpose when placing calls |
| Agent doesn't know owner's phone number | Missing `ownerPhone` in profile | Edit `voice-memory/user-profile.md` and add `ownerPhone` field |
| Webhooks return 404 | Routes not reaching standalone server | Ensure tunnel points to port **3101**, not the gateway port |
| SMS blocked (error 30034) | US A2P 10DLC not registered | Register with [Twilio Messaging Service](https://console.twilio.com/us1/develop/sms/services) |
| `clawvoice status` shows failures | Missing credentials or tunnel down | Run `openclaw clawvoice setup` to reconfigure |
| Tunnel URL changed | ngrok free tier rotates URLs | Update `twilioStreamUrl` and Twilio webhook URLs |
| Agent repeats itself on calls | Duplicate purpose in system prompt | Ensure purpose is stated once (profile + purpose, not both saying the same thing) |
| Agent uses wrong voice plugin | `@openclaw/voice-call` is also installed | Disable it: `openclaw plugins disable voice-call` or set `plugins.entries["voice-call"].enabled = false` in config |
| Tailscale Funnel not working | Funnel not enabled for your account | Visit your [Tailscale admin console](https://login.tailscale.com/admin/dns) and enable Funnel, then retry `openclaw clawvoice expose --mode funnel` |

> **Compatibility note:** OpenClaw ships a built-in `@openclaw/voice-call` plugin. If both it and ClawVoice are active, the agent may route voice requests unpredictably. ClawVoice's setup wizard and `status` command will warn you if a conflict is detected. To resolve, disable one:
>
> ```bash
> openclaw plugins disable voice-call
> ```

---

## Architecture

```
Phone ──PSTN──> Twilio/Telnyx
                  │
                  ├── webhook (HTTPS) ──> ClawVoice standalone server (:3101)
                  │                         ├── call control + SMS handling
                  │                         ├── inbound call routing
                  │                         └── Twilio signature verification
                  │
                  └── media stream (WSS) ──> ClawVoice standalone server (:3101)
                                              ├── audio bridge (mulaw ↔ PCM)
                                              ├── ElevenLabs / Deepgram voice AI
                                              ├── transcript collection
                                              └── post-call: summary + notifications
```

## Voice Memory Isolation

Voice calls are riskier than text — callers can attempt social engineering. ClawVoice sandboxes all voice interactions:

```
workspace/
  MEMORY.md              # Main memory (text channels only)
  voice-memory/          # Voice-only sandbox
    user-profile.md      # Owner identity and preferences
    latest-summary.md    # Most recent call summary
    calls/               # Individual call transcripts (JSON)
    campaigns/           # Batch call reports
```

- Voice agent can **read** main memory (configurable via `mainMemoryAccess`)
- Voice agent can **only write** to `voice-memory/`
- Promotion to main memory requires explicit review via `clawvoice promote`

---

## Development

```bash
git clone https://github.com/ClawVoice/clawvoice.git
cd clawvoice
npm install                                # Install dependencies
npm run build                              # Compile TypeScript
npm test                                   # Run all tests (218 tests)
openclaw plugins install --link .          # Link local build as plugin
```

## License

MIT
