# ClawVoice Codebase Audit — 2026-07-19

Full audit of the ClawVoice plugin covering onboarding/install, the Telnyx and Twilio
telephony paths, the media transport layer, the voice-provider bridges (Deepgram,
ElevenLabs), and the core plugin services. Every finding below was verified against
the actual source (and provider docs where protocol behavior mattered) — none are
speculative.

**Headline:** the project currently has **no automated self-serve install path**, the
**Telnyx calling and inbound paths are non-functional** (four independent bugs;
outbound SMS is the one working Telnyx capability), **Deepgram calls are silent**, **ElevenLabs tool-calling is broken at both ends of the pipe**, the G.711 μ-law
decoder is mathematically wrong (dormant today, a landmine for any future consumer),
and two unhandled-error paths let any internet client **crash the whole process**.

---

## 1. Onboarding / install flow (why "you need Claude to install it")

### 1.1 CRITICAL — No automated self-serve install path
`README.md:97-135`, `src/index.ts:655-660`, `skills/clawvoice/SKILL.md`

Every documented route dead-ends:
- `openclaw plugins install clawvoice` is blocked by OpenClaw's own security scanner
  (admitted in README.md:135 and 510).
- The fallback `openclaw skills install clawvoice` installs only the SKILL.md prompt
  file — no plugin, no CLI. `openclaw clawvoice setup` (README step 3) is an unknown
  command at that point (README.md:511 admits this).
- Bridging skill → plugin requires hand-writing a JSON5 `plugins.load.paths` block
  into `~/.openclaw/openclaw.json`, running `npm install` inside the skill directory,
  and restarting the gateway. No command, script, or postinstall automates any of it.

A careful human can complete these manual steps by hand, but nothing automates them —
the only guided path is an AI agent following SKILL.md, which is why in practice
"you have to use Claude to install it."

### 1.2 HIGH — SKILL.md/README write config to a namespace the plugin never reads
`skills/clawvoice/SKILL.md:60-65,99-103,151-156` vs `src/index.ts:465-471` and `src/cli.ts:127-139`

The plugin reads `api.pluginConfig ?? plugins.entries.clawvoice.config ?? top-level`;
its own wizard writes `plugins.entries.clawvoice.config`; SKILL.md and README.md:359
instead instruct `openclaw config set clawvoice.*` — a third location that resolves to
a top-level `clawvoice:{}` object `resolveConfig` never looks at. The Claude-guided
setup silently produces a dead config.

### 1.3 HIGH — `clawvoice test` performs zero network I/O despite README claims
`README.md:338-344` vs `src/diagnostics/health.ts`

README says it "checks that your tunnel is reachable, provider credentials are valid,
and the voice pipeline can connect." Every check in health.ts is a static
string/shape check on config values (the only subprocess is a local `tailscale
status`). A dead tunnel or revoked API key still prints "Connectivity test PASSED";
the user's first paid call is the actual test.

### 1.4 HIGH — Setup wizard crashes with `ERR_REQUIRE_ESM` on Node 20.0–20.18 and 22.0–22.11
`src/cli.ts:462` → `dist/cli.js:460`; `package.json` (no `engines`)

`@clack/prompts@1.1.0` is ESM-only; `tsc` (module: CommonJS) compiled the dynamic
import into `require("@clack/prompts")`, which throws on any Node without
require(esm). No `engines` field warns users. The readline-based `runSetupWizard`
(`src/cli.ts:148`) would work everywhere but is dead code — the registered command
(`src/cli.ts:871-877`) only ever calls the clack wizard.

### 1.5 HIGH — Setup is TTY-interactive only; the agent the install flow forces you to use can't drive it
`src/cli.ts:871-877`

`clawvoice setup` ignores its args; every value comes from clack TTY prompts.
README.md:410 tells agents to exec it — an exec'd wizard has no TTY and hangs on the
first prompt. Humans can't reach the wizard without hand-editing config; agents can't
answer its prompts.

### 1.6 MEDIUM/HIGH — Fresh standalone/tunnel installs silently lose all webhooks
`src/services/clawvoice.ts:240-244`, `src/index.ts:631`

`startStandaloneTransport` throws when `twilioStreamUrl` or voice credentials are
missing; `start()` rethrows and `initPlugin` merely logs it, so the standalone
port-3101 server (which `routes.ts:417` calls "the primary webhook handler") never
starts. Scope: `initPlugin` continues and still registers the same routes through the
host gateway (`src/index.ts:662-679`), so deployments whose provider webhooks point at
an OpenClaw-dispatched HTTP route keep working — but in the documented standalone/
tunnel setup, where Twilio/Telnyx point at port 3101, inbound SMS and voice are
completely dead on a fresh install — including SMS, which needs no stream URL. The default `voiceProvider` is `elevenlabs-conversational`
— the highest-friction option (requires a pre-created ElevenLabs agent + key), and
without both, this failure triggers.

### 1.7 MEDIUM — Wizard's Tailscale branch configures an unreachable URL
`src/cli.ts:554-567,573-597`

The interactive wizard offers a detected Tailscale WSS URL but never enables Funnel
nor sets `tailscaleMode` (the dead readline wizard at cli.ts:195-210 does this
correctly). Diagnostics then pass (tailscale check skipped because mode is `off`) and
Twilio calls fail silently.

### 1.8 MEDIUM — Plugin init errors are swallowed; misconfigured installs load as a silent no-op
`openclaw-extension.mjs:6-17`

`invokeLifecycle` catches everything (including `validateConfig` throws from
`src/index.ts:474`) and only console.errors. The plugin appears loaded but registers
no tools, routes, or CLI. First symptom: "the clawvoice tools don't exist."

### 1.9 MEDIUM — Twilio webhook auto-config reports success without checking the response
`src/cli.ts:336-352,731-747`

The `IncomingPhoneNumbers/<sid>.json` POST result is never inspected; on 4xx the
wizard still prints "✓ Twilio webhooks configured automatically!" and the user skips
manual setup, leaving inbound calls broken.

### 1.10 MEDIUM — Config-save fallback destroys comments and fails on real JSON5
`src/cli.ts:16-48,127-139,671`

`parseJsonTolerant` handles only `//`, `/* */`, and trailing commas — single-quoted
strings or unquoted keys make the save throw *after* the user answered every prompt.
On success, `JSON.stringify` deletes all comments (which the README's own snippet
encourages).

### 1.11 MEDIUM — Wizard cancel paths call `process.exit(0)` from plugin code
`src/cli.ts:487,491,511,581,594-595,615-616,629,661,712,791`

If the host runs plugin CLI commands in the gateway process (the `registerCli` bridge
at `src/index.ts:55-121` makes this plausible), pressing Esc during setup kills the
entire OpenClaw process.

### 1.12 MEDIUM — Bundled dependencies silently omitted, breaking no-npm distribution channels
`package.json:31-34,45-48`

`bundleDependencies` is declared (under both spellings), but `npm pack`/`publish`
with no `node_modules` present silently produces a tarball with no bundled copies of
`ws` or `@clack/prompts`. Scope: both packages are also regular `dependencies`, so a
normal `npm install` of the published tarball still resolves them — npm consumers are
fine. The failure hits distribution channels that deliver the raw tarball without
running npm: the ClawHub skill download ships exactly this artifact (README.md:105-106),
where the media server and wizard can't load until the user manually runs
`npm install` — the extra step the install docs have to compensate for. CI publishes
are safe (`npm ci` first); the fix is verifying bundle contents at pack time or
having the ClawHub channel run an install step.

### 1.13 MEDIUM — SKILL.md instructs running a nonexistent command
`skills/clawvoice/SKILL.md:35`

`clawvoice diagnostics` is not a registered command (see `src/cli.ts:871-1227`). An
agent following the "URL Configuration — CRITICAL" checklist errors at the exact
verification step.

### 1.14 LOW — Version/metadata drift
- `openclaw.plugin.json:5` says `1.1.2`; `package.json` says `1.1.3`.
- Manifest default `mediaStreamBind: "0.0.0.0"` contradicts the code default
  `127.0.0.1` (`src/config.ts:79`).
- README contains five raw 0x97 (Windows-1252 em dash) bytes — invalid UTF-8
  rendering as `�` in the install/troubleshooting sections (lines 105, 135, 510, 511, 578).
- `.env.example` documents `CLAWVOICE_CALL_MODE` and `CLAWVOICE_WEBHOOK_URL`, which
  no code reads; the env vars the code *does* need (`OPENCLAW_WORKSPACE`,
  `OPENCLAW_CONFIG_PATH`) are documented nowhere.
- `src/cli.ts:680`: `maskSecret(String(...))` prints an unset Deepgram key as
  `unde...` instead of "(not set)".

---

## 2. Telnyx path (calling and inbound are non-functional — four stacked bugs)

Scope note: outbound Telnyx SMS does *not* traverse the broken
call-control/webhook/media path — `ClawVoiceService.sendText` →
`TelnyxTelephonyAdapter.sendSms` posts directly to `/v2/messages` with only the API
key and phone number (`src/services/clawvoice.ts:586-624`, `src/telephony/telnyx.ts:73-106`)
and works. Everything else on Telnyx is broken:

### 2.1 CRITICAL — Signature verified as hex; Telnyx sends base64
`src/webhooks/verify.ts:39`

`Buffer.from(signatureHeader, "hex")` — the `telnyx-signature-ed25519` header is
base64. Every legitimate Telnyx webhook fails verification → 401.

### 2.2 CRITICAL — Signature verified over a re-serialized body, not the raw bytes
`src/routes.ts:94`; raw body available but discarded at `src/index.ts:214`

`JSON.stringify(request.body ?? "")` is fed to Ed25519 verification, which must run
over the exact raw payload. Any whitespace/key-order/escaping difference → mismatch.
(Also `JSON.stringify("")` yields `"\"\""`, not an empty string.) Even after fixing
2.1, this keeps webhooks rejected.

### 2.3 CRITICAL — Outbound Telnyx calls dial into dead air
`src/telephony/telnyx.ts:42-56`

`startCall` sends only `connection_id`/`to`/`from`/AMD. There is no `stream_url`, no
`/actions/streaming_start`, and no `/actions/answer` anywhere in the codebase (grep
verified) — all media-streaming plumbing is Twilio-only (`CLAWVOICE_TWILIO_STREAM_URL`
/ TwiML `<Stream>`). A Telnyx call connects with no audio path at all.

### 2.4 HIGH — Telnyx webhook payloads parsed at the wrong nesting level
`src/routes.ts:470-472,498,516-518`

- `parseTelnyxSmsBody` checks `root.event_type`; Telnyx v2 nests it at
  `data.event_type` (the repo's own `tests/webhooks.test.cjs:64` uses the correct
  shape; `tests/routes.test.cjs:228` was written to match the bug). Real inbound SMS
  falls through and is dropped.
- Telnyx's `payload.to` is an *array* of `{phone_number}` objects, so `to` resolves
  to `""` even after fixing the nesting.
- `parseWebhookBody` looks for `call_control_id` at the root; Telnyx nests it at
  `data.payload.call_control_id`. `call.initiated` webhooks → null → no inbound
  record, no owner notification.

---

## 3. Voice-provider bridges

### 3.1 CRITICAL — Deepgram agent audio is silently discarded (calls are silent)
`src/transport/deepgram-bridge.ts:122-147`

Every WebSocket frame — including binary TTS audio — is UTF-8-decoded and
`JSON.parse`d; there is no binary path and `onMessage` only accepts parsed JSON.
The agent's speech never reaches the phone call.

### 3.2 HIGH — ElevenLabs tool calls arrive empty
`src/transport/elevenlabs-bridge.ts:237-239`

ElevenLabs sends `{ client_tool_call: { tool_call_id, tool_name, parameters } }`; the
code detects via `raw.client_tool_call` but reads the three fields from the top level
— always undefined. Every tool call is emitted as `{ function_name: "",
function_call_id: "", input: {} }`.

### 3.3 HIGH — All non-audio bridge actions are dropped, so tool calls are never executed or answered
`src/transport/media-session-handler.ts:346-348`

`onMessage` early-returns unless `action.action === "audio"`. `function_call` actions
from `bridge.handleVoiceAgentMessage` (its only live caller) are discarded;
`completeFunctionCall` / `client_tool_result` are unreachable. Mid-call tool use
stalls the conversation.

### 3.4 MEDIUM — Barge-in never sends Twilio `clear`; the agent talks over interrupting callers
`src/transport/media-session-handler.ts:346-357`

The same `!== "audio"` return discards `barge_in`. Twilio buffers outbound media and
requires `{ event: "clear", streamSid }` to flush it.

### 3.5 MEDIUM — Agent output format never requested; code hard-assumes PCM 16 kHz
`src/transport/elevenlabs-bridge.ts:78-99`, `src/transport/audio-convert.ts:6-7,166`

The init override sets only the STT input format; the agent's dashboard-configured
TTS output format applies, while `normalizeMessage` unconditionally resamples
16000→8000 (and audio-convert's own header claims 44.1 kHz). With a `pcm_44100` agent
(a common default), callers hear slowed/garbled audio. Also: the STT
`conversation_config_override` may be rejected outright unless whitelisted in the
agent config — the code's own comment (lines 88-90) notes overrides are locked there.

---

## 4. Media transport / audio

### 4.1 HIGH — Any internet client can crash the whole process (two vectors)
`src/transport/media-stream-server.ts:99-122` and `:69-71,200-209`

- Accepted WebSockets get no `error` listener; a single malformed frame (invalid
  UTF-8, bad RSV bits, ECONNRESET) on this internet-exposed port raises an unhandled
  EventEmitter error and kills the process — dropping every active call.
- The async HTTP handler's `for await (const chunk of req)` body read is outside the
  try/catch; a client aborting mid-POST produces an unhandled rejection →
  process exit (Node 15+ default).

### 4.2 MEDIUM — G.711 mulaw decode table is mathematically wrong (currently dormant)
`src/transport/audio-convert.ts:27`

`((mantissa << 1) | 1) << (exponent + 2)` omits the implicit leading bit (correct:
`((mantissa << 3) + 0x84) << exponent` minus bias). Verified: `0x00` → −15740
instead of −32124; `0xFF` → −128 instead of 0 (small codes flip sign). Scope: no live
call path currently invokes the decoder — `mulawToPcm16` is reachable only through
`twilioToElevenLabs`, which nothing outside `audio-convert.ts` calls; the live
ElevenLabs path forwards raw μ-law inbound and uses only `elevenLabsToTwilio` (the
encode direction, whose table is correct). This is a landmine for any future consumer
of the decode path (e.g. a provider needing linear PCM input), not a current
caller-audio corruption bug — fix or delete it before wiring anything to it.

### 4.3 MEDIUM — Silence timeout can never fire
`src/transport/media-session-handler.ts:438-446`

Twilio sends ~50 media frames/sec continuously (silence included); every frame
re-arms the 30 s timer, so the advertised "hang up on no interaction" behavior never
triggers on a live call. The substitute teardown closure also skips
`bridge.reportDisconnection`, unlike the primary path.

### 4.4 MEDIUM — Caller audio during provider connect is dropped
`src/transport/media-session-handler.ts:326-371,425-428`

`media` events arriving while `handleStart` awaits `voiceProviderClient.connect()`
(up to 10 s) find no session entry and are discarded — the caller's opening words are
lost before STT sees them.

### 4.5 MEDIUM — WebSocket auth is not enforced at upgrade; idle sockets exhaust the pool
`src/transport/media-stream-server.ts:31-34,78-97`; `media-session-handler.ts:198-201`

The documented `?token=`/Authorization check is not performed at upgrade (the header
form is checked nowhere); the query token is only validated inside the `start` event.
Twenty tokenless idle sockets (default `maxConnections`) → 503 for every real Twilio
stream → all calls have dead audio.

### 4.6 MEDIUM — `localCloses` leaks on provider-initiated disconnects
`src/transport/media-session-handler.ts:77,155,358-361`

When the provider WS closes first, the socket is added to `localCloses` but the entry
is never removed (closing an already-closed socket emits no second `close`).
Unbounded growth; risks mis-suppressing teardown for a reused socket object.

### 4.7 LOW — Assorted transport issues
- `media-stream-server.ts:130-148`: `stop()` hangs until every active media stream
  ends on its own — no client termination or timeout.
- `twilio.ts:57-62`: recording callback URL derivation is a no-op for any stream path
  other than `.../media-stream` or for `ws://` URLs; recordings silently never ingest.
- `media-session-handler.ts:198-199`: media auth token compared with `!==` instead of
  `timingSafeEqual` (webhooks use the timing-safe form).
- `twilio.ts:50,71`: `<Parameter name="callSid" value="{CallSid}"/>` — TwiML has no
  template expansion; the literal `{CallSid}` string arrives in `customParameters`
  (currently inert; handler reads protocol-level `start.callSid`).
- `telephony/util.ts:2-9`: `normalizeE164` rejects valid short E.164 numbers
  (`digits.length < 10`), blocking legitimate international destinations.

Verified clean: Twilio signature verification (algorithm, timing-safe compare, port
variants match the official SDK), `track="inbound_track"` on `<Connect><Stream>`,
the mulaw *encode* table, and TwiML attribute escaping.

---

## 5. Core plugin / services

### 5.1 HIGH — Call summaries lost on the normal completion path
`src/services/clawvoice.ts:158-175,581-584,779`

`onCallCompleted` forwards the summary to `postCall` but never assigns
`call.summary`; only the manual/auto-hangup path (`completeCall`) sets it. When the
callee hangs up (the common case), `clawvoice_batch_call` reports outcome
"unknown"/duration 0 for every successful call and `clawvoice_status <callId>` falls
back to "No active calls."

### 5.2 HIGH — Memory extraction is entirely dead code
`src/services/memory-extraction.ts:70,139-144`; `src/index.ts:511`

`extractFromTranscript` is never called anywhere, and `setMemoryWriter` is wired only
to `postCall`, never to `memoryService`. Despite `autoExtractMemories: true` by
default, no candidates are ever created — `clawvoice_promote_memory` always returns
"Memory candidate not found," and even a hypothetical candidate would fail with "No
memory writer configured."

### 5.3 MEDIUM — Telegram notifications silently dropped on special characters
`src/services/post-call.ts:234-290`; `src/index.ts:585-597,626`

Messages use `parse_mode: "HTML"` but interpolate unescaped caller names, reasons,
and transcript text. Any transcript containing `<`, `>`, or `&` ("it costs <$50") →
Telegram 400 "can't parse entities" → swallowed by the best-effort catch; the owner
never gets the summary.

### 5.4 MEDIUM — Prompt-injection guard blocks legitimate responses (and is caller-triggerable)
`src/hooks.ts:20-29,111-128`

`before_response` blocks outgoing text matching patterns like `/system\s*:\s*/i` or
`/pretend\s+(you\s+are|to\s+be|that)/i`. The agent saying "the system: is back
online" or quoting a caller's injection-shaped phrase gets its entire response
blocked mid-call — a caller-drivable denial of service on the conversation.

### 5.5 MEDIUM — Webhook rate limiter degrades to a single shared bucket
`src/routes.ts:44-55`

Keyed on `socket.remoteAddress`; behind the documented tunnels (ngrok/Cloudflare/
Tailscale) all traffic shares one address (or the literal `"unknown"` bucket via the
legacy router shim). An attacker POSTing garbage to the pre-auth webhook endpoints
exhausts the 100/min bucket and 429s genuine Twilio callbacks, dropping live-call
events.

### 5.6 LOW — Assorted service issues
- `clawvoice.ts:473`: `clawvoice_hangup` with no callId hangs up the *oldest* call
  (Map insertion order), while the tool docs promise "most recent."
- `clawvoice.ts:341`: daily call limit resets at UTC midnight, ignoring
  `notificationTimezone`.
- `config.ts:133-137`: `deniedTools: []` silently restores the full default deny list.
- `tools.ts:461`: campaign report "Phone" column is blank for every outbound call.
- `clawvoice.ts:400-417`: `pendingCallContext` entry leaks (until TTL) when
  `startCall` throws.

---

## 6. Highest-leverage fixes (suggested order)

1. **Ship a real installer**: resolve the scanner false-positive or add a command
   that writes the `plugins.load.paths` block and runs `npm install` itself; declare
   `engines.node >= 20.19`; wire the readline wizard in as a non-TTY fallback and add
   a flag-driven `setup --telephony=... --provider=...` mode.
2. **Unify config on one location** and make SKILL.md/README write exactly that;
   remove/rename `clawvoice diagnostics` references.
3. **Fix the process-crash vectors** (WS `error` handler; wrap the HTTP body read) —
   these are internet-triggerable.
4. **Fix Telnyx end-to-end** (base64 signature, raw-body verification, nested webhook
   parsing, and either add `stream_url` + answer/streaming_start or clearly mark
   Telnyx unsupported).
5. **Fix the audio pipeline**: mulaw decode table, Deepgram binary frames, ElevenLabs
   tool-call nesting + output-format override, non-audio action handling
   (function calls, barge-in `clear`).
6. **Fix first-run behavior**: let the standalone server start without voice creds
   (SMS shouldn't need a stream URL), surface init/validation errors to the user, and
   make `clawvoice test` actually test connectivity.
7. Store `call.summary` on natural completion; wire up or remove memory extraction;
   escape Telegram HTML.
