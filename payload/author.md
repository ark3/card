# Authoring

Produce cards a cold agent can act on. This session does not change code.

## Sweep the closed pile first, before writing anything

    card exec -- rg -l '<term>' closed

A deferral too small for the public tier survives only as a closed card, and
an authoring session that skips this search deletes it. Search for the terms
the new work turns on, and read what comes back with `card show`. What you
find is grounding to cite, not text to copy: a promoted or declined card is
already sitting there with its full reasoning, and the new card cites it
rather than restating it.

## Write, then flag

Write each card as its observation settles; do not hold cards back waiting
for the owner to approve each one. Where an observation is yours rather than
the owner's — something the ticket does not state, a judgment call you made —
flag it when you hand the cards back, so the owner sees the inference without
having been the gate on it. That flag is not optional, and a session with no
conversation to put it in puts it in its final output, which is that
session's hand-back. The asymmetry is what
decides this: a card the owner did not want costs one close, and closed cards
can be amended, while a finding not written is gone. When the owner is
present and still discovering what they want, authoring is a conversation —
keep listening. A card that exists only in this conversation does not exist.

Larger work arrives as a ticket, or as a planning document standing in for
one. Decompose it into cards, each carrying the ticket's key as a label. That
label is what lets two tickets share one deck and what hides a halted
ticket's cards for the duration.

## What a card carries

**Grounding.** File paths, symbol names, the command that shows the problem
as this project runs it, and pointers to the spec sections or closed cards
that matter. Address prose by a quoted phrase plus the section that holds it
— a line number may follow as decoration, never as the address, because lines
move and a stale line number still resolves, to the wrong text. Prefer a
pointer over re-explaining what the next agent can re-derive cheaply from a
file you named.

**Intent.** What done looks like, what the card is in service of, and which
specifics are load-bearing rather than incidental.

**Success criteria that are observable, never descriptive.** The observable
depends on what the card produces. A code change closes on a test that fails
before the change and passes after, cited by test file and by what it
asserts. A decision closes when it is taken and recorded where the next
person will look — the card names where, because the tool cannot know the
project. An investigation closes when its finding exists in something that
outlives the session. A description of the finished state is not a
criterion: it closes on an opinion.

**Any conditional phrased over the decision it gates, not over the outcome
you expect.** "If X turns out to be false, record it in `<id>`" never fires
when X comes back true, and the decision it gated sits unmade. "Whatever the
answer, record what it means for `<id>`" fires either way and costs a word.

## Writing it

    card new 'One headline, never wrapped' --label PROJ-123 \
        --blocked-by PROJ-behilo <<'EOF'
    Body, wrapped at eighty columns, `##` for any subheading.
    EOF

The headline is the card's lead claim, not a vague title — specific enough to
stand on its own in a listing. Inside the body there is no template: no
required sections, nothing padded to fill a heading.

`--blocked-by` names only the cards this one waits on. The cold agent about
to start a card is the one who needs telling it is stuck; the reverse
question, what closing this unblocks, is a grep for the id and is never
stored.

Labels are opaque strings the tool matches and never reasons about. Use them
for the ticket key, and for anything you will want to filter on later — the
machine a card can only be done on, for instance.

You sharpen a card already on disk by editing its file; `card show <id>
--path` prints the location. The tool never rewrites a card because another
card changed — a blocker closing alters nothing in the cards that were
waiting — so an amendment that another card's conditional calls for is yours
to make, deliberately.

## The test for a finished card

The next agent's first tool calls should be reads of things the card named,
and the card's addresses should survive the file being edited above them. If
that agent would open with a codebase-wide grep, the card was underspecified.
