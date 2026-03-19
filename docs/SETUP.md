# ClawVoice Setup Guide

Step-by-step instructions for installing and configuring ClawVoice with your OpenClaw agent.

## Prerequisites

- [OpenClaw](https://openclaw.dev) installed and running
- Node.js 20+
- A phone number from Telnyx or Twilio
- API keys for your chosen voice provider

## Installation

### From npm (recommended)

```bash
openclaw plugins install @clawvoice/clawvoice
```

Optional (companion mode only):

```bash
openclaw plugins install @openclaw/voice-call
```

### From source (development)

```bash
git clone https://github.com/ClawVoice/clawvoice.git
cd clawvoice
npm install
npm run build
npm test  # all tests should pass
openclaw plugins install --link .
```

## Setup

### Step 1: Choose a Telephony Provider

| Provider | Pros | Setup |
|----------|------|-------|
| **Twilio** (default) | Wider ecosystem, more docs | [twilio.com](https://twilio.com) |
| **Telnyx** | Lower cost, better international | [telnyx.com](https://telnyx.com) |

### Step 2: Get Telephony Credentials

**Telnyx:**
1. Create account at [telnyx.com](https://telnyx.com)
2. Get API Key from Dashboard > API Keys
3. Buy a phone number (Mission Control > Numbers)
4. Create a Call Control Application (Voice > Call Control)
5. Note your Connection ID

**Twilio:**
1. Create account at [twilio.com](https://twilio.com)
2. Get Account SID and Auth Token from Console
3. Buy a phone number (Phone Numbers > Manage > Buy a Number)

### Step 2.5: Secure Local Webhook Access (required)

Webhook routing depends on mode:

- `callMode=standalone`: route Twilio voice webhooks to ClawVoice (`/clawvoice/webhooks/twilio/voice`)
- `callMode=companion`: route Twilio voice webhooks to your OpenClaw `voice-call` inbound endpoint (commonly `https://<your-public-host>/voice-call/webhooks/twilio/inbound`; verify in your `voice-call` plugin docs/version)
- Twilio SMS and Telnyx webhooks continue routing to ClawVoice endpoints

If OpenClaw runs on your laptop or home server, Twilio/Telnyx still need a **public HTTPS webhook URL**.
`127.0.0.1` or private LAN IPs will fail (Twilio cannot reach them).

Use this secure pattern:

1. Keep OpenClaw bound to localhost (example: `127.0.0.1:3334`).
2. Expose only webhook paths through a tunnel hostname.
3. Keep provider signature verification enabled.
4. Point provider webhooks to:
   - Twilio voice/AMD:
     - standalone mode: `https://<your-host>/clawvoice/webhooks/twilio/voice`
     - companion mode: your OpenClaw `voice-call` inbound endpoint (commonly `https://<your-host>/voice-call/webhooks/twilio/inbound`)
   - Twilio SMS: `https://<your-host>/clawvoice/webhooks/twilio/sms`
   - `https://<your-host>/clawvoice/webhooks/telnyx`

#### Recommended tunnel options

- **Cloudflare Tunnel (recommended for most users)**
  - Stable hostname (IP changes do not matter).
  - No inbound port-forwarding on your router.
  - Can restrict to webhook path and return 404 for everything else.

- **Tailscale Funnel (good if you already use Tailscale)**
  - Stable `*.ts.net` address.
  - Still public at the Funnel URL, so treat it like internet-facing.
  - Best practice: funnel to a tiny local proxy that only forwards `/clawvoice/webhooks/*` and rejects everything else.

#### Why this is still secure

- You are not opening your full local app directly to the internet.
- Only webhook routes are exposed.
- ClawVoice cryptographically verifies provider signatures before accepting webhook data.
- Keep your tunnel hostname private and rotate keys/tokens if you suspect exposure.

### Step 2.6: Configure Inbound Webhooks (Twilio and Telnyx)

Use this section as the fast path when inbound calls are not arriving.

#### Twilio inbound setup

1. In Twilio Console, open **Phone Numbers > Manage > Active Numbers**.
2. Select the Twilio phone number you want ClawVoice to answer.
3. Under **Voice Configuration**, set:
   - **A call comes in** -> **Webhook**
   - URL by mode:
     - standalone: `https://<your-public-host>/clawvoice/webhooks/twilio/voice`
      - companion: `https://<your-public-host>/voice-call/webhooks/twilio/inbound` (confirm for your OpenClaw `voice-call` version)
   - Method: `HTTP POST`
4. Save.
5. Optional but recommended for AMD callbacks on outbound flow:
   - standalone: set to `https://<your-public-host>/clawvoice/webhooks/twilio/voice`
    - companion: use your OpenClaw `voice-call` AMD callback URL (or leave managed by `voice-call` defaults)

#### Twilio inbound SMS setup

1. In Twilio Console, open **Phone Numbers > Manage > Active Numbers**.
2. Select the same Twilio number used by ClawVoice.
3. Under **Messaging Configuration**, set:
   - **A message comes in** -> **Webhook**
   - URL: `https://<your-public-host>/clawvoice/webhooks/twilio/sms`
   - Method: `HTTP POST`
4. Save.

#### Telnyx inbound setup

1. In Telnyx Mission Control, open your **Call Control Application**.
2. Set the inbound webhook URL to:
   - `https://<your-public-host>/clawvoice/webhooks/telnyx`
3. Make sure your purchased Telnyx number is assigned to the same connection/application.
4. Save and deploy.

#### Quick validation checklist

- `openclaw clawvoice status` shows telephony credentials as pass.
- Your public URL is HTTPS and reachable from the internet (not localhost/private IP).
- Provider webhook inspector shows `200` responses from ClawVoice endpoints.
- Inbound test call reaches your agent without provider webhook errors.
- Inbound test SMS reaches `clawvoice inbox` without Twilio signature errors.

### Step 3: Choose a Voice Provider

| Provider | Latency Profile | Quality | Cost |
|----------|-----------------|---------|------|
| **Deepgram Voice Agent** (recommended) | Lowest of supported options in most setups | Good | Lower |
| **ElevenLabs Conversational AI** | Usually higher than Deepgram in equivalent setups | Premium | Higher |

### Step 4: Get Voice Credentials

**Deepgram (recommended for most users):**
1. Create account at [deepgram.com](https://deepgram.com)
2. Get API Key from Dashboard > API Keys
3. The key needs **Speech** and **Voice Agent** permissions (or use the default full-access key)

**ElevenLabs (premium voice quality):**
1. Create account at [elevenlabs.io](https://elevenlabs.io)
2. Go to **Developers > API Keys** and create a new key
3. Set permissions to include **Conversational AI** (agents + conversations). A full-access key also works.
4. Go to **Agents** in the dashboard and create an agent:
   - Choose a template (Personal Assistant, Business Agent, etc.) or start from blank
   - Configure the agent's system prompt, voice, and behavior
   - Save and copy the **Agent ID** (format: `J3Pbu5gP6NNKBscdCdwB` — ~20 character alphanumeric string found in the agent's URL and settings)

> **Agent IDs are account-specific.** There are no shared public demo agents — you must create your own in the ElevenLabs dashboard.

> **Does your Twilio number need to be configured in ElevenLabs?** No. ClawVoice handles telephony transport in standalone mode, and OpenClaw `voice-call` handles it in companion mode. You do not need to import Twilio credentials into ElevenLabs or link your phone number there. Your ElevenLabs API key and Agent ID are all the voice stack needs.

### ElevenLabs Agent Setup (supported path)

ClawVoice supports ElevenLabs through the **ElevenLabs Conversational AI Agent** path.
Use this prompt template as your starting point:
- `docs/templates/ELEVENLABS_AGENT_PROMPT_TEMPLATE.md`

For reusable role-based prompts (customer support, personal assistant, concierge):
- `docs/templates/VOICE_SYSTEM_PROMPT_TEMPLATES.md`

### ElevenLabs Dashboard Checklist

When creating your agent in ElevenLabs, configure these tabs:

- **Agent:** Set `First Message`, `System Prompt`, language, and voice.
- **Workflow:** Optional. Keep default unless you need multi-stage routing/escalation.
- **Knowledge Base:** Add product/policy docs if the agent must answer factual questions.
- **Analysis:** Define success criteria + structured fields to extract after calls.
- **Tools:** Enable at least `End Call`; add transfer/integrations as needed.
- **Tests:** Run scripted test conversations before live calls.
- **Widget:** Not needed for ClawVoice telephony bridge.
- **Security:** Use signed URLs/private access; do not expose public agent access unnecessarily.
- **Advanced:** Tune interruption/timeout behavior for phone-call pacing.

### Step 5: Configure

Via CLI:
```bash
# Telephony (Telnyx example)
openclaw config set clawvoice.telephonyProvider telnyx
openclaw config set clawvoice.telnyxApiKey tk_your_api_key
openclaw config set clawvoice.telnyxConnectionId your_connection_id
openclaw config set clawvoice.telnyxPhoneNumber +15551234567
openclaw config set clawvoice.telnyxWebhookSecret your_webhook_secret

# Voice (Deepgram example)
openclaw config set clawvoice.voiceProvider deepgram-agent
openclaw config set clawvoice.deepgramApiKey your_deepgram_key
```

Or via environment variables:
```bash
export CLAWVOICE_TELEPHONY_PROVIDER=telnyx
export TELNYX_API_KEY=tk_your_api_key
export TELNYX_CONNECTION_ID=your_connection_id
export TELNYX_PHONE_NUMBER=+15551234567
export DEEPGRAM_API_KEY=your_deepgram_key
```

Or use the interactive wizard:
```bash
openclaw clawvoice setup
```

### Step 6: Verify

```bash
# Run health diagnostics
openclaw clawvoice status

# Test connectivity
openclaw clawvoice test
```

You should see all checks passing. If any fail, the output includes remediation steps.

### Step 7: Start

```bash
openclaw start
```

Your agent now answers calls at your configured phone number.

### Step 8: Test

```bash
# Make a test call
openclaw clawvoice call +15559876543

# Or ask your agent
"Call +15559876543"
```

## Configuration Reference

### Core Settings

| Setting | Env Variable | Default | Description |
|---------|-------------|---------|-------------|
| `telephonyProvider` | `CLAWVOICE_TELEPHONY_PROVIDER` | `twilio` | `telnyx` or `twilio` |
| `voiceProvider` | `CLAWVOICE_VOICE_PROVIDER` | `deepgram-agent` | `deepgram-agent` or `elevenlabs-conversational` |
| `voiceSystemPrompt` | `CLAWVOICE_VOICE_SYSTEM_PROMPT` | `""` | Instructions for how the agent behaves on calls |
| `inboundEnabled` | `CLAWVOICE_INBOUND_ENABLED` | `true` | Accept inbound calls (set to `false` for outbound-only) |

### Operating Profiles (Agent vs Human)

#### Autonomous Agent Mode (fully autonomous)

Use this when the OpenClaw agent should run calls directly with policy constraints.

```bash
openclaw config set clawvoice.inboundEnabled true
openclaw config set clawvoice.mainMemoryAccess read
openclaw config set clawvoice.restrictTools true
openclaw config set clawvoice.voiceSystemPrompt "You are a concise, policy-compliant assistant. Confirm identity for sensitive actions, avoid speculation, and escalate uncertainty."
openclaw config set clawvoice.dailyCallLimit 50
```

#### Human Operator Assist Mode (human-in-the-loop)

Use this when a person supervises calls and approves memory promotion/actions.

```bash
openclaw config set clawvoice.inboundEnabled false
openclaw config set clawvoice.mainMemoryAccess none
openclaw config set clawvoice.restrictTools true
openclaw config set clawvoice.voiceSystemPrompt "You are an assistant for a human operator. Gather facts, summarize clearly, and ask for explicit confirmation before irreversible actions."
openclaw config set clawvoice.dailyCallLimit 20
```

### Ready-to-Use Personality Templates

Use these directly with `voiceSystemPrompt`, then tune to your brand and policy needs.

#### Customer Support Specialist

```bash
openclaw config set clawvoice.voiceSystemPrompt "You are a customer support specialist. Be calm, clear, and empathetic. Verify account identity before account-specific actions. Explain next steps in short numbered lists. Never invent policy details; if uncertain, say what you need to confirm and offer escalation. Summarize each call with issue, action taken, and follow-up owner."
```

#### Personal Assistant

```bash
openclaw config set clawvoice.voiceSystemPrompt "You are a personal assistant for a busy user. Prioritize clarity and brevity. Confirm dates, times, and names before finalizing tasks. Read back critical details for confirmation. If information is missing, ask one focused follow-up question. Keep tone warm and professional, and end each call with a concise recap and next action."
```

#### Concierge / Front Desk

```bash
openclaw config set clawvoice.voiceSystemPrompt "You are a concierge representative. Be welcoming, polished, and efficient. Gather visitor intent quickly, offer options, and guide to a clear outcome. For bookings or changes, confirm location, time, party size, and contact method. If requests exceed policy, offer the closest approved alternative and escalation path."
```

Tip: Combine each template with `restrictTools=true`, an explicit `deniedTools` list, and a suitable `dailyCallLimit` for safer production behavior.

### Voice Defaults and Selection

- Default voice provider is `deepgram-agent` with default voice `aura-asteria-en`.
- Start with Deepgram first for baseline setup, then switch to ElevenLabs if you want a different voice quality profile.

### Latency Expectations

- Do not plan around guaranteed sub-200 ms end-to-end phone latency.
- ClawVoice runs in a real-time bridge path (telephony network + OpenClaw host + voice provider), so real latency depends on network and provider response time.
- In most deployments, Deepgram is the lower-latency option versus ElevenLabs.
- In `callMode=companion`, Twilio media stream handling is delegated to OpenClaw `voice-call`.
- In `callMode=standalone`, `CLAWVOICE_TWILIO_STREAM_URL` must be a **public WSS endpoint** (for example `wss://voice.example.com/media-stream`) and **must not** point at `/clawvoice/webhooks/*`.

```bash
# Default path
openclaw config set clawvoice.voiceProvider deepgram-agent
openclaw config set clawvoice.deepgramVoice aura-asteria-en

# ElevenLabs path
openclaw config set clawvoice.voiceProvider elevenlabs-conversational
openclaw config set clawvoice.elevenlabsApiKey <key>
openclaw config set clawvoice.elevenlabsAgentId <agent-id>
```

### Memory Separation Model

- Voice sessions write to `voice-memory/*`.
- Main memory reads are controlled by `mainMemoryAccess` (`read` or `none`).
- Promotion to main memory is explicit and confirmation-based via `clawvoice promote` or `clawvoice.promote_memory`.

This lets your primary OpenClaw/Telegram agent keep stable long-term memory while voice calls stay isolated until you deliberately promote entries.

### Twilio Settings (default provider)

| Setting | Env Variable | Required | Description |
|---------|-------------|----------|-------------|
| `callMode` | `CLAWVOICE_CALL_MODE` | No (default `companion`) | `standalone` keeps ClawVoice Twilio media streaming; `companion` delegates live audio to OpenClaw `voice-call` |
| `twilioAccountSid` | `TWILIO_ACCOUNT_SID` | Yes | Account SID from Twilio Console (starts with `AC`) |
| `twilioAuthToken` | `TWILIO_AUTH_TOKEN` | Yes | Auth Token from Twilio Console |
| `twilioPhoneNumber` | `TWILIO_PHONE_NUMBER` | Yes | Your Twilio number in E.164 format, e.g. `+15551234567` |
| `twilioStreamUrl` | `CLAWVOICE_TWILIO_STREAM_URL` | Yes for `standalone` live media | Public WebSocket endpoint for Twilio Media Streams (must start with `wss://`) |

**Where to find Twilio credentials:**
1. Log into [console.twilio.com](https://console.twilio.com)
2. **Account SID** and **Auth Token** are on the main Console dashboard under "Account Info"
3. **Phone Number**: Go to Phone Numbers > Manage > Active Numbers

**Twilio account requirements:**
- A verified Twilio account (trial or paid)
- A purchased phone number with Voice capability enabled
- For outbound calls on trial accounts, you can only call verified numbers — upgrade to a paid account for unrestricted outbound

**Do you need to configure a webhook in Twilio?**
Yes, for inbound calls.

- In `callMode=standalone`: set Twilio Voice webhook URL to:

```
https://<your-public-host>/clawvoice/webhooks/twilio/voice
```

- In `callMode=companion`: set Twilio Voice webhook URL to your OpenClaw `voice-call` inbound endpoint, typically:

```
https://<your-public-host>/voice-call/webhooks/twilio/inbound
```

For outbound calls only, no inbound webhook configuration is needed.

**Twilio stream endpoint requirements (for `callMode=standalone` two-way live audio):**
- Must be `wss://...` (not `https://...`)
- Must be publicly reachable from Twilio (no localhost/private IP)
- Must be a WebSocket media endpoint (not `/clawvoice/webhooks/*` HTTP routes)
- If misconfigured, Twilio shows `Error 31920` (WebSocket handshake non-101)

**Do you configure any webhook URL in ElevenLabs?**
No. In ClawVoice, ElevenLabs only needs your API key and Agent ID. Telephony webhooks are handled by OpenClaw `voice-call` in companion mode, or by ClawVoice routes in standalone mode.

### Telnyx Settings (alternative)

| Setting | Env Variable | Required |
|---------|-------------|----------|
| `telnyxApiKey` | `TELNYX_API_KEY` | Yes (if Telnyx) |
| `telnyxConnectionId` | `TELNYX_CONNECTION_ID` | Yes (if Telnyx) |
| `telnyxPhoneNumber` | `TELNYX_PHONE_NUMBER` | Yes (if Telnyx) |
| `telnyxWebhookSecret` | `TELNYX_WEBHOOK_SECRET` | Recommended |

### Voice Settings — Deepgram

| Setting | Env Variable | Default | Description |
|---------|-------------|---------|-------------|
| `deepgramApiKey` | `DEEPGRAM_API_KEY` | — | Deepgram API key (Speech + Voice Agent permissions) |
| `deepgramVoice` | `CLAWVOICE_DEEPGRAM_VOICE` | `aura-asteria-en` | Default Deepgram Aura voice |

**Available Deepgram voices** (Aura series, optimized for telephony):
| Voice ID | Description |
|----------|-------------|
| `aura-asteria-en` | Female, American English (default) |
| `aura-luna-en` | Female, soft and warm |
| `aura-stella-en` | Female, conversational |
| `aura-athena-en` | Female, British English |
| `aura-hera-en` | Female, mature |
| `aura-orion-en` | Male, American English |
| `aura-arcas-en` | Male, confident |
| `aura-perseus-en` | Male, neutral |
| `aura-angus-en` | Male, Irish English |
| `aura-orpheus-en` | Male, deep |
| `aura-helios-en` | Male, British English |
| `aura-zeus-en` | Male, authoritative |

### Voice Settings — ElevenLabs

| Setting | Env Variable | Required | Description |
|---------|-------------|----------|-------------|
| `elevenlabsApiKey` | `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key (Conversational AI permission) |
| `elevenlabsAgentId` | `ELEVENLABS_AGENT_ID` | Yes | Agent ID from ElevenLabs dashboard |
| `elevenlabsVoiceId` | `ELEVENLABS_VOICE_ID` | No | Override the agent's configured voice |

**How to get your Agent ID:**
1. Go to [elevenlabs.io/app/agents](https://elevenlabs.io/app/agents)
2. Create or open an agent
3. The Agent ID appears in the URL: `elevenlabs.io/app/agents/{agent-id}`
4. It also appears in **Agent Settings** at the top of the agent configuration page

**Agent ID format:** ~20 character alphanumeric string, e.g. `J3Pbu5gP6NNKBscdCdwB`

**Recommended ElevenLabs API key permissions:**
- Conversational AI (required: agents, conversations)
- Text to Speech (optional: only if using `elevenlabsVoiceId` override)

**TTS vs Conversational AI:**
ElevenLabs has two distinct products:
- **Text to Speech (TTS)** — converts text to audio (one-way). Requires a Voice ID.
- **Conversational AI** — real-time bidirectional voice agent. Requires an Agent ID. This is what ClawVoice uses.

When you set `voiceProvider` to `elevenlabs-conversational`, ClawVoice uses the Conversational AI agent, not TTS. Your agent's voice is configured in the ElevenLabs dashboard as part of the agent setup.

**ElevenLabs Voice IDs** (for `elevenlabsVoiceId` override):

Use `elevenlabsVoiceId` to override the voice your agent uses without editing the agent in the dashboard. Some commonly-used voices:

| Voice ID | Name | Characteristics |
|----------|------|-----------------|
| `DXFkLCBUTmvXpp2QwZjA` | Eryn | Female, natural and conversational |
| `UgBBYS2sOqTuMpoF3BR0` | Mark | Male, professional and clear |
| `8fcyCHOzlKDlxh1InJSf` | Joseph | Male, warm and measured |

Browse the full voice library at [elevenlabs.io/voice-library](https://elevenlabs.io/voice-library). Any Voice ID from your ElevenLabs library works here.

> **Note:** `elevenlabsVoiceId` overrides the voice at the API level. The voice your agent is configured to use in the ElevenLabs dashboard is the default when this field is not set.

### Safety & Privacy

| Setting | Env Variable | Default | Description |
|---------|-------------|---------|-------------|
| `mainMemoryAccess` | `CLAWVOICE_MAIN_MEMORY_ACCESS` | `read` | Voice can read main memory (`read` or `none`) |
| `restrictTools` | `CLAWVOICE_RESTRICT_TOOLS` | `true` | Block dangerous tools in voice sessions |
| `deniedTools` | `CLAWVOICE_DENIED_TOOLS` | `exec,browser,...` | Tools blocked in voice sessions |
| `disclosureEnabled` | `CLAWVOICE_DISCLOSURE_ENABLED` | `true` | Speak AI disclosure at call start |
| `disclosureStatement` | `CLAWVOICE_DISCLOSURE_STATEMENT` | (default text) | Disclosure text |
| `maxCallDuration` | `CLAWVOICE_MAX_CALL_DURATION` | `1800` | Max call seconds |
| `amdEnabled` | `CLAWVOICE_AMD_ENABLED` | `true` | Answering machine detection |
| `recordCalls` | `CLAWVOICE_RECORD_CALLS` | `false` | Save recordings |

### Notifications

| Setting | Env Variable | Default | Description |
|---------|-------------|---------|-------------|
| `notifyTelegram` | `CLAWVOICE_NOTIFY_TELEGRAM` | `false` | Send post-call summaries to Telegram |
| `notifyDiscord` | `CLAWVOICE_NOTIFY_DISCORD` | `false` | Send post-call summaries to Discord |
| `notifySlack` | `CLAWVOICE_NOTIFY_SLACK` | `false` | Send post-call summaries to Slack |

## Troubleshooting

### "telephony-credentials: FAIL"

Your telephony provider credentials are missing or incomplete. Run `openclaw clawvoice status` and check which fields need to be set.

### "voice-credentials: FAIL"

Your voice provider API key is missing. Set the appropriate `deepgramApiKey` or `elevenlabsApiKey`.

### "webhook-config: WARN"

No webhook verification key configured. Webhook signature verification will reject incoming events. Set `telnyxWebhookSecret` (env: `TELNYX_WEBHOOK_SECRET`) or `twilioAuthToken`.

### Calls connect but no audio

Check that your voice provider (Deepgram/ElevenLabs) API key is valid and has sufficient credits. Run `openclaw clawvoice test` for connectivity diagnostics.

### Call immediately hangs up

Check `maxCallDuration` is set to a reasonable value (default: 1800 seconds = 30 minutes).

## Development

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript
npm test           # Run all tests
npm run clean      # Remove build artifacts
```

### Local OpenClaw Testing

```bash
npm run build
openclaw plugins install --link .
openclaw start
```
