# Draft: Epic 1 Review + Epic 2 Planning

## Epic 1 Code Review Results (Stories 1.2, 1.3, 1.4)

### Verification
- **Tests**: 41/41 passing
- **Build**: TSC clean
- **LSP**: No diagnostics on any modified TS files

### Issues Found (5 total)

#### REQUIRED (fix before Epic 2)
1. **Info leak in webhook responses** — `src/routes.ts:9,14` returns `mode: config.mode`. Should be `{ ok: true }` only.
2. **Duplicate `normalizeE164`** — Identical function in `src/telephony/twilio.ts` and `src/telephony/telnyx.ts`. Extract to shared `src/telephony/normalize.ts`.
3. **Incomplete test fixture** — `tests/tools.test.cjs` `validConfig()` missing `disclosureEnabled` and `disclosureStatement` fields added in Story 1.4.

#### IMPORTANT (fix early in Epic 2)
4. **`parseInt` vs `parseFloat`** — `src/config.ts:93` uses `Number.parseInt` for `maxCallDuration`. Should use `parseFloat` since duration can be fractional seconds.

#### MINOR (track for later)
5. **No `from` phone validation** — `src/services/voice-call.ts:96` passes potentially `undefined` from-number to adapter without validation.

### Decision
- Stories 1.2, 1.3, 1.4 → **DONE** with issues noted above
- Required fixes become Task 0 in Epic 2 plan

## Epic 1 Retrospective

### What Went Well
- Clean modular architecture: separate files per concern (tools, cli, routes, hooks, services)
- 3-tier config resolution pattern is solid and well-tested
- Telephony abstraction with adapter pattern enables easy provider swapping
- Disclosure + auto-termination guardrails implemented cleanly
- All stories have BMAD artifacts with proper status tracking

### What to Improve
- Test fixtures diverged from implementation (Story 1.4 fields not added to all fixtures)
- Duplicate utility code crept in (normalizeE164)
- Webhook response leaked internal state
- No integration test verifying end-to-end flow yet

### Key Patterns Established
- Plugin SDK registration pattern: `api.{tools,cli,hooks,http}.register()`
- Config resolution: env > plugin > defaults via `getValue()`
- Service lifecycle: constructor config injection, start/stop methods
- Telephony adapter: interface + provider-specific implementations

## Epic 2 Requirements (from epics.md)

### Epic 2: Conduct Reliable Real-Time Voice Task Execution
FRs: FR5, FR6, FR7, FR8, FR9, FR30, FR31, FR32

### Stories
- 2.1: Real-Time Voice Bridge and First-Speech Connect (FR6, FR7, FR8)
- 2.2: In-Call Tooling and Turn-Taking (FR9, FR6)
- 2.3: Disconnection Detection and Graceful Recovery (FR5)
- 2.4: Graceful Incompletion and Retry Loop (FR30, FR31, FR32)

### Key Technical Decisions
- Must reuse existing WebSocket/telephony code from `reference-code/`
- WebSocket bridge pattern: telephony WS ↔ voice provider WS
- Audio buffering from reference: 160-byte Twilio chunks → 3200-byte Deepgram buffer
- Call state machine needed for lifecycle coordination
- Codec negotiation at connection time (FR8)

## Open Questions
- None — user said use recommended defaults and move fast
