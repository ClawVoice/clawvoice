# ClawVoice

Repository guidance for AI coding sessions.

<!-- REVIEW-ROUTING:START (synced to every repo — edit HERE, then run scripts/stamp-shared-blocks.sh) -->
## Code Review Process (synced — do not edit in this repo)

Canonical copy: `~/claude/AGENTS.md` § REVIEW ROUTING. Edit there, re-stamp everywhere.

**Every PR, no exceptions — these are free and are the floor:**
1. `/code-review` locally on the diff, as many passes as needed.
2. `/codex:review` locally, ONCE, on the final diff, immediately before pushing.
3. `@codex review` as a PR comment once the PR is open.

Nothing merges on fewer than those three. Local review DISCOVERS; the bots CONFIRM.

**Paid reviewers are summoned by category, not by default.** Both are metered, so
summoning them on everything delivers fewer, later reviews — not more:

| Summon | When | Limit that bites |
|---|---|---|
| `@coderabbitai review` | money, payroll/time-tracking, auth, secrets, DB migrations | ~8/day account-wide; throttles to 1/hour past 60 reviews in 7 days |
| `@macroscope-app review` | same tier, plus iOS/Swift | bills per KB of diff against a $150/mo workspace cap |

**Macroscope hard rules.** Never summon it on a PR over ~2,000 changed lines — a
manual summon bypasses the per-review cap, so a 22k-line PR costs ~$48 in one
review. Split first. And a Macroscope check with `conclusion: skipped` means the
review NEVER RAN (out of credit / over budget) — it looks green and does not block
merge, but it is not a pass. Say so in the merge report; never count it silently.

**FINISH THE PR BEFORE OPENING THE NEXT ONE (measured 2026-08-21).** Across 8 days,
**47% of PRs had fix/follow-up-shaped titles** and there were **78 cases of the same
file being re-edited within 48h of a merge** — e.g. codymclain.com #211 → #233, 21h
apart, touching the same six Swift files. That is one piece of work split by TIME, not
by CONCERN, and it doubles the review surface for a single change.

So, before opening a new PR that touches files a PR of yours merged in the last 48h:
  * If the earlier PR is **still open** → amend it. Push to the same branch; CodeRabbit
    re-reviews incrementally and it costs no extra summon.
  * If it is **already merged** and this is a defect in that same work → the follow-up
    PR is correct, but say so in its body (`follow-up to #N — <what the review missed>`)
    and treat it as evidence the local review is under-performing on that subsystem:
    escalate one extra reviewer per the rule below.
  * If it is **already merged** and this is genuinely NEW work → normal PR, no linkage.
Never open a second PR merely because the session moved on, the branch got messy, or a
review round felt "done". PR count is not the metric; rework is.

**Escalate ONE extra reviewer** (beyond what the category requires) when: the local
Claude and Codex passes disagree; a bot already found a genuine bug; you are
rebutting a finding rather than fixing it; the change touches a subsystem this
session has not read end-to-end; or the diff exceeded 400 lines and could not be
split. Say in the PR why you escalated.

**Do NOT use** CharlieHelps or cubic — both retired. If CharlieHelps comments on
its own, treat its findings like any other review, but never request one.

**Merge gate:** every substantive finding fixed or rebutted with evidence, all
review threads resolved, CI green. Then merge autonomously — never ask.
<!-- REVIEW-ROUTING:END -->

<!-- SESSION-WRAPUP:START (synced to every repo — edit in ~/claude/AGENTS.md, then re-stamp) -->
## Ending a Session — Required Format (synced; applies to cloud sessions too)

When you stop at a clean point, hand off, or run low on context, the LAST message
MUST have these four parts, in this order, in plain English. A status dump without
them is not a wrap-up — Cody has lost the context by then, so assume zero memory.

**1. Did we solve it?** One line, first line, no hedging:
   `Original goal: <the request, quoted from when it was made>`
   `Status: SOLVED / PARTLY SOLVED / NOT SOLVED — <one clause why>`
   Never open with the current technical state; open with the verdict.

**2. What we did.** 3–6 plain sentences a non-developer can follow: what changed,
   what it means for the product, what is now live vs still only on a branch.
   No jargon without an immediate gloss. No logs, no diffs, no file dumps.

**3. Should you close this session?** Say it outright — "I'd close this" or
   "worth keeping open because X". Recommend closing whenever the original goal
   is met, even if unrelated follow-ups exist; those become issues, not reasons
   to keep a session alive. Sessions older than 24h must justify staying open.

**4. Options if you want to keep going.** A SHORT NUMBERED LIST (2–4 items) of
   concrete next steps Cody can pick from, each one line, each starting with a
   verb, ordered most-valuable first, with the cost/risk named where it matters:
   ```
   If you want to keep going:
     1. Verify and push the round-4 fixes on #819 (needs full suite + build, ~15 min)
     2. Fix the silent-rejection blind spot — some creators currently see nothing
     3. Close the three open findings on #820 (email confirmation, cleared emails, paused affiliates)
   ```
   These are OPTIONS, not a to-do list dumped on him, and not a request for
   permission to do obvious work. If something is safe, in scope, and clearly
   wanted, DO IT instead of listing it (see the autonomy directives). List only
   genuine forks in the road: things needing his judgment, his credentials, real
   spend, or work big enough to deserve its own session.

Anything not offered as an option and not done gets FILED as an `ai-found` issue
before the session ends. Never leave findings living only in chat scrollback.
<!-- SESSION-WRAPUP:END -->
