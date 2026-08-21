# Authoring

Produce cards a cold agent can act on. This session does not change code.

## Sweep the closed pile first, before writing anything

    card exec -- rg -l '<term>' closed

A deferral too small for the public tier survives only as a closed card. An
authoring session that does not search the closed pile deletes it. Search for
the terms the new work turns on, and read what comes back with `card show`.
What you find is grounding to cite, not text to copy: a promoted or declined
card is already sitting there with its full reasoning, and the new card cites
it rather than restating it.

## Agree, then write

Discuss each observation to agreement before writing its card. Do not treat
your own answers as agreement. Write the card once the owner says that
observation is settled, then take the next one. A card that exists only in this
conversation does not exist.

Larger work arrives as a ticket, or as a planning document standing in for one.
Decompose it into cards, each carrying the ticket's key as a label. That label
is what lets two tickets share one deck and what hides a halted ticket's cards
for the duration.

## What a card carries

**Grounding.** File paths, symbol names, the command that shows it working as
this project runs it, and pointers to the spec sections or closed cards that
matter. Prefer a pointer over re-explaining what the next agent can re-derive
cheaply from a file you named.

**Intent.** What done looks like, what it is in service of, and which specifics
are load-bearing rather than incidental.

**Success criteria that are observable, never descriptive**: a test that fails
before the change and passes after, or a screenshot.

**Any conditional phrased over the decision it gates, not over the outcome you
expect.** "If X turns out to be false, record it in `<id>`" never fires when X
comes back true, and the decision it gated sits unmade. "Whatever the answer,
record what it means for `<id>`" fires either way and costs a word.

## Writing it

    card new 'One headline, never wrapped' --label PROJ-123 \
        --blocked-by PROJ-behilo <<'EOF'
    Body, wrapped at eighty columns, `##` for any subheading.
    EOF

The headline is the card's lead claim, not a vague title — specific enough to
stand on its own in a listing. Inside the body there is no template: no
required sections, nothing padded to fill a heading.

`--blocked-by` names only the cards this one waits on. The cold reader about to
start a card is the one who needs telling it is stuck; the reverse question,
what closing this unblocks, is a grep for the id and is never stored.

Labels are opaque strings the tool matches and never reasons about. Use them
for the ticket key, and for anything you will want to filter on later — the
machine a card can only be done on, for instance.

Sharpening a card already on disk is an ordinary edit to its file: `card show
<id> --path` gives you the location. Nothing rewrites a card because another
card changed.

## The test for a finished card

The next agent's first tool calls should be reads of things the card named. If
it opens with a codebase-wide grep, the card was underspecified.

## Filing one mid-work

Writing a card while you still have the context loaded: put the addresses in
now. The agent that picks it up starts cold.
