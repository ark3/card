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

**1. Check the card against the source.** It was written by whoever found the
problem and has not been re-verified since, and the code may have moved under
it — most of all in a codebase this workflow does not control. Confirm the
paths, symbols and claims it names still hold, and say so if they have drifted.
A card that has gone stale is amended before it is worked, never worked as
written.

**2. Dispatch one subagent.** Not yourself: the card is the handoff, and a
session that does the reading has no room left to review what comes back.

If it writes code, give it a tree of its own from `card worktree <id>`, and
tell it outright that it commits on that tree's branch and cannot commit on the
base branch. Then the project's own instructions, which it does not inherit.
Then the card's grounding and intent inline — paths, symbols, how to run it,
what done looks like. Point it at that one card and nothing else in the deck:
it works the card it was given and does not go shopping.

If it only reads and reports — a cold read of a card before you start it, an
adversarial check of something already written — it gets no worktree, no branch
and no commit. Say "read only, write nothing, commit nothing" outright. Its
report is the whole output, and you act on it here. Either way you stay in the
main checkout: the bar on the base branch binds the agent you dispatch, not
you, and step 4 is where you commit.

**3. Review the diff yourself.** Not in a subagent. Green tests are not the
finding. Look for work beyond what the card asked for, drift from the spec
where the card named one, and tests that pass without having been shown to fail
first.

**4. Land it, then close it.** Execution ends with the work at rest where the
card said it would be, and a `--work-done` close is the claim that it is there.
Where the card named a file in this repo — code, a document, a test — at rest
means committed on the branch the main checkout is on. Where the card's result
is a finding and nothing else, the close note carries it in full; a note that
points at a transcript is a note that loses it.

Where a subagent worked in a tree, bring back the commits you want. Review
routinely amends the implementer's commits, so which commits land is a
judgment, not a merge. Then remove the worktree and delete its branch.

Where the file was written here instead — a decision, a document, anything a
read-only dispatch reported back for you to write — commit it here. Nothing
else in the procedure will.

Then close the card with `card close <id> --work-done`, writing the evidence on
stdin.

The card's own conditionals fire at the close, whichever way the answer came
out. A "then, conditionally" clause naming another card, a document or a
decision is part of landing this one. If the answer does not fit the branch as
the card wrote it, that is a new card, never a skip.

If the work turns out to belong to a ticket of its own — the usual case when a
load-bearing bug surfaces mid-execution — the card closes `--work-not-done`,
and the cards it was blocking are the owner's to dispose of.

**5. Hand back.** Say what changed and how to see it: what to run, what to
look at, what would count as working. Say it for each card as that card closes,
so the owner can try the early ones while you work the rest. Stop after the
last card in the set, and at the first card you cannot close.

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
subagent's job. Searching here is the failure mode.

**Implement.** Edit only what review put in front of you, and only to fix what
review found.
