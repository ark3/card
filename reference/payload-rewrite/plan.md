# Payload rewrite — plan

Written 2026-08-22, from a conversation with the owner. This file governs one
effort: rewriting the three payload files from a rule inventory. When the
effort is done, this file and the inventory beside it are historic artifacts.
The rewritten payload is authoritative; nothing regenerates it from the
inventory afterwards.

## Why

The payload has been growing by incident-driven patches: a session misreads a
sentence, a card records the misreading, a commit patches that sentence. The
closed pile shows the misreadings fall into a small set of prose bug classes —
agentless passives that leave a rule without a subject, one concept under two
names and two concepts under one name, rules stated far from where they bind,
imperatives buried in subordinate clauses, and a contradiction between a rule's
plain form and its exceptions. Each patch is written in the same register that
produced the bug, so patches keep shipping the next defect. The fix is a
rewrite into a plain register, not more patches.

Two structural problems ride along and get fixed by the same rewrite:

- Rules that bind a dispatched agent live in files the dispatched agent never
  reads, relayed by paraphrase. Those rules move to a briefing file handed to
  the agent verbatim.
- The rule that nothing public cites a card id is prose against a trained
  reflex. It becomes a commit-msg hook installed by `card worktree`.

## The process

**1. Build the inventory.** One inventory across all three payload files, plus
a column for where BRIEF.md restates a rule. Each entry carries: an explicit
subject, the imperative, where in the procedure it binds, the current source
lines, and the card or cards that put it there. Build it by translating the
existing prose rule by rule; where the prose is ambiguous, the entry records a
decision to be made, not a guess.

Verify completeness both ways against the deck: every closed card's fix
appears as an entry or as a recorded deliberate drop, and every open card
about payload prose resolves to an entry or a flagged decision. Anything
unaccounted for is a regression waiting to happen.

**2. Decisions checkpoint.** The flagged decisions go to the owner before any
rewriting. Deck actions surfaced by the inventory — cards mooted, cards to
file — also wait for this checkpoint; the deck is touched only with the
owner's say-so during this effort.

**3. Rewrite from the inventory.** Plain register throughout: every imperative
has an explicit subject, one term per concept and one concept per term, each
rule stated at the point where it binds. The file split falls out of the
inventory's who-does-this-bind column rather than being inherited from the
current files; a briefing file for dispatched agents is expected to
materialize this way. Where BRIEF.md restates a rule, the restatement becomes
a citation or is reconciled; the brief itself is not rewritten.

Verify by replaying the deck: for each closed card, check that the misreading
it reported cannot be produced from the new text; for each open payload card,
check that the new text resolves it.

**4. Register spec.** Written into a new AGENTS.md at the repo root, binding
the payload files specifically — not BRIEF.md, not close notes. This is what
keeps future patches from regenerating the bug classes.

**5. The hook.** `card worktree` installs a commit-msg hook in the tree it
cuts, rejecting messages that contain a card id. Test goes red first.

## Ground rules for the effort

The work runs old-school, in conversation with the owner, not through the
payload's own execute procedure — the procedure under rewrite is not sound
enough to drive its own repair. The tool's verbs are still used as a filing
cabinet: work that surfaces and is deferred becomes a card, cards the
inventory moots get closed, each with the owner's say-so.

The committed artifacts of this effort must respect the one-directional rule
the same as any commit: whether the inventory may cite card ids when it lands
in `reference/` is itself a checkpoint decision, and until then the working
inventory stays uncommitted.
