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
openclaw plugins install @clawvoice/voice-assistant
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

### Step 3: Choose a Voice Provider

| Provider | Latency | Quality | Cost |
|----------|---------|---------|------|
| **Deepgram Voice Agent** (recommended) | ~200ms | Good | Lower |
| **ElevenLabs Conversational AI** | ~400ms | Premium | Higher |

### Step 4: Get Voice Credentials

**Deepgram:**
1. Create account at [deepgram.com](https://deepgram.com)
2. Get API Key from Dashboard > API Keys

**ElevenLabs:**
1. Create account at [elevenlabs.io](https://elevenlabs.io)
2. Get API Key from Profile Settings
3. Create a Conversational AI agent in their dashboard
4. Note the Agent ID

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
- Promotion to main memory is explicit and confirmation-based via `clawvoice promote` or `voice_assistant.promote_memory`.

This lets your primary OpenClaw/Telegram agent keep stable long-term memory while voice calls stay isolated until you deliberately promote entries.

### Twilio Settings (default provider)

| Setting | Env Variable | Required |
|---------|-------------|----------|
| `twilioAccountSid` | `TWILIO_ACCOUNT_SID` | Yes (if Twilio) |
| `twilioAuthToken` | `TWILIO_AUTH_TOKEN` | Yes (if Twilio) |
| `twilioPhoneNumber` | `TWILIO_PHONE_NUMBER` | Yes (if Twilio) |

### Telnyx Settings (alternative)

| Setting | Env Variable | Required |
|---------|-------------|----------|
| `telnyxApiKey` | `TELNYX_API_KEY` | Yes (if Telnyx) |
| `telnyxConnectionId` | `TELNYX_CONNECTION_ID` | Yes (if Telnyx) |
| `telnyxPhoneNumber` | `TELNYX_PHONE_NUMBER` | Yes (if Telnyx) |
| `telnyxWebhookSecret` | `TELNYX_WEBHOOK_SECRET` | Recommended |

### Voice Settings

| Setting | Env Variable | Default | Description |
|---------|-------------|---------|-------------|
| `deepgramApiKey` | `DEEPGRAM_API_KEY` | — | Deepgram API key |
| `deepgramVoice` | `CLAWVOICE_DEEPGRAM_VOICE` | `aura-asteria-en` | Default voice |
| `elevenlabsApiKey` | `ELEVENLABS_API_KEY` | — | ElevenLabs API key |
| `elevenlabsAgentId` | `ELEVENLABS_AGENT_ID` | — | Conversational AI agent |
| `elevenlabsVoiceId` | `ELEVENLABS_VOICE_ID` | — | Voice to use |

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

No webhook secret configured. Webhook signature verification will reject all incoming events. Set `telnyxWebhookSecret` or `twilioAuthToken`.

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
