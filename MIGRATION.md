# Migrating card to the design in BRIEF.md

This file bridges today's code to the design `BRIEF.md` states, and it lasts only as long as that work.
`BRIEF.md` describes the design as if nothing came before it and never cites this file; this file cites the brief and says what the current implementation contributes, what goes, and how existing decks meet the new tool.
Cards that build the design cite `BRIEF.md`; cards that move or delete today's code cite this file.
Like everything in this repository it is public, so it cites no card id.

## How the work runs

Today's tool executes the work that replaces it, installed globally from this repository at a pinned sha, so the cards replacing the tool never change the tool executing them.

How many plans the work takes is authoring's first decision, and it is open.
The recommendation is two or three plans rather than one.
The first is the smallest `card` that runs a plan end to end on both harnesses: the authoring stages, the three roles, landing, and stopping and answering.
The later plans — settling findings and promotion, the owner register, `deck agent-help` — are authored after the first lands and run on the new tool itself, which gives a working `card` sooner and gives the design's open questions the real run two of them wait on.
Each later plan runs on a build pinned at the end of the one before it, for the same reason today's tool is pinned.
Staleness is not the reason to split: today's execution amends a stale card before building it.
The alternative is one plan, with every acceptance criterion in `BRIEF.md` checked only by its last card.

## What carries over

Into `deck`:

- `src/cardfile.ts`, `src/deck.ts`, `src/id.ts` and the helpers in `src/git.ts`, with their tests.
- Five of today's verbs — `init`, `new`, `show`, `list` and `close` — with their tests, and `lint-commit` as `deck lint`.
- `refuseFromLinkedWorktree` and `mainCheckout`, which `new` uses and which live in `src/verbs/worktree.ts` today, so they move before that verb goes.
- Two operations that are new: reopening a closed card in place, and appending a record section beneath a card's contract.

The code already falls on that seam, so the split costs a rename and the two additions.

Into `card`, which is otherwise written new:

- The harness choice in `chooseLaunch` in `src/verbs/run.ts` — Claude Code where `claude` is on PATH, else Pi, and `--harness` to name one — without its `sbox` wrapper and `--no-sbox`, which go with `card run`.
- Any helper in `src/git.ts` or `src/payload.ts` that fits.

Into the prompt files under `payload/`:

- Today's four chapters — `author.md`, `execute.md`, `status.md` and `workflow.md` — are source material for wording that has held up in real sessions, minus the survival vocabulary ("dies with the session", "its own only copy", "survives only once it is a card") and everything that steered a session.
- `deck agent-help` is where the workflow chapter's conventions land: the file's shape, the verbs, how to cite an id, and the one-way reference rule.
- The final card's guide takes the place of the hand-back step in `execute.md`, "Say what changed and how to see it".

## What goes

`card` is a new program, so today's surface ends when it lands; this list is the code and text that go with it.

- The verbs `status`, `cmd`, `worktree`, `author`, `execute`, `run` and `workflow`, with their tests and `test/run-stub.sh`: the design has no session that steers the workflow, bare `card` starts authoring, the tool holds the plan's worktree itself, and the Cards stage's prompt prints the deck's path.
- The four chapters, once the prompt files have drawn on them.
- `card run`'s `sbox` wrapper, `--no-sbox`, `[run]` refusal, report and close commit, and `status`'s sandbox probe, each with its verb; card leaves sandboxing to the environment the owner runs the harness in.
- Public mode: the `public` flag, the payload's `<!--public-->` and `<!--private-->` markers with `renderPayload`, and the card-id check's exemption for a public deck.
- `close`'s refusal from a linked worktree, which guarded a dispatched session closing cards; the tool now closes cards itself.

## Existing decks

- A config's `deck` redirect keeps working.
- A config still carrying `public` is refused, with a line saying the flag is gone, as today's `card run` refuses a stale `[run]` section, so the owner never believes the flag still applies; agentpane's deck, the one public deck, is being emptied into its issues, so no deck needs it.
  The reason for that refusal outlives this file, so it goes in a code comment beside the check.
- Today's open cards sit in `open/` in no plan's order, so they arrive as waiting cards: bare `card` lists them with `decline` and `promote` open, and a Cards stage can `join` them, where their `blocked-by` entries are enforced.
- The closed pile stays where it is, readable at the path the Cards stage's prompt prints.

## Migration checks

These join the acceptance criteria in `BRIEF.md`, and the same last card checks them.

- Each of today's verbs that neither executable keeps — `status`, `cmd`, `worktree`, `author`, `execute`, `run`, `workflow` and `lint-commit` — is refused as unknown by both.
- `card` refuses `init`, `new`, `show`, `list` and `close` as unknown, since they moved to `deck`.
- A config carrying `public` is refused.
- The tests that came over with `deck`'s verbs pass.

## Exit

The last card of the work checks that nothing permanent lives only here — a reason that outlives the migration, such as why a config carrying `public` is refused, moves into a code comment or `BRIEF.md` — and then deletes this file.
