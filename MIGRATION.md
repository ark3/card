# Migrating card to the design in BRIEF.md

This file bridges today's code to the design `BRIEF.md` states, and it lasts only as long as that work.
`BRIEF.md` describes the design as if nothing came before it and never cites this file; this file cites the brief and says what the current implementation contributes, what goes, and how existing decks meet the new tool.
Cards that build the design cite `BRIEF.md`; cards that move or delete today's code cite this file.
Like everything in this repository it is public, so it cites no card id.

## How the work runs

Today's tool executes the work that replaces it, installed globally from this repository at the tag `card-1.0`, so the cards replacing the tool never change the tool executing them.
Today's tool has cards, labels, `blocked-by`, `card author`, `card execute` and `card run`, which runs cards in series; it has no plans, stages or roles, which belong to the design and not to the tool that builds it.

The whole design lands as one series of cards, authored now with `card author` and run by today's tool, and the last card checks every acceptance criterion in `BRIEF.md` and every migration check below.
Splitting the work into plans, the first producing a `card` able to author and run the rest, was considered and declined on 2026-10-28: the new tool's approach is unproven, while today's tool is known to work with strong models and acceptably with GPT-5.6 Terra, the weaker model it meets at work.
Staleness is no reason to split either: today's execution amends a stale card before building it.

Order is carried by `blocked-by`, each card on the one before it, since today's tool keeps no order of its own and `card list --ready` then shows one runnable card at a time.
Every card carries the label `redesign`, which stands in for the ticket key `card author` asks for, and a card whose change lands in `payload/*.md` carries `payload` beside it.

The cut below was settled on 2026-10-28 from three decompositions made independently, by Claude Fable 5.1, GPT-6 Astra and Claude Opus 5.5, each from this file and the brief with the code and the closed pile to read, compared piece by piece, with the owner deciding where they differed.
The authoring session takes it as input, not as a contract, and flags where grounding a card against the code changes a piece.
New file and symbol names are proposals: the card that creates each records the name it chose in its close note.

### Principles behind the cut

- Today's workflow surface goes first, in one piece, so every later diff is about the design and not the code it replaces.
- `deck` is finished before `card` gains a verb, since `card` touches a card file only through `deck`'s modules.
- `card`'s pieces follow a plan's own lifecycle: the authoring stages, then the run's happy path, then each way a run stops and is answered, then the end, then the walk through every state.
- A route lands whole: the outcome word in a role's answer, the code that routes on it and the sentence in the role's prompt that offers it land in one piece, and each role's step has its own payload file, by "One reader per prompt".
- Prose with no schema to drift from — the stage prompts, `deck agent-help`, the relay sentence, the settling prompt — is its own piece, written before the code that prints it, with the cold read `AGENTS.md` prescribes as its done-condition and the placeholders it carries named for the code piece that follows.
- A foundation with its own tests and no route of its own — the harness, the git operations — is its own piece, just before its first consumer, tested against a stand-in and temporary repositories.
- A convention that crosses pieces lands at its first site: the owner register and `--plan` are in place before the first printout and the first verb that could carry them.
- Every piece leaves `bun run check` green, and none needs the repository's own `card` to work in between, since the series runs on the pinned global.
- Every card says its trials of the new executables run in a scratch repository, because this repository's deck holds the series' own cards, which a new bare `card` run here would list as waiting and a new `deck close` would close.
- The last piece checks, deletes this file and the four chapters, and builds nothing.

### Agreements between pieces

Each is incidental once its producer and consumer agree, and the cards fix them so two cold sessions fit.

- The plan directory is `<card-dir>/plans/<slug>/`, beside the deck under the git common directory, holding `plan.md`, a `cards/` drafting directory, the plan's state file and the run's log.
- Placeholders in payload files are `{{NAME}}`, and the command placeholder renders as `card` or `card --plan <slug>` when more than one plan is in progress.
- Text for the owner sits between `<for_owner>` and `</for_owner>` on lines of their own, preceded by the relay sentence.
- Record sections are tool-written headings from a fixed set — `## Account`, `## Review feedback`, `## Close note`, `## Promotion` — appended at the end, and the contract is everything above the first of them.
- Outcome words: the reconciler answers `proceed` or `stop` with a cause (`intent`, `order` or `disagreement`) and a question for the owner; the implementer answers `done` with its account or `blocked` with the finding; the reviewer answers `approved` or `fixed`, each with a subject and a close note, or `revision` with feedback; every answer has an optional `findings` list of headline and body; a conversation turn carries a `reply`.
- Caps as constants: three revision rounds, three reconciler–implementer exchanges, two repair prompts, two returns for an id in the message or the diff; an owner's answer through `card resume` restarts the count.
- The stand-in harness is a script linked onto a test-controlled PATH as `claude` and `pi`, recording argv, stdin and working directory and answering from a script keyed by session id.

### Decisions taken at the comparison

- Cleaning the plan's worktree removes tracked edits and untracked files and keeps ignored ones, since installed dependencies are why there is one worktree per plan.
- The start point is recorded by name and resolved when `card approve` runs, since a name like `develop` moves.
- A joined card goes after the take-in's new files, ahead of the first card not yet closed done, in join order.
- A fresh reviewer each revision round, reading the earlier feedback in the card's record.
- `card approve` refuses while another plan's run is Running or Dead, naming it; several plans may exist at once.
- The reconciler amends the card and the plan document in place.
- A promotion awaiting its key is recorded as `## Promotion` with the draft on the card's record, so bare `card` lists it from the deck alone.
- The refusal of a config carrying `public` fires in deck resolution, so every verb of both executables refuses until the key is deleted; a leftover `[run]` section is ignored.
- The Bounced report prints the command that resumes the stopped session at a terminal, run from the plan's worktree.
- `mainCheckout` goes with the verbs that called it; `firstListed` gives the repository root the new landing needs.
- `AGENTS.md` is not brought up to date by the series; the owner edits it afterwards.
- Reference material is not a second specification: `reference/tasktron.clj` is drawn on for the prompts and overrides nothing in the brief.

For cards whose done-condition calls for the two cold readers, the owner invokes `card run` from inside a sandbox using `sbox`'s `all` profile, with sandbox pass-through enabled; both conditions are required for this execution setup.
Verified on 2026-10-28 under that setup: the executing session invoked both readers using the commands in `AGENTS.md`, each from a fresh empty directory with the question and file text on stdin, and both exited 0 in four seconds and answered the question about `payload/author.md` correctly.
The run logged `sbox: passing through inside existing session`, and the reader invocations inherited the enclosing sandbox's environment.

### The pieces

The pieces are cards in this repository's deck, one per piece in execution order, each labelled `redesign` and blocked by the one before it; the cards are the contract, so the cut changes by amending a card, and this section no longer restates them.

## What carries over

Into `deck`:

- `src/cardfile.ts`, `src/deck.ts`, `src/id.ts` and the helpers in `src/git.ts`, with their tests.
- Five of today's verbs — `init`, `new`, `show`, `list` and `close` — with their tests, and `lint-commit` as `deck lint`.
- `refuseFromLinkedWorktree` and `firstListed`, which `new` uses and which live in `src/verbs/worktree.ts` today, so they move before that verb goes; `mainCheckout`, beside them, resolves the main checkout's branch, which nothing in the design needs, and goes with the verb.
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
- Public mode: the `public` flag, the payload's `<!--public-->` and `<!--private-->` markers with `renderPayload`, and the card-id check's exemption for a public deck; the markers sit in the four chapters and go with them, so the renderer goes first and the chapters stay source material until the last card.
- `close`'s refusal from a linked worktree, which guarded a dispatched session closing cards; the tool now closes cards itself.
- `close`'s standing-worktree line, which names a branch only the retired `worktree` verb cut.

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
