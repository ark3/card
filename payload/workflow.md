# Workflow

You already hold a working model of an issue tracker; this chapter is the short list of ways this one differs, and little else.

## The deck

<!--private-->
The deck is this project's private, agent-facing tracker, standing beside whatever public record the project already keeps.
<!--/private-->
<!--public-->
The deck is this project's public, agent-facing tracker; there is no other record the work reports to.
<!--/public-->
The practice it carries is decomposition: a ticket breaks down into the smallest units that can each be implemented on their own, and each unit is one card.
A card is prose written for a cold agent, and the deck mandates no card sections: a card carries whatever its own work needs, in whatever shape holds that.
A card is also its own only copy: cite its id and let `card show` reach it, because a retelling in the conversation is a second copy, and it drifts from the first.

## The verbs

`card new '<headline>' [--label L]... [--blocked-by <id>]...`, body on stdin.
The tool draws an id, checks it against the open and closed cards, and writes the file, as one act: never choose an id, never create a new card's file by hand, and never create a skeleton to fill in afterwards — a card half-written is the failure this verb replaces.
The headline is an argument because a card has exactly one `# ` line, and that line never wraps.
Editing a card that already exists is ordinary, and you do it by hand.

`card show <id>` prints a card wherever it is, and `card show <id> --path` prints the file's location instead, which is how you edit one.
Ids are cited bare, and a card changes directory when it closes, so never build a path out of an id.

`card list [--open | --ready | --closed] [--label L]...`.
Bare or with `--open` it prints the open cards, a blocked one marked with the blockers it still waits on; `--ready` narrows that to the open cards whose blockers have all closed; `--closed` prints the closed cards; `--label` narrows any listing to the cards carrying every label given; every listing orders its cards by when each was last updated, most recent first, so the top line is the most recently touched card.
The listing reports a blocker naming a card that exists nowhere, rather than passing it over.

`card close <id> --done|--promoted|--declined|--moot`, close note on stdin.
The tool moves the card and appends the close note as one act, and refuses to run on empty input.
Exactly one flag: the flag records what happened, and the prose carries why.
`--done` says the work is at rest where the card said it would be; the other three all say the work never happened.
<!--private-->
`--promoted`: the work went to a public ticket.
<!--/private-->
<!--public-->
`--promoted`: the deck remains the tracker, and this flag marks the one exception — the work left the deck for an outside system the project answers to but does not control, an upstream project's issue queue or a customer's tracker.
On a deck with no such outside system beside it, `--promoted` never applies: work that outgrows a card becomes more cards.
<!--/public-->
`--declined`: someone chose not to do the work, and the reasoning is live again if the tradeoff changes.
`--moot`: the reason the card existed is gone, and re-filing it would be an error — a card that turns out to duplicate another is moot, with the other card's id in the close note.

On every close the tool names the cards this one was blocking: on `--done` this close is what they were waiting for, and on any of the other three they are about to look ready when they are not.
On `--done` the tool lists as freed only the cards no other open blocker still holds shut, and names the rest separately as still held shut; where that frees nothing, it says nothing came free.
<!--private-->
A card can wait only on another card, never on a public ticket, so once a blocker closes `--promoted` its dependents look ready even though the work they were waiting for is still open in the ticket.
<!--/private-->
<!--public-->
A card can wait only on another card, never on anything in the outside system, so once a blocker closes `--promoted` its dependents look ready even though the work they were waiting for is still open there.
<!--/public-->
What happens to the cards named on the other three is the owner's decision.
Two dispositions are open on any of the three: decline them, because they only mattered if the blocker went a certain way, or re-examine them — the edge may have been overstated, and the card can simply be worked.
<!--private-->
`--promoted` opens two more, because the work now has a public ticket: fold them into that ticket, or give them their own ticket that depends on it.
<!--/private-->
<!--public-->
`--promoted` opens two more, because the work now lives in the outside system: fold them into what went there, or give them an entry of their own there that depends on it.
<!--/public-->

Write the close note for one reader: the next authoring session, sweeping the closed pile for prior art.
Say what was built and how it was verified, or what was decided against and why, or where the work went if it went somewhere else.
Name a public ticket key if the card has one — that still resolves in a year, where a commit sha dies at the next squash.

`card worktree <id>` cuts an isolated tree for a dispatched agent at `.worktrees/<id>`, on a temporary branch cut from the branch the main checkout is on, and prints the tree's path, then its branch with the base branch and sha it was cut from.
`card execute` says when to use it.

`card cmd -- <command>` runs a command with the deck as the working directory.
The cards are plain markdown; grep them.

## References

<!--private-->
Cards cite public keys — tickets, branches, commits — freely, but nothing public ever cites a card id: not a commit message, not a pull request, not a comment in the code.
That one-way rule is the whole privacy boundary, and prose alone does not hold it, because "Fixes <id>" is the reflex every tracker before this one has trained into a committer; a verb holds it instead.
Run every commit message through `card lint-commit`, message on stdin, before the commit carrying it lands: the verb fails when the message cites a card id, naming each one.
<!--/private-->
<!--public-->
References run both ways on this deck: cards cite tickets, branches and commits freely, and the deck is public, so a commit message, a pull request or a comment in the code cites a card id just as freely.
`card lint-commit` exists for the boundary a private deck keeps, and nothing here mandates it.
<!--/public-->

## Findings

When a finding worth keeping surfaces mid-work, file it as a card with `card new` — headline as the argument, body on stdin — before your turn ends.
A finding that lives only in the transcript dies with the session.
Undone work is the same case: file scope you notice mid-work as a card rather than fixing it, which is the wanted outcome, not a concession.
A filed card is out of your hands and off your mind, and the session stays on the work in front of it.
Filing is also what makes ending a session cheap: a card is permission to put something down.

## Dispatch the reading

Reading beyond what the card at hand names happens in dispatched subagents, and what must survive of what they find goes into a card, not into the transcript.
This protects the session's room to review: exploring in the session that is landing a card is the failure mode.
Writing is that session's own only where `card execute` hands it over.

## Onward

Writing or sharpening cards is `card author`'s procedure, and landing a card that already exists is `card execute`'s.
Each verb prints its own procedure; run the one for the work in front of you before you start it.
