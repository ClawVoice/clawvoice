# ClawVoice Setup Guide

Step-by-step instructions for installing and configuring ClawVoice with your OpenClaw agent.

## Prerequisites

- [OpenClaw](https://openclaw.dev) installed and running
- Node.js 20+
- A phone number from Telnyx or Twilio (self-hosted mode)
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
npm test  # 169 tests should pass
openclaw plugins install --link .
```

## Configuration Modes

### Self-Hosted (bring your own keys)

You provide API keys for telephony and voice providers. Full control, no recurring costs beyond provider usage.

### Managed (one-command setup)

```bash
openclaw clawvoice setup --token YOUR_SERVICE_TOKEN
```

Pre-provisioned phone number, Deepgram Voice Agent included, no public endpoint needed.

## Self-Hosted Setup

### Step 1: Choose a Telephony Provider

| Provider | Pros | Setup |
|----------|------|-------|
| **Telnyx** (recommended) | Lower cost, better international | [telnyx.com](https://telnyx.com) |
| **Twilio** | Wider ecosystem, more docs | [twilio.com](https://twilio.com) |

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
export CLAWVOICE_TELNYX_API_KEY=tk_your_api_key
export CLAWVOICE_TELNYX_CONNECTION_ID=your_connection_id
export CLAWVOICE_TELNYX_PHONE_NUMBER=+15551234567
export CLAWVOICE_DEEPGRAM_API_KEY=your_deepgram_key
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
| `mode` | `CLAWVOICE_MODE` | `self-hosted` | `self-hosted` or `managed` |
| `telephonyProvider` | `CLAWVOICE_TELEPHONY_PROVIDER` | `telnyx` | `telnyx` or `twilio` |
| `voiceProvider` | `CLAWVOICE_VOICE_PROVIDER` | `deepgram-agent` | `deepgram-agent` or `elevenlabs-conversational` |

### Telnyx Settings

| Setting | Env Variable | Required |
|---------|-------------|----------|
| `telnyxApiKey` | `CLAWVOICE_TELNYX_API_KEY` | Yes (if Telnyx) |
| `telnyxConnectionId` | `CLAWVOICE_TELNYX_CONNECTION_ID` | Yes (if Telnyx) |
| `telnyxPhoneNumber` | `CLAWVOICE_TELNYX_PHONE_NUMBER` | Yes (if Telnyx) |
| `telnyxWebhookSecret` | `CLAWVOICE_TELNYX_WEBHOOK_SECRET` | Recommended |

### Twilio Settings

| Setting | Env Variable | Required |
|---------|-------------|----------|
| `twilioAccountSid` | `CLAWVOICE_TWILIO_ACCOUNT_SID` | Yes (if Twilio) |
| `twilioAuthToken` | `CLAWVOICE_TWILIO_AUTH_TOKEN` | Yes (if Twilio) |
| `twilioPhoneNumber` | `CLAWVOICE_TWILIO_PHONE_NUMBER` | Yes (if Twilio) |

### Voice Settings

| Setting | Env Variable | Default | Description |
|---------|-------------|---------|-------------|
| `deepgramApiKey` | `CLAWVOICE_DEEPGRAM_API_KEY` | — | Deepgram API key |
| `deepgramVoice` | `CLAWVOICE_DEEPGRAM_VOICE` | `aura-asteria-en` | Default voice |
| `elevenlabsApiKey` | `CLAWVOICE_ELEVENLABS_API_KEY` | — | ElevenLabs API key |
| `elevenlabsAgentId` | `CLAWVOICE_ELEVENLABS_AGENT_ID` | — | Conversational AI agent |
| `elevenlabsVoiceId` | `CLAWVOICE_ELEVENLABS_VOICE_ID` | — | Voice to use |

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
npm test           # Run all 169 tests
npm run clean      # Remove build artifacts
```

### Local OpenClaw Testing

```bash
npm run build
openclaw plugins install --link .
openclaw start
```
