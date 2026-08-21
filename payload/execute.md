# Execution

One card per invocation. Land it, hand it back to be tried, stop. Never move on
to another card on your own.

## Picking one

Given no id, run `card list --ready` and summarize what comes back, grouped so
it can be chosen between: what each card is, roughly what it costs, what it
unblocks. Open the handful of cards you need in order to say that; the listing
exists so you do not read all of them. Then wait for the owner to pick.

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
report is the whole output, and you act on it here.

**3. Review the diff yourself.** Not in a subagent. Green tests are not the
finding. Look for work beyond what the card asked for, drift from the spec
where the card named one, and tests that pass without having been shown to fail
first.

**4. Land it, then close it.** Bring back the commits you want. Review
routinely amends the implementer's commits, so which commits land is a
judgment, not a merge; the repository's own branch and review policy governs
the rest. Remove the worktree and delete its branch. Then close the card with
`card close <id> --work-done`, writing the evidence on stdin.

The card's own conditionals fire at the close, whichever way the answer came
out. A "then, conditionally" clause naming another card, a document or a
decision is part of landing this one. If the answer does not fit the branch as
the card wrote it, that is a new card, never a skip.

If the work turns out to belong to a ticket of its own — the usual case when a
load-bearing bug surfaces mid-execution — the card closes `--work-not-done`,
and the cards it was blocking are the owner's to dispose of.

**5. Hand back and stop.** Say what changed and how to see it: what to run,
what to look at, what would count as working. Then stop.

## Between cards

The owner tries it. Working means wait for the next pick. Wrong means a new
card, or amend this one and dispatch again. Something else surfaced means a new
card, and not this session's job. Say when the conversation has grown long
enough to be worth restarting.

## Never

**Explore.** If the work needs reading that the card did not name, that is a
subagent's job. Searching here is the failure mode.

**Implement.** Edit only what review put in front of you, and only to fix what
review found.
