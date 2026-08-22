Deck: {{DECK}} — {{OPEN}} open, {{CLOSED}} closed.

A card is one unit of work, small enough to hold, written so a cold agent can
pick it up and start. The deck is this project's private, agent-facing record;
whatever the project already uses for tracking stays the public one.

## Mode

Resolve this from what has already been asked. Do not put the choice to the
owner.

- Deciding what to build, or writing or sharpening cards: run `card author`.
- Landing a card that already exists: run `card execute`.
- Anything else: neither. Carry on, under the rules below.

Each prints the procedure for its mode. Run it before you act, not after.

## Verbs

`card new '<headline>' [--label L]... [--blocked-by <id>]...`, body on stdin.
Draws an id, checks it against the open and closed cards, and writes the file,
as one act. Never choose an id, never write a card file by hand, and never
create a skeleton to fill in afterwards — a card half-written is the failure
this verb replaces. The headline is an argument because a card has exactly one
`# ` line and that line never wraps.

`card show <id>` prints a card wherever it is, and `card show <id> --path`
prints the file's location instead, which is how you edit one. Ids are cited
bare, and a card changes directory when it closes, so never build a path out of
an id.

`card list --ready [--label L]...` gives the open cards whose blockers have all
closed, which is the first question of an execution session. A blocker naming a
card that exists nowhere is reported here rather than passed over.

`card close <id> --done|--promoted|--declined|--moot`, explanation on stdin.
Moves the card and appends the explanation as one act, and refuses to run on
empty input. The flag is about the work, not about the card: every close
finishes the card, and `--promoted`, `--declined` and `--moot` all say the work
itself never happened. The tool then names the cards this one was blocking,
which are about to look ready and are not; what happens to those is the owner's
decision, not yours. The explanation is written for one reader: the next
authoring session, sweeping the closed pile for prior art. The flag records
what happened; the prose carries why — what was built and how it was verified,
or what was decided against and why, or where the work went if it went
somewhere else. Name a public ticket key if the card has one — that still
resolves in a year, where a commit sha dies at the next squash.

`card worktree <id>` cuts an isolated tree for a dispatched agent, at
`.worktrees/<id>` on a temporary branch, and reports the path and the sha it
starts at. `card execute` says when to use it.

`card exec -- <cmd>` runs a command with the deck as the working directory. The
cards are plain markdown; grep them.

## Rules, in any mode

**Cite ids, never restate a card.** `card show` reaches it. A retelling in the
conversation is a second copy, and it drifts from the first.

**Anything left undone becomes a card rather than getting done.** Scope you
notice mid-work is filed, not fixed. That is the wanted outcome, not a
concession.

**A finding that lives only in a transcript dies with the session.** If it has
to survive, it goes into a card — a new one, or a close note.

**References are one-directional.** Cards cite public keys — tickets, branches,
commits — freely. Nothing public ever cites a card id: not a commit message,
not a pull request, not a comment in the code. That rule is the whole privacy
boundary.

**The session stays thin.** Reading and writing happen in dispatched subagents,
and what they find lands in a card rather than in the session that dispatched
them. Exploring in the session that is landing a card is the failure mode.
