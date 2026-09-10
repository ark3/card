# Reference

Documents this project reads from and reasons against, most of them copied verbatim from other projects; this file names where each came from and why it is kept.
In `BRIEF.md`'s terms, every document here is carried except the beads README, which is argued with.

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
  Argued with: it is the same problem solved the other way, at maturity, and the brief says why that comparison is kept (`BRIEF.md`, the passage naming `reference/beads-rust-readme.md`).
- `payload-rewrite/plan.md` — this repository's own, written 2026-08-22.
  Carried: it governs the rewrite of the payload files that `AGENTS.md` "The register for payload files" cites.
- `payload-rewrite/inventory.md` — this repository's own, the rule inventory that rewrite was done from.
  Carried: it is the record of how the current payload came to be; it cites card ids as the one deliberate exception to the rule that nothing public cites one, settled in the last paragraph of `plan.md`.
