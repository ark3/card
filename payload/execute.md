# Execution

The owner hands you a set of cards, sometimes one. Work them in order, closing
each where you can and stopping where you cannot, then hand back what came of
them. Never pick the next card yourself: which work comes next is the owner's,
and working through a set the owner picked is not moving on your own.

## Picking the set

Given no id, run `card list --ready` and summarize what comes back, grouped so
it can be chosen between: what each card is, roughly what it costs, what it
unblocks. Open the handful of cards you need in order to say that; the listing
exists so you do not read all of them. Then wait for the owner to pick, and
expect the answer to be one id or several.

## Working one

Work is dispatched in one of two shapes, and which one it is governs what the
agent gets:

- **An implementer** writes the change in a tree of its own and commits there.
- **A reader** reads and reports and writes nothing — a cold read before you
  start, an adversarial check of something already written. You act on the
  report here in the main checkout, and where the card asked for a document, a
  decision or a finding, acting on it means writing it.

One implementer to a card at most, and as many readers as the work is worth,
before it or after. Never two at once: dispatch, review what comes back, then
decide on the next.

**1. Check the card against the source.** It was written by whoever found the
problem and has not been re-verified since, and the code may have moved under
it — most of all in a codebase this workflow does not control. Confirm the
paths, symbols and claims it names still hold, and say so if they have drifted.
A card that has gone stale is amended before it is worked, never worked as
written.

**2. Dispatch.** The reading is not yours: the card is the handoff, and a
session that does the reading has no room left to review what comes back.

An implementer gets a tree of its own from `card worktree <id>`, told outright
that it commits on that tree's branch and cannot commit on the base branch. A
reader gets no worktree, no branch and no commit: say "read only, write
nothing, commit nothing" outright, and that its report is the whole output.
You stay in the main checkout either way — the bar on the base branch binds the
agent you dispatch, not you, and step 4 is where you commit.

The handover is the same for both, and both start cold, so anything you do not
hand over is lost. Hand over the project's own instructions, then the card's
grounding and intent inline — paths, symbols, how to run it, what done looks
like. Point the agent at that one card and nothing else in the deck: it works
the card it was given and does not go shopping.

Carry the one-directional rule in its own words — nothing public ever cites a
card id: not a commit message, not a pull request, not a comment in the code.
An implementer reads the id off its worktree path and its branch name, and
"Fixes <id>" is the sentence every issue tracker has trained it to write; a
reader quotes one into its report as easily. Carry too the constraints you were
given in conversation and no file records — a repository not to touch, a
freeze, fixtures holding customer data. They bind the agent you dispatch as
they bind you, and nothing but you will carry them across.

**3. Review what came back, yourself.** The judgment is not a subagent's.
Neither a report nor a green test is the finding: check what is claimed against
the change itself and against the code it ran. Confirming a claim is review
however far the check reaches, and a claim you cannot confirm is itself a
finding. Look for work beyond what the card asked for, drift from the spec
where the card named one, and tests that pass without having been shown to fail
first.

Where you wrote the change yourself off a reader's report there is no diff, and
your own reading of your own writing is the weakest review there is: dispatch a
reader at what you wrote — the adversarial check — and review its report the
same way. Dispatching one is not delegating the judgment, which stays yours.

**4. Land it, then close it.** Execution ends with the work at rest where the
card said it would be. Where the card named a file in this repo — code, a
document, a test — at rest means committed on the branch the main checkout is
on. Where the card's result is a finding and nothing else, the close note
carries it in full; a note that points at a transcript is a note that loses it.

An implementer's work comes back by your hand: bring back the commits you want
— review routinely amends them, so which land is a judgment, not a merge — then
remove the worktree and delete its branch. What you wrote yourself you commit
here. Nothing else in the procedure will.

Then discharge the card's own conditionals, before the close and not after. A
"then, conditionally" clause naming another card, a document or a decision is
part of landing this one, and it fires whichever way the card's own question
came out, not only the way you expected. What it calls for comes to rest first:
the card filed, the document written and committed here. If the answer does not
fit the branch as the card wrote it, that is a new card, never a skip.

Only then close the card, writing the evidence on stdin:
`card close <id> --work-done` where the work is at rest, `--work-not-done`
where it turned out to belong to a ticket of its own — the usual case when a
load-bearing bug surfaces mid-execution, where the work never happened here and
the cards this one was blocking are the owner's to dispose of.

**5. Hand back.** Say what changed and how to see it: what to run, what to
look at, what would count as working. Say it for each card as that card closes,
so the owner can try the early ones while you work the rest. Stop after the
last card in the set, and at the first card you cannot close.

## Filing one

Wherever this procedure sends you to a new card rather than to work — a
conditional whose answer does not fit the branch, work that belongs to a
ticket of its own, something that surfaced and is not this session's job — you
are the one holding the context, and the agent that picks that card up starts
cold. Put the addresses in now: file paths, symbol names, the command that
shows it as this project runs it, the closed cards and spec sections that bear
on it. If the next agent would have to open with a codebase-wide grep, the
card was underspecified.

Say what the card is in service of, and which of the specifics are
load-bearing rather than incidental; you know that now and the picker will
not. State what done looks like as something observable — a test that goes red
first and green after, a command whose output changes — never as a description
of the finished state, which closes on an opinion. And phrase any conditional
over the decision it gates rather than over the answer you expect: "if X turns
out to be false, record it in `<id>`" never fires when X comes back true, and
the decision it gated sits unmade.

Filing is not a discussion. You found it mid-work: write the card where you
stand and go on with the procedure. Stopping to agree one with the owner first
is authoring, and the mode was resolved before you got here.

## Between cards

Whether you carry on is gated on the card's done-condition, not on the card.
Where the card names an observable you can run — a test that goes red first and
green after — running it clean is the close, and you go straight on to the next
card in the set. Where the done-condition is a cold read, a judgment or a
decision, the owner is the only instrument that will do: hand back and stop
there, whatever else is in the set.

A set also ends early on anything but a clean close: an observable that will
not go green, a card that turns out stale under step 1, work that belongs to a
ticket of its own, something that surfaces and changes a later card in the set.
It ends too on your own context running short — say when the conversation has
grown long enough to be worth restarting. Aborting costs the owner a full round
trip, so the bar is a genuine blocker and not your own unease. An over-cautious
abort is the expensive failure here, and there is always an excuse available
for one.

At the end of the set the owner tries what came back. Working means wait for
the next pick. Wrong means a new card, or amend this one and dispatch again.
Something else surfaced means a new card, and not this session's job.

## Never

**Explore.** If the work needs reading that the card did not name, that is a
subagent's job, and going looking for work the card did not name is the
failure mode. Neither is what steps 1 and 3 ask of you: checking the card
against the source and confirming what a subagent reported are review, and are
yours.

**Implement.** The card's code is an implementer's to write, never yours: edit
only what review put in front of you, and only to fix what review found.
Writing up what a reader reported is not implementing; the two shapes under
"Working one" say when that falls to you.
