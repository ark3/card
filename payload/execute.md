# Execution

The owner hands you a set of cards, sometimes one.
Work them in order: close each card you can, stop at the first you cannot, then hand back what came of them.
Never pick the next card yourself — which work comes next is the owner's call, and working through a set the owner picked is not picking for yourself.

## Picking the set

Given no id, run `card list --ready` and summarize what comes back, grouped so the owner can choose: what each card is, roughly what it costs, what it unblocks.
Open the few cards you need in order to write that summary; the listing exists so you do not read all of them.
Then wait for the owner to pick.
The answer may be one id or several.

## Working one card

You dispatch the work in one of two shapes, and the shape decides what the agent gets:

- **An implementer** writes the card's change in a worktree of its own and commits there.
- **A reader** reads and reports and writes nothing.
  A reader dispatched before the work starts is a cold read; one dispatched at finished work is the adversarial check.
  The dispatching session acts on a reader's report in the main checkout: where the card asked for a document, a decision or a finding, acting on the report means that session writes it.

A card gets at most one implementer — two implementers means two diffs and no single review — and as many readers as the work is worth, before it or after.
Dispatch one agent at a time, and review what it sent back before you decide the next dispatch: a dispatch nobody reviewed is work nobody checked.

**1. Check the card against the source.**
  The card was written by whoever found the problem and has not been re-verified since, and the code may have moved under it — most of all in a codebase this workflow does not control.
  Confirm that the paths, symbols and claims the card names still hold.
  Where they have drifted, amend the card yourself and say what you changed: never work a card as written once it has drifted, and never stop for an amendment you can make — amendable staleness is routine, not an obstacle.
  Drift large enough to kill the card's intent is not an amendment at all: skip dispatch and review and take that card straight to step 4, where you close it for what the drift made it — `--moot` where the problem it named is gone, `--promoted` where the real work outgrew the card.

**2. Dispatch.**
  The reading is not yours to do: the card is the handoff, and a session that does its own reading has no room left to review what comes back.

An implementer gets a worktree from `card worktree <id>`.
A reader gets no worktree, no branch and nothing to commit.
Both start cold, so anything you leave out of the dispatch prompt is lost.
The prompt carries:

- the briefing below for the agent's shape, verbatim — everything between its fences;
- for an implementer, the worktree's path and branch as `card worktree` printed them;
- the project's own instructions, which are yours to hand over;
- the card's grounding and intent inline — paths, symbols, how to run it, what done looks like — pointing the agent at that one card and nothing else in the deck;
- every constraint you hold only from conversation: a repository not to touch, a freeze, fixtures holding customer data.
  Those constraints bind the agent as they bind you, and nothing but your prompt carries them across.

The implementer's briefing:

```
You are a dispatched implementer, working exactly one card in the worktree named in this prompt.
Commit on the worktree's branch, never on the base branch.
Do not read the deck, and do not take on work beyond this card.
Nothing public ever cites a card id: the id in your worktree path and branch name stays out of your commit messages, your code and your comments — never write "Fixes <id>".
Report anything you noticed and did not do; filing cards is the dispatching session's job, not yours.
```

The reader's briefing:

```
You are a dispatched reader, answering exactly one question.
Read only: write nothing, commit nothing, change nothing.
Do not read the deck, and do not take on work beyond what this prompt asks.
Your report is your whole output, so put everything you found in it.
```

The dispatching session stays in the main checkout; the briefing's "never on the base branch" binds the implementer it is addressed to, and step 4 is where the dispatching session commits.

**3. Review what came back, yourself.**
  The judgment is never a subagent's — dispatching a reader is not delegating the judgment, which stays yours.
  Neither a report nor a green test is the finding: check what is claimed against the change itself and against the code it ran.
  Confirming a claim is review, however far the check reaches, and a claim you cannot confirm is itself a finding.
  Look for work beyond what the card asked, drift from a spec the card named, and tests that pass without having been shown to fail first.

Where the dispatching session wrote the change itself off a reader's report, there is no diff and no second mind has seen the work, and a session's own reading of its own writing is the weakest review there is.
Dispatch the adversarial check at what was written, and review that report the same way.

**4. Land it, then close it.**
  Execution ends with the work at rest where the card said it would be.
  Where the card named a file in this repo — code, a document, a test — at rest means committed on the branch the main checkout is on.
  Where the card's result is a finding and nothing else, at rest means the close note carries the finding in full: a note that points at a transcript loses it.

The dispatching session is the one that commits here, and the only one:

- An implementer's commits come back by that session's hand.
  Review routinely amends them, so which commits land is a judgment, not a merge.
  That session then removes the worktree and deletes its branch.
- What that session wrote itself off a reader's report, it commits in the main checkout.
  Nothing else in the procedure will.

Then discharge the card's conditionals, before the close and not after.
A "then, conditionally" clause naming another card, a document or a decision is part of landing this card, and it fires whichever way the card's own question came out, not only the way you expected.
What the clause calls for comes to rest first: the card filed, the document written and committed here.
An answer that fits neither branch of the card's conditional is a new card, never a skip.

Only then close, writing the close note on stdin: `card close <id> --done` where the work is at rest, and otherwise the flag that says how the card ended — `--promoted` where the work went to a ticket of its own, the usual case when a load-bearing bug surfaces mid-execution, and the public ticket itself is the owner's to file, never this session's; `--declined` where it was decided against; `--moot` where the reason for it is gone.
On every close the tool names the cards this one was blocking.
On `--done` they have just come free: they belong in the hand-back, not in this session's work, because which card comes next is the owner's call.
On the other three they are about to look ready and are not: they belong in the hand-back too, and their disposition is the owner's, not yours.

**5. Hand back.**
  Say what changed and how to see it: what to run, what to look at, what would count as working.
  Say it for each card as that card closes, so the owner can try the early ones while you work the rest.
  Stop after the last card in the set, and at the first card you cannot close.

## Filing one

Wherever this procedure sends you to a new card rather than to work — a conditional whose answer fits neither branch, or something that surfaced and is not this session's job, most often a load-bearing bug that will deserve a ticket of its own — you hold the context and the agent that picks the card up starts cold.
Write the addresses in now: file paths, symbol names, the command that shows the problem as this project runs it, the closed cards and spec sections that bear on it.
Address prose by a quoted phrase plus the section that holds it — a line number may follow as decoration, never as the address, because lines move and a stale line number still resolves, to the wrong text.
If the next agent would have to open with a codebase-wide grep, the card was underspecified.

Say what the card is in service of, and which of the specifics are load-bearing rather than incidental; you know that now and the picker will not.
State what done looks like as something observable — a test that goes red first and green after, a command whose output changes, a decision recorded in a named place — never as a description of the finished state, which closes on an opinion.
Phrase any conditional over the decision it gates, never over the answer you expect: "if X turns out to be false, record it in `<id>`" never fires when X comes back true, and the decision it gated sits unmade.

Filing is not a discussion.
You found it mid-work: write the card where you stand and go on with the procedure.
The owner sees what you filed in the hand-back, and a card the owner did not want costs one close.

## Between cards

Whether you carry on is gated on the card's done-condition, not on the card.
Where the card names an observable you can run — a test that goes red first and green after — running it clean is what closes the card: finish step 4, then go straight on to the next card in the set.
Where the done-condition is a judgment or a decision only the owner can make, hand back and stop there, whatever else is in the set: a reader you dispatch is not the owner and cannot stand in.

A set also ends early on a genuine obstacle: an observable that will not go green, drift that kills a card's intent, work that belongs to a ticket of its own, something that surfaces and changes a later card in the set, or your own context running short — say, a conversation grown long enough to be worth restarting.
A card you amended under step 1 and carried through is none of these: amendable staleness never ends a set.
Aborting costs the owner a full round trip, so the bar is a genuine obstacle and not your own unease.
An over-cautious abort is the expensive failure here, and there is always an excuse available for one.

At the end of the set the owner tries what came back.
Working means wait for the next pick.
Wrong means a new card, or this one amended and dispatched again.
Something else surfaced means a new card, and not this session's job.

## Never

**Explore.**
Reading the card did not name is a dispatched reader's job, and going looking for work the card did not name is the failure this rule protects against.
Steps 1 and 3 are not exploring: checking the card against the source and confirming what a subagent reported are review, and review is yours.

**Implement.**
The card's code is an implementer's to write, never the dispatching session's: that session edits only what review put in front of it, and only to fix what review found.
Writing up what a reader reported, amending a card, and the throwaway harness a check itself needs are not implementing.
