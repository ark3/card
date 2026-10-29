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

Each becomes one card, blocked by the one before it.

#### 1. Retire today's workflow verbs, public mode and the sandbox wrapper, moving out first what carries over

Delivers: `status`, `cmd`, `worktree`, `author`, `execute`, `run` and `workflow` go with their modules, their tests and `test/run-stub.sh`; public mode goes — `Deck.public`, `lint-commit`'s exemption, `renderPayload` and `test/payload.test.ts` — and a config carrying `public` is refused from `resolveDeck` with the reason in a comment beside the check; `close` loses its linked-worktree refusal and its standing-worktree line; `firstListed` and `refuseFromLinkedWorktree` move into `src/git.ts` and `mainCheckout` goes; the harness choice moves out of `run` into a module for `card`, without `sbox` and `--no-sbox`; the report of a close stranded before its rename moves from `status` to `list`'s stderr; the test that `rg` reaches cards through a repository `.gitignore` of `*.md` moves from `cmd`'s tests to `init`'s; `wrapPayload` stays.
The four chapters under `payload/` are not touched, markers and all, so this card carries no `payload` label.
Touches: `src/card.ts`; the seven verb modules and their tests, deleted; `src/git.ts`, `src/deck.ts`, `src/payload.ts`, `src/verbs/new.ts`, `src/verbs/close.ts`, `src/verbs/list.ts`, `src/verbs/lint-commit.ts`; the tests of `new`, `close`, `list`, `init`, `deck`, `lint-commit` and the CLI walk; a new harness module and its test.
Needs: nothing.
Done when: `bun run check` is green; `rg` for the retired modules, `renderPayload`, `deck.public` and `sbox` under `src` and `test` prints nothing; each retired verb is refused as unknown; `resolveDeck` refuses `public = true` and `public = false` alike with a message saying the flag is gone; `close` succeeds from a linked worktree; the harness choice's five cases pass against the new module.

#### 2. Split the six kept verbs off into a `deck` executable, `lint-commit` as `deck lint`, leaving `card` with no verbs

Delivers: a `deck` entry beside `src/card.ts`, named in `package.json` `bin`, dispatching `init`, `new`, `show`, `list`, `close` and `lint` and refusing any other verb with a usage line; `card` refuses every verb as unknown; `deck new`'s refusal from a linked worktree gives the design's reason and names the checkout to run from; behaviour is otherwise unchanged, so the piece reviews as a rename.
Touches: `package.json`; a new deck entry; `src/card.ts`; the verb modules' usage strings; the CLI walk and the lint tests.
Needs: 1.
Done when: `bun run check` is green with every carried test passing against `deck`; the CLI walk runs `deck init`, `deck new`, `deck list --ready`, `deck close` and `deck show` through the executable and asserts `card init`, `card new`, `card show`, `card list`, `card close` and `card lint-commit` are refused as unknown, as are `deck lint-commit` and `deck status`; `package.json` names both executables.

#### 3. Make every deck operation a function `card` calls, create the deck where none exists, enforce the card's shape, and add reopening and the record

Delivers: filing, closing, locating, listing and the id check as functions free of argv, stdin and console output, with the verbs as thin wrappers; a deck created under the fixed prefix `card` by `deck new`, under a chosen one by `deck init <prefix>`, and by a function `card` calls when it starts a plan; the parser refuses an empty or second `# ` line, a frontmatter field outside the three and an outcome outside the four, while a closed card written before `closed:` existed, which carries no outcome, still reads; writers emit the fields as `BRIEF.md` "The card file and the deck" states, omitting an empty list and writing `closed:` only at close; `deck close` runs the id check on its note before moving the card; reopening in place moves a card from `closed/` to `open/`, removes `closed:` and keeps every byte below; appending a record section adds a heading from the fixed set and its text beneath everything a card holds, byte-preserving above.
Touches: `src/cardfile.ts`, `src/deck.ts`, `src/id.ts`, the verb modules; new tests for the library seam, the shape and the record.
Needs: 2.
Done when: `bun run check` is green; the library tests create, read, list, lint and close a card with explicit inputs and no stdin; the shape tests refuse each bad case and read an old card; close, reopen, close leaves one `closed:` line and two close notes in order; `deck close` refuses a note citing an id of the deck; `deck new` in a repository with no deck writes the config with `prefix = "card"` and files the card.

#### 4. Add `deck agent-help`, which prints on demand the conventions a session needs to touch the deck directly

Delivers: `payload/agent-help.md`, printed by `deck agent-help` inside the envelope and by nothing else, stating the card file's shape, the verbs with `deck new` creating the deck, how to cite an id, and the one-way rule with `deck lint`, drawn from `payload/workflow.md` minus the survival vocabulary and everything that steered a session; `wrapPayload` generalized to name the command to rerun.
Touches: the new file, so the card carries `payload`; `src/payload.ts`; a new verb and the deck entry's table; a test of the printout.
Needs: 3.
Done when: `bun run check` is green; a test asserts the printout opens and closes the envelope and carries the headings; both cold readers, given the file, answer that the deck holds a plan's cards while the plan runs, that an empty deck says nothing about whether there is work, and that a commit message never cites a card.

#### 5. The owner register: the relay sentence, and the marking every later printout for the owner uses

Delivers: `payload/relay.md`, the one sentence directing a session to put everything between the owner marks in its reply unaltered and whole, and a helper that writes a marked block with that sentence beside it, defined once; nothing else prints yet.
Touches: the new file, so the card carries `payload`; a new module for owner output; its test.
Needs: 4, for the envelope the sentence rides in.
Done when: `bun run check` is green; the test asserts a block's contents survive byte for byte between the marks with the sentence before them; both cold readers, given a printout holding a marked block, reproduce the marked text unaltered rather than summarize it.

#### 6. The three stage prompts as payload files, each telling card's plan from Claude Code's plan mode

Delivers: `payload/document.md`, `payload/cards.md` and `payload/check.md`, one reader each, from `BRIEF.md` "Authoring", "The plan document and the final card" and "Delivery", with `payload/author.md` as source for what a card carries; each opens by placing the session in card's plan and apart from plan mode, says what the stage produces and where, and that `card done` runs when the owner agrees; Document names what the plan document holds and that its frontmatter records the branch, the start point and the host's commit convention; Cards prints the deck's path, says in words that the session is reading the deck, names the drafting directory and the filename order with the last file as the final card, lists the waiting cards with `join` and `later` beside each, says a plan's cards carry no `blocked-by`, states the order rule for an amended plan, has the final card carry a draft of the owner's guide, written from the plan document's acceptance criteria — how to see the plan working and what only the owner can check — and answers what the deck is for and what an empty deck says; Check says in plain words that `card approve` is the owner's word and starts the run, that `card amend` returns to Cards, and that a done-condition only the owner can judge is flagged on every card but the final one.
Each file's placeholders are named in the card, for piece 7 to substitute.
Touches: the three new files, so the card carries `payload`; `reference/tasktron.clj`'s authoring prompts are read as what not to copy.
Needs: 5, for the relay sentence the Cards printout's waiting list rides in.
Done when: both cold readers, given each file alone, answer that the session is not in Claude Code's plan mode and name the stage's product; given the Cards file, answer what the deck is for and what an empty deck says as the brief does, and that the final card carries a draft guide written from the acceptance criteria; given the Check file, answer that approval is the owner's explicit word and starts the run.

#### 7. The plan store and the state-gated verbs: bare `card` starts a plan, `card done` ends the Document stage, and `--plan` names a plan

Delivers: one table of verbs and the states each is open in, deciding both dispatch and the printed open commands; a verb not open refuses, names the state and prints the commands open in it, and a verb outside the table is refused as unknown; a plan store under the plan directory, written whole on every change, its state read from the record and never inferred from the document; bare `card` with no plan in progress creates the deck if there is none, lists the waiting cards — cards in `open/` in no plan's order — in the register with `decline` and `promote` open for each, starts a plan under a placeholder slug and prints the Document prompt; `card done` in Document refuses while the frontmatter lacks the branch or its start point, naming what is missing, and otherwise replaces the slug with one from the headline and moves to Cards; `--plan <slug>` is accepted by every verb in any position, only bare `card --plan <slug>` starts a plan under a new slug, every other verb refuses a slug it does not know, and with more than one plan in progress bare `card` lists them and prints each command with `--plan <slug>` after the word `card`; every verb but bare `card` answers "no deck here" where there is none.
Touches: `src/card.ts`; a new plan module holding the store, the states and the table, and a stage printouts module; the three files of piece 6; new tests.
Needs: 6, 5, 3.
Done when: `bun run check` is green; tests assert that bare `card` in a repository with no deck creates the deck, prints the Document prompt with no placeholder left and records one plan; that a second bare `card` records no second plan; that a waiting card is listed; that `card done` without a start point refuses naming it, and with both fields moves the plan to Cards under the headline's slug; that `card approve` in Document refuses naming Document and listing the open commands; that `card frobnicate` and `card status` are refused as unknown; that with two plans bare `card` prints `card --plan <slug> done` for each; and that `card --plan nosuch done` refuses and starts nothing.

#### 8. The Cards stage: print the prompt with the deck's path and the waiting cards, take the card files in on `card done`, with `join` and `later` open

Delivers: bare `card` in Cards prints `payload/cards.md` with the plan document's path, the drafting directory, the deck's absolute path and each waiting card's `join` and `later` lines; `card done` checks every file's shape before filing any, enforces every `blocked-by` entry — no card before a card it waits on, and a blocker outside the plan closed `done` — then files each through deck's function, records the order with the last file as the final card, and moves to Check; any refusal names the file or card and files nothing; `card join <id>` takes a waiting card into the plan ahead of the first card not yet closed done, and `card later <id>` records the decision and leaves it waiting; on re-entry to Cards the plan's cards keep their order, new files go ahead of the first card not yet closed done, and a plan card closed declined or moot leaves the order.
Touches: the stage printouts and the plan module; new tests.
Needs: 7.
Done when: `bun run check` is green; tests assert that three files become three cards in filename order with the third final and the plan in Check; that a malformed file refuses naming it and files none; that a joined card blocked by an open card outside the plan refuses, as does one blocked by a card closed `declined`, and one blocked by a card closed `done` is taken in; that `card later` leaves its card waiting; that after a plan has run, a new file taken in sits ahead of the first card not closed done and a declined plan card is gone from the order; and that the printout carries the deck's absolute path.

#### 9. The Check stage: print the prompt, and return to Cards on `card amend`

Delivers: bare `card` in Check prints `payload/check.md` with the document's path and the plan's cards in order with their paths; `card amend` in Check moves to Cards and prints the Cards prompt; `card approve` lands in piece 13, so until then the table lists `card amend` alone, and the card says so.
Touches: the stage printouts; a new test.
Needs: 8.
Done when: `bun run check` is green; tests assert the printout lists the cards with their paths, that `card amend` moves to Cards and prints its prompt, and that `card done` in Check refuses naming Check.

#### 10. The harness: launch and resume a role on Claude Code or Pi under an id the tool chooses, read its answer against a schema stated in the prompt, and repair at most twice

Delivers: each harness's flags spelled once — `claude -p --output-format json --permission-mode bypassPermissions --session-id <uuid>`, resumed with `--resume <uuid>` in its place; `pi -p --session-id <uuid>` for both — the prompt on stdin, the session run in a named directory a resume repeats, and no model or effort flag; the answer read from Claude Code's `result` field, whose error flag marks a failed session, and from Pi's plain output; a crash, a non-zero exit, the error flag or unreadable output a failure carrying its cause; a schema defined once yielding both the instruction appended to the prompt — the final text exactly one JSON object and nothing else — and the validation; `payload/repair.md` sent by resuming the same session on a malformed answer, with the fence, "The previous report was invalid:" and the error verbatim, and the schema restated, two repairs and then failure; the stand-in harness for tests; a probe against the real `claude` and `pi`, outside the suite, of a launch, a resume of the same id and one repair, each answer read by the module, and of what a failing session prints on each, recorded in the close note, so a mismatch between the brief's spelling and either harness surfaces here rather than in the pieces built on it.
Touches: the harness module from piece 1, a new answer module, `payload/repair.md`, so the card carries `payload`; the stand-in; tests.
Needs: 2.
Done when: `bun run check` is green; tests assert the argv for each harness and step equals the brief's spelling with the prompt on stdin; a `result` holding one JSON object parses and one with the error flag fails naming its cause; Pi's plain output parses; an answer with prose around its JSON gets a resume carrying the three parts, never a launch; a third malformed answer fails after two repairs; changing a schema changes both its instruction and its validation; the probe, on each harness, launches, resumes the same id into a session that recalls its first exchange, and repairs a malformed answer into one the module reads, and its close note records what a failing session printed on each; both cold readers, given a repair prompt as built, answer that they correct only the report and touch no file.

#### 11. The git operations a card lands with: the plan's branch and worktree, discard, undo, the composed commit and the lines a diff adds, never touching the main checkout

Delivers: the branch created from its start point, resolved by name at the call, when absent, and used as it stands when present; held in one worktree under `.worktrees/` with a `.gitignore` of `*`, so git refuses a second checkout; discard by reset and clean, keeping ignored files; a HEAD moved since a recorded commit undone with the changes kept; the lines the uncommitted diff adds, new files included; a commit message composed from a subject, a blank line and a body wrapped at 72 columns, landed as one commit, empty where nothing changed, its sha returned for the record; removal of the worktree keeping the branch; no operation changing the main checkout's HEAD, index or files.
Touches: a new landing module, `src/git.ts`; a new test on temporary repositories.
Needs: 1.
Done when: `bun run check` is green; tests assert each operation on temporary repositories; that the main checkout's HEAD, index and status are identical before and after every one; that clean keeps an ignored file and removes a tracked edit and an untracked file; that two implementer commits are undone with their changes present; that a message's subject and wrapped body land byte for byte; and that a no-change commit is empty.

#### 12. The cycle: a fresh implementer and a fresh reviewer take one card through to one commit whose subject and body the reviewer wrote

Delivers: a cycle, called in process, running one card in the plan's worktree: a fresh implementer under a recorded uuid gets `payload/implement.md` and the card and answers `done` with its account, appended as `## Account`; a fresh reviewer gets `payload/review.md`, the card with the account, the diff and the commit convention from the plan document, runs the done-condition itself, and answers `approved` or `fixed` with a subject and a close note; the implementer's own commits are undone, one commit lands with the composed message, and the card closes done with the note; a failed role ends the cycle stopped with the cause and the session, and the cycle records the role and step it is at; neither prompt carries the plan document; `implement.md` says implementation only, that the tool commits and owns branches so a host instruction to commit or branch does not apply, and what the account holds; `review.md` says to go through the card one requirement at a time naming the code that meets each, when `fixed` applies and that no second review follows, what the close note holds and that it is the commit's body, and what the subject is under the quoted convention.
Touches: a new cycle module; the two new files, so the card carries `payload`; the stand-in's script; tests.
Needs: 10, 11, 3, 9.
Done when: `bun run check` is green; tests with the stand-in assert one commit whose message is the subject, a blank line and the note; an empty commit for an implementer that changed nothing; an implementer's own commit folded into the card's; the card in `closed/` with its account and note beneath the contract; two distinct recorded session ids; no plan document in either stdin, and the account and the diff in the reviewer's; the main checkout unchanged; both cold readers, given `implement.md` as built, answer that they commit nothing and that a host branch instruction does not apply, and given `review.md`, answer when `fixed` applies and that no second review follows.

#### 13. The detached run: `card approve` starts it, and state is written after every card

Delivers: `card approve` in Check chooses the harness by the PATH rule or `--harness claude|pi`, refusing one not on PATH, records it, resolves the start point and refuses one git cannot resolve, ensures the branch and worktree, moves to Running, starts the run detached as the leader of its own process group, which every role and every process a role starts joins, and returns at once; the run runs the cycle for each card in order, records the active card and role before each launch and the landed commit before the close, writes the state after every card, and ends in Ended after the last card or in Bounced with the cause and the session; the run's pid recorded beside the kernel's boot id; while the run lives it alone writes the state; the close note states the state file's shape and the order of the writes around each commit and close, which piece 14 recovers from.
Touches: the plan module, a new run module and its entry script; tests with a stand-in whose roles can be held.
Needs: 9, 12, 11, 10.
Done when: `bun run check` is green; tests assert that `card approve` returns while the first role still sleeps and the plan reaches Ended with one commit per card in order; that a named harness absent from PATH and an unresolvable start point refuse before anything launches; that the state records the first card closed before the second launches; that the state records the run's pid and boot id; and that a role and a child it starts run in the run's process group.

#### 14. Recovery from a dead run: a Running plan whose run is gone reads as Dead, and bare `card` ends what the run left alive and carries it on

Delivers: a Running plan whose recorded pid is gone or whose boot id differs reads as Dead; bare `card` in Dead first ends the dead run's process group, named by its recorded pid, where anything in it is alive on the same boot, since a runner that crashed alone leaves its role and the role's own processes still writing in the worktree, then starts a new run from the last card closed: a card landed but not closed is closed from its recorded commit, and the in-flight card reruns from the start of its cycle on a worktree reset to the last commit the state records and cleaned, so a commit no record names — the tool's own, made before its record was written, or an implementer's — is discarded with the card's work; the card states, for each interruption point its done-condition names, what the durable state holds before and after it, grounded in the state piece 13 landed.
Touches: the plan module and the run module; tests with a stand-in whose roles can be held and killed.
Needs: 13.
Done when: `bun run check` is green; tests assert that a dead pid and a foreign boot id each read as Dead; that killing the run after the commit and before its record, after the record and before the close, and after the close and before the state write, then running bare `card`, leaves one commit for that card and the card closed once; that killing it mid-card reruns that card on a clean worktree with no closed card run again; and that killing the run alone while a role sleeps with a child of its own, then running bare `card`, ends both before the next role launches.

#### 15. Reports in the owner's register: progress while the run lives, what a bounced run waits on, and the end with the final card's guide

Delivers: bare `card` in Running reports the active card and role, how many cards have closed and their headlines; in Bounced, what the stopped role asks and why, the cause for a failed role, and the command that resumes the session at a terminal from the worktree; in Ended, the final card's close note as the guide, the branch and the worktree's path; `approve`'s acknowledgement names the harness; all through piece 5's helper, byte for byte from the record.
Touches: the Running, Bounced and Ended rows; a reports module; tests.
Needs: 13, 5.
Done when: `bun run check` is green; tests assert each report's content inside the marks with the relay sentence beside it, the resume command carrying the recorded uuid and the worktree's path, and the guide byte for byte at Ended.

#### 16. The reconciler: a fresh session before each card's first implementer amends the card and the plan document within the plan's intent, or stops the run

Delivers: the cycle starts with a reconciler under `payload/reconcile.md`, given the card, the plan document and both paths, answering `proceed`, saying what it amended, or `stop` with its cause; it rewrites a done-condition only the owner can judge into evidence an agent can check; it edits the two files in place and nothing else; it runs once per card, and fresh again when a card reruns from the start of its cycle; a stop leaves the plan Bounced with the reconciler resumable.
Touches: the cycle; the new file, so the card carries `payload`; tests.
Needs: 12, 13, 14, 15.
Done when: `bun run check` is green; tests assert that each card's first launch is a reconciler whose stdin carries the plan document and the card; that an amended contract reaches the implementer; that a stop leaves the plan Bounced with the question in the report and no implementer launched; that no implementer or reviewer stdin carries the plan document; and that the carry-on after a death starts with a reconciler; both cold readers, given the prompt as built for a card whose done-condition is the owner trying it, rewrite the condition and proceed, and given a card citing a function no earlier card creates, stop it as a problem of order.

#### 17. The revision route: a reviewer's request resumes the same implementer with the feedback in the record, a fresh reviewer follows, and the cap stops the run

Delivers: the reviewer's third outcome, `revision` with feedback, appended as `## Review feedback`; the same implementer resumed under `payload/revise.md` on the same uncommitted state, answering `done` with an account of the revision; a fresh reviewer each round, the earlier feedback in the record; three rounds, then the cycle stops with the reviewer as the session to resume and the last feedback in the report; `review.md` gains the outcome and what follows from choosing it.
Touches: the cycle; `payload/review.md` and the new file, so the card carries `payload`; tests.
Needs: 12, 15, 3.
Done when: `bun run check` is green; tests assert the feedback section, a resume of the implementer's uuid carrying it, a fresh reviewer uuid, one commit after approval, and Bounced past the cap with the last feedback; both cold readers, given `review.md`, answer when to request a revision rather than fix a thing themselves.

#### 18. The blocking route: an implementer's blocking finding goes to the reconciler, who converses within a cap and amends the card for a fresh implementer on a clean worktree, or stops

Delivers: the implementer's `blocked` outcome in its first step and when revising; the reconciler resumed under `payload/converse.md`, answering `amended`, a `reply` or `stop`; on a reply the implementer resumed under `payload/reply.md`; on an amendment the worktree reset and cleaned and a fresh implementer started on the amended card with no second reconciling; three exchanges, then the reconciler stops and is the session `card ask` and `card resume` reach; `implement.md` and `revise.md` gain the outcome, and `converse.md` says the implementer's work is discarded on an amendment, so the reconciler never amends towards what was built.
Touches: the cycle; the two new files and the two amended ones, so the card carries `payload`; tests.
Needs: 16, 17, 11.
Done when: `bun run check` is green; tests assert that a `blocked` answer resumes the reconciler's uuid with the finding; that an amendment leaves the worktree without the implementer's untracked file and launches a fresh implementer uuid with the amended card; that a reply resumes the implementer; that the cap leaves the plan Bounced with the reconciler as the session to resume; and that a revision round launches no reconciler; both cold readers, given `implement.md` for a card citing a function the code lacks, raise a blocking finding rather than build around it, and given `converse.md`, decline to amend towards what was built.

#### 19. Findings: one optional field every role's answer shares, each filed by the tool as a waiting card with the role, card and plan on its first line

Delivers: the field in every step's answer, each finding a headline and a body, filed through deck's function in no plan's order with the first line naming the filing role, the card and the plan, and recorded in the plan's state for the end; every role's prompt says what a finding is — something outside the card's contract the role must not act on — names the role's own outcome for a problem inside the contract, and says a finding is written so the role can put it down, never that it would otherwise be lost.
Touches: the answer schemas and the cycle; every role prompt so far, so the card carries `payload`; tests.
Needs: 18, 3.
Done when: `bun run check` is green; tests assert a reviewer approving with two findings leaves two cards in `open/` with the first line as specified, in no plan's order, while the card lands and the run goes on, and the same for the other roles; both cold readers, given `review.md` with a diff missing the done-condition and a stale comment elsewhere, request a revision for the first and report the second as a finding without editing it.

#### 20. The id check on the subject, the close note and the lines the diff adds, the reviewer repairing each at most twice before the run stops

Delivers: before committing, deck's id check on the subject and the note, a failure returned to the reviewer by the repair prompt scoped to the message, and on the added lines, a failure returned under `payload/strip-ids.md` with the offending lines quoted, to remove the id as a small fix; two returns each, then the run stops as a role that failed, the cause quoting the lines; nothing committed until both pass, on every deck.
Touches: the cycle; the new file, so the card carries `payload`; tests.
Needs: 12, 10, 15, 3.
Done when: `bun run check` is green; tests assert that a note citing a deck id goes back once and a clean second note lands; that a diff line citing one goes back with the line quoted and lands once the id is gone; that a third failure leaves the plan Bounced with no commit; and that an id under another prefix passes; both cold readers, given `strip-ids.md`, remove the id from the quoted lines and change nothing else.

#### 21. Answer a bounced run: `card ask` relays a question to the session whose answer stopped it, and `card resume` carries the owner's answer or retries a failed role

Delivers: `card ask`, the question on stdin, resumes the stopped session by its recorded id and harness from the directory it ran in, under `payload/ask.md`, prints the answer in the register and leaves the plan Bounced; `card resume`, the answer on stdin or nothing, resumes the same session under `payload/resume.md` with the answer and the step's schema, or with the instruction to give its final answer, reads it against that step's schema and carries the run on from that step; for a role that failed, it retries by resuming it; the count restarts after an owner's answer; neither prompt leans on "your last answer".
Touches: a relay module, the Bounced row, the run's continuation from a recorded step; the two new files, so the card carries `payload`; tests.
Needs: 15, 16, 17, 18, 13, 10.
Done when: `bun run check` is green; tests assert that `ask` resumes the recorded uuid with the question, prints the reply in the register and changes no state or file; that `resume` with an answer resumes the same uuid with the answer and the schema, and a `proceed` carries the run to Ended; that `resume` with nothing after a failed role resumes that role; that after each cap `resume` reaches the session the report named; and that `ask` in Running refuses; both cold readers, given `ask.md` with a leading question, answer it without resuming the work or editing a file.

#### 22. The final card: its roles read the plan document, its reviewer's close note is the owner's guide, and a gap it finds stops the run

Delivers: the last card runs with `payload/final-implement.md` and `payload/final-review.md`, each carrying the plan document beside the card; the implementer verifies the acceptance criteria end to end and raises a gap as a blocking finding, a reviewer that finds one requests a revision, and the reconciler stops the run rather than close the gap, the tool appending the finding to the card's record; the guide as close note, how to see the plan working and what only the owner can check, which the final reviewer builds from the draft guide the final card carries, updated with what the run found, rather than reconstructing it from the diff; no other card's implementer or reviewer sees the plan document.
Touches: the cycle; the two new files and the final card's case in `converse.md`, so the card carries `payload`; tests.
Needs: 18, 17, 19, 15.
Done when: `bun run check` is green; tests assert that only the last card's implementer and reviewer stdin carries the plan document; that a final implementer's `blocked` leads to a stop with the gap in the report and in the record and the card still open; and that an approving final reviewer's note prints at Ended as the guide; both cold readers, given `final-review.md`, answer what the note must hold, that it starts from the card's draft guide, and that a criterion not met gets a revision.

#### 23. `card stop`: end the run and its role session now, discard the in-flight work, and leave the card to rerun from its reconciler

Delivers: `card stop` in Running ends the run's process group, the run, the active role and every process the role started, resets and cleans the worktree, leaves the card open and moves to Stopped; in Dead the same, ending the dead run's process group where anything in it is alive, as piece 14 does; bare `card` in Stopped reports the card in the register; `card resume` in Stopped with nothing on stdin carries the run on, the card rerunning from a fresh reconciler; once `stop` returns, no process writes the state.
Touches: the run module, the Running, Dead and Stopped rows, the relay's resume; tests.
Needs: 13, 14, 21, 15, 11.
Done when: `bun run check` is green; tests assert with a stand-in sleeping beside a child of its own that `stop` returns with the run, the role and the child gone, the worktree clean, the card open and the plan Stopped; that bare `card` names the card; that `resume` reruns it from a fresh reconciler; that `stop` in Dead moves to Stopped; and that `ask` in Stopped refuses.

#### 24. `card amend` from a bounce or a stop: back to the Cards stage, and the run carried on from the first card not yet closed done

Delivers: `card amend` in Bounced or Stopped discards the in-flight work, moves to Cards and prints the Cards prompt listing the plan's cards in order, the closed ones as landed; `card done` takes new files in ahead of the first card not yet closed done; after Check, `card approve` carries the run on from that card, closed cards never rerunning, the bounced session left behind, and the stopped card's reconciler seeing the amendments on a clean worktree.
Touches: the Cards printout and take-in, approve's carry-on, the Bounced and Stopped rows; tests.
Needs: 23, 15, 8, 9, 13.
Done when: `bun run check` is green; tests assert that a plan bounced at the second of three cards, amended with one new file, taken in and approved launches no role for the first card, runs the new card, then the second from a reconciler carrying the amended card, then the final card, with one commit per card; and that `amend` in Running refuses.

#### 25. The settling prompt as a payload file

Delivers: `payload/settle.md`, read by the interactive session at a plan's end: the owner settles each finding one decision at a time, each its own invocation; what `join`, `later`, `decline` and `promote` each mean and take on stdin; that a promotion draft is public-safe and checked before the owner posts it; that `finish` ends the plan after the owner has tried it at the worktree's path; its placeholders named.
Touches: the new file, so the card carries `payload`.
Needs: 5.
Done when: both cold readers, given the file, choose `later` for a finding sound but outside what the plan set out to do, and `join` for one within it.

#### 26. The end: the Ended report lists the findings with the role that filed each, `card later` and `card decline` settle them, and `card finish` ends the plan once none is unsettled

Delivers: bare `card` in Ended adds to piece 15's report the findings the run filed, by id and headline with the filing role and each one's commands filled in, then the settling prompt; `card later <id>` records the decision and leaves the card waiting; `card decline <id>`, the reason on stdin, closes a waiting card declined, in every state and with no plan in progress; `card finish` refuses while a finding of the plan is unsettled, naming each, and otherwise removes the worktree, keeps the branch and ends the plan.
Touches: a settling module, the Ended row and the starting list; `payload/settle.md` imported; tests.
Needs: 25, 19, 15, 11, 3.
Done when: `bun run check` is green; tests assert that a run filing two findings ends with both listed in the register with their roles and commands; that `finish` refuses naming both; that after `later` on one and `decline` on the other, `finish` removes the worktree, keeps the branch, and the next bare `card` starts a new plan; and that `decline` on a waiting card during a run leaves the run unaffected and on a plan card refuses; both cold readers, given the Ended printout, relay the marked text and wait for the owner's decisions.

#### 27. `card promote` in two invocations: the public-safe draft checked for ids and printed for the owner, then the owner's key recorded

Delivers: `card promote <id>...`, the draft on stdin, runs the id check, refusing and naming each id cited, prints the draft in the register, and appends `## Promotion` with the draft to each card's record; `card promote <id>... --key <KEY>` closes each promoted with the key in its note; a finding awaiting its key counts as settled for `finish`, and bare `card` keeps listing it with the second form filled in until the key is recorded; both forms open in every state for a waiting card.
Touches: the settling module; tests.
Needs: 26.
Done when: `bun run check` is green; tests assert that a draft citing a deck id refuses and marks nothing; that a clean draft for two findings prints byte for byte and appends the section to both; that `finish` then succeeds; that the next bare `card` lists both with the second form; and that `--key` closes both promoted with the key in each note and they leave the listing.

#### 28. `card join` at a plan's end: the final card reopened in place, the finding rewritten in the Cards stage, and the joined cards run before the final card again

Delivers: `card join <id>` at Ended reopens the final card in place, as `BRIEF.md` "The final card checks the whole plan" says, so the ordinary rule puts the finding ahead of the first card not yet closed done, which is the final card, and moves to Cards, whose prompt names the finding's file to rewrite as a card for a fresh implementer and says to update the plan document if the finding changes what the plan is; after Check, `card approve` runs the joined cards, then the final card again; a joined card's `blocked-by` entries bind at take-in.
Touches: the settling module, the Cards printout, approve's carry-on; tests.
Needs: 26, 24, 8, 3.
Done when: `bun run check` is green; tests assert that `join` moves the final card to `open/` without its `closed:` field and moves to Cards naming the finding's path; that a run killed during the joined card, then carried on by bare `card`, runs the final card again; that after `done` and `approve` the joined card runs from its reconciler, then the final card's reconciler stdin carries its earlier close note in the record; and that the plan ends with the final card in `closed/` holding one `closed: done` and two close notes, the branch one commit richer per card run.

#### 29. `card drop`: give the plan up from any state, closing declined, with one note, every card of the plan not yet closed done

Delivers: `card drop` in every state ends a live run and its role as `stop` does, removes the worktree where one exists, keeps the branch, closes declined, with one note naming the plan, every card of the plan not closed done, the in-flight and joined cards included, and ends the plan; waiting cards and done cards are untouched.
Touches: the plan module, the stop shared with the run module, the landing's removal; tests.
Needs: 23, 26, 11, 3.
Done when: `bun run check` is green; tests assert that `drop` in Document ends the plan and the next bare `card` starts afresh; and that during a run it leaves no process and no worktree, the branch at its tip, every not-done plan card closed declined with the same note, done cards untouched, the run's findings waiting, and the plan unlisted.

#### 30. The walk through every state: one test takes a plan through the table and asserts each row, and `card approve` refuses while another plan's run is live

Delivers: a test walking one plan through every state and asserting that bare `card` does what its row says and that every verb not open there refuses, naming the state and printing the open commands; a second plan started with `card --plan <slug>` while the first is in Check, both listed with their commands; `card approve` refusing while another plan is Running or Dead, naming it.
Touches: approve's row; the new tests.
Needs: 29.
Done when: `bun run check` is green with both tests passing.

#### 31. Check every acceptance criterion and migration check on the finished branch, then delete this file and the four chapters

Delivers: each criterion and check verified by the test that pins it, by commands run in a scratch repository, or by the cold reads the criteria name; a two-card plan run end to end in a scratch repository under `--harness claude` and under `--harness pi`, driven as an interactive session would drive it, with what the session's sandbox cannot run listed for the owner; delivery checked by installing the repository into a temporary install root, never the global that is executing the series, with the GitHub install listed for the owner; "Exit" below run: nothing permanent left only here, then this file deleted, and with it `payload/author.md`, `execute.md`, `status.md` and `workflow.md`; the close note pairing each criterion and check with its evidence and listing what only the owner can check; a check that fails is a card filed for the fix, and this card stays open.
Touches: this file and the four chapters, deleted, so the card carries `payload`; `BRIEF.md` only if a reason that outlives the migration needs a home; scratch repositories.
Needs: every earlier piece.
Done when: `bun run check` is green on main; `ls` of this file and the four chapters reports each missing; `rg` for their names outside `reference/` prints nothing; the close note carries the evidence for all twelve criteria and four checks.

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
