

<!-- PLAIN-REPORTING:START (synced from ~/claude/AGENTS.md — edit there, re-stamp everywhere) -->
## Reporting to Cody (MANDATORY — applies to cloud sessions too)

Cody is not a developer. All recaps and summaries must follow these rules:

1. **Plain language.** Explain like to a smart non-technical business owner.
   Any jargon gets an immediate plain-English gloss. Lead with what it means
   for the product, not the mechanism.
2. **Restate the original goal** at the top of every recap in a long or cloud
   session: "Original goal: … Status: done / not done." Assume Cody has zero
   memory of the session's start.
3. **Leftover findings: fix or file, never dump.** Cody's answer to "want me
   to fix it?" is always yes. Safe + in scope → fix it now. Risky or out of
   scope → `gh issue create` with all technical detail, then tell Cody only:
   "Filed side problem as issue #N (one plain sentence). Doesn't block
   anything." NEVER end with a technical to-do list on Cody's plate.
4. **Never hand Cody terminal commands** unless truly impossible for you
   (interactive TTY, his-only credentials). If unavoidable: exact command,
   one plain sentence on what it does, one on what skipping it means.
5. **Decide, don't quiz.** No technical multiple-choice questions. Pick the
   safest standard option, state it in one plain sentence, proceed. Only ask
   about: spending money, deleting real data, outward-facing publishing.
6. **Recommend closing the session** once the original goal is done: say it's
   finished, list what shipped in plain terms + issues filed, and state the
   session is safe to close.
<!-- PLAIN-REPORTING:END -->
