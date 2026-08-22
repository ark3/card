Deck: {{DECK}} — {{OPEN}} open, {{CLOSED}} closed.

A card is one unit of work, small enough to hold, written so a cold agent can pick it up and start.
The deck is this project's private, agent-facing record; whatever the project already uses for tracking stays the public one.

## Mode

Resolve this from what has already been asked.
Do not put the choice to the owner.

- Deciding what to build, or asked to write or sharpen cards as the task itself: run `card author`.
- Landing a card that already exists: run `card execute`.
- Anything else: neither.
  Carry on, under the rules below.

Each prints the procedure for its mode.
Run it before you act, not after.

## Verbs

`card new '<headline>' [--label L]... [--blocked-by <id>]...`, body on stdin.
Draws an id, checks it against the open and closed cards, and writes the file, as one act.
Never choose an id, never create a new card's file by hand, and never create a skeleton to fill in afterwards — a card half-written is the failure this verb replaces.
Editing a card that already exists is ordinary and is done by hand.
The headline is an argument because a card has exactly one `# ` line and that line never wraps.

`card show <id>` prints a card wherever it is, and `card show <id> --path` prints the file's location instead, which is how you edit one.
Ids are cited bare, and a card changes directory when it closes, so never build a path out of an id.

`card list --ready [--label L]...` gives the open cards whose blockers have all closed, which is the first question of an execution session.
A blocker naming a card that exists nowhere is reported here rather than passed over.

`card close <id> --done|--promoted|--declined|--moot`, close note on stdin.
Moves the card and appends the close note as one act, and refuses to run on empty input.
Exactly one flag: the flag records what happened, and the prose carries why.
`--done` says the work is at rest where the card said it would be.
The other three all say the work never happened.
`--promoted`: the work went to a public ticket.
`--declined`: someone chose not to do the work, and the reasoning is live again if the tradeoff changes.
`--moot`: the reason the card existed is gone, and re-filing it would be an error — a card that turns out to duplicate another is moot, with the other card's id in the close note.

On any of those three the tool names the cards this one was blocking, which are about to look ready and are not.
A card can wait only on another card, never on a public ticket, so the deck cannot hold a dependent shut once its blocker is promoted out.
What happens to the named cards is the owner's decision, from four dispositions: fold them into the same public ticket; give them their own ticket that depends on it; decline them, because they only mattered if the blocker went a certain way; or re-examine them — the edge may have been overstated, and the card can simply be worked.

Write the close note for one reader: the next authoring session, sweeping the closed pile for prior art.
Say what was built and how it was verified, or what was decided against and why, or where the work went if it went somewhere else.
Name a public ticket key if the card has one — that still resolves in a year, where a commit sha dies at the next squash.

`card worktree <id>` cuts an isolated tree for a dispatched agent at `.worktrees/<id>`, on a temporary branch cut from the branch the main checkout is on, and prints the tree's path, then its branch with the base branch and sha it was cut from.
`card execute` says when to use it.

`card exec -- <cmd>` runs a command with the deck as the working directory.
The cards are plain markdown; grep them.

## Rules, in any mode

**Cite ids, never restate a card.**
`card show` reaches it.
A retelling in the conversation is a second copy, and it drifts from the first.

**File anything left undone as a card rather than doing it.**
Scope you notice mid-work is filed, not fixed.
That is the wanted outcome, not a concession.

**Put a finding that must survive into a card** — a new one, or a close note.
A finding that lives only in a transcript dies with the session.

**References are one-directional.**
Cards cite public keys — tickets, branches, commits — freely.
Nothing public ever cites a card id: not a commit message, not a pull request, not a comment in the code.
That rule is the whole privacy boundary.

**Dispatch the reading.**
Reading beyond what the card at hand names happens in dispatched subagents, and what must survive of what they find goes into a card, not into the transcript.
Exploring in the session that is landing a card is the failure mode.
Writing is that session's own only where `card execute` hands it over.
