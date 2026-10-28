# Reference

Documents this project reads from and reasons against, most of them copied verbatim from other projects; this file names where each came from and why it is kept.
In `brief-2026-08-20.md`'s terms, every document here is carried except the beads README, which is argued with, the Tasktron script, which is drawn on, and the two earlier briefs, which are superseded.

- `OW-59.md` — agentpane's work item under `docs/work/`, deciding whether to build a tracking tool at all.
  Carried: it is the deciding item on the agentpane side, and the brief cites the observations it records.
- `agentpane-agents.md` — agentpane's `AGENTS.md`.
  Carried: it is the landing and evidence rules of the workflow this tool brings into corporate repositories.
- `author-skill.md` — agentpane's `author/SKILL.md` under `.claude/skills/`.
  Carried: the authoring half of the workflow that `payload/*.md` descends from.
- `execute-skill.md` — agentpane's `execute/SKILL.md` under `.claude/skills/`.
  Carried: the execution half of the workflow that `payload/*.md` descends from.
- `tracking.md` — agentpane's `docs/TRACKING.md`.
  Carried: the format specification the brief cites by section, and the specification of the id generator in `src/id.ts`.
- `beads-rust-readme.md` — the README of `br`, the Rust port of beads.
  Argued with: it is the same problem solved the other way, at maturity, and the brief says why that comparison is kept (`brief-2026-08-20.md`, "The opposed design, kept on hand").
- `tasktron.clj` — Tasktron, a single-file Babashka script by lynaghk, copied 2026-10-07 from the gist at https://gist.githubusercontent.com/lynaghk/a7fbe176215aba38537237e33628d062/raw/9cea0cb93980f757fad5da6c24c7097e7a7d6eec/gistfile1.txt, with a trailing newline added.
  Drawn on: it authors a plan in interactive stages that end in an explicit approval, then executes every subtask unattended, each role a fresh headless session with a prompt built in code and the next step chosen by code from that role's structured verdict, which is the shape the next design of card's authoring and execution starts from.
- `brief-2026-08-20.md` — this repository's own first design brief, seeded 2026-08-20 and moved here verbatim on 2026-10-26, when `BRIEF.md` replaced it.
  Superseded: it is the founding record with the lineage — agentpane, OW-59, the beads argument — and the first statement of the mechanics the redesign keeps, which `BRIEF.md` now states for itself: the card file's format, the Bun runtime, and where the deck lives.
- `brief-2026-10-27.md` — this repository's second design brief, written 2026-10-26 and amended through 2026-10-27, kept here verbatim on 2026-10-27, when `BRIEF.md` was rewritten to state the design alone.
  Superseded: it is the record of how the redesign was reached — the dates, the owner's words, the evidence from the checks behind its factual claims, and each amendment with its reason — which the rewrite left out of `BRIEF.md`.
- `payload-rewrite/plan.md` — this repository's own, written 2026-08-22.
  Carried: it governs the rewrite of the payload files that `AGENTS.md` "The register for payload files" cites.
- `payload-rewrite/inventory.md` — this repository's own, the rule inventory that rewrite was done from.
  Carried: it is the record of how the current payload came to be; it cites card ids as the one deliberate exception to the rule that nothing public cites one, settled in the last paragraph of `plan.md`.
