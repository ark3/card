# card — implementation plan

`BRIEF.md` records what card is and why. This document records how the first
implementation gets built: the decisions that are settled but are not design
rationale, what each checkpoint has to demonstrate, and what is deliberately
left out. Where the two disagree, the brief wins and this file is stale.

Written 2026-08-21, from a design conversation whose reasoning is in the brief.
`reference/` holds the agentpane documents the workflow is carried from; read
those rather than having them restated here.

## Runtime and shape

TypeScript on Bun, matching agentpane so there is one toolchain between the two
projects. Bun 1.3.14 is what is installed on the home server. Tests are Bun's
own runner.

No dependencies. Everything needed is in Bun: `Bun.TOML.parse` for config,
`Bun.spawn` for git, `Bun.stdin` for card bodies. Confirmed by hand on
2026-08-21 rather than assumed — `Bun.TOML.parse("[decks]\n\"/a\" = \"/b\"\n")`
returns the nested object.

The tool has to be runnable from a work laptop and a home server with nothing
built first, and from inside a dispatched agent's worktree. Keep it to one
entry point and a small module per verb; do not add a build step unless
something forces one.

## Deck resolution

This is the capability the tool exists for, so it is the part worth being exact
about. Three sources, in order:

1. `CARD_ROOT` in the environment, which wins outright. This is what lets a
   dispatched agent be told where the deck is without inheriting anything.
2. An entry for this repository in `~/.config/card/config.toml`, honouring
   `XDG_CONFIG_HOME`. This is what points agentpane's deck at `docs/work/`
   inside its own repo, and what handles any deck that is not where the
   convention would put it.
3. The convention: `~/.local/share/card/decks/<name>/`, honouring
   `XDG_DATA_HOME`.

**A deck that does not exist is not created by resolution.** Falling through to
the convention path yields "no deck here", which is what `status` reports and
what `init` answers. Only `init` creates anything.

**A deck is a directory holding `open/`, `closed/`, and `deck.toml`.** That
file carries one key, the prefix, and its presence is what tells a deck from a
directory that happens to sit where a deck would. The prefix lives there rather
than in user config because a deck reached through `CARD_ROOT` arrives as a
bare path with nothing else supplied, and the agent holding it still has to be
able to name a new card.

**User config has one job**: pointing at decks that are not where the
convention would put them. A conventional deck needs no entry at all.
Agentpane's `docs/work/` is the only entry that exists today; card's own deck
is conventional, at `~/.local/share/card/decks/card/`, prefix `card`.

**Repository identity is the main checkout's root, not the working directory.**
Verified on 2026-08-21: inside a worktree, `git rev-parse --show-toplevel`
returns the worktree's own path, so keying on it gives a worktree its own deck
and silently splits the corpus. `git rev-parse --path-format=absolute
--git-common-dir` returns the main checkout's `.git`, whose parent is the
repository root. Key the config on that absolute path; take `<name>` for the
convention from its basename.

Outside a git repository at all, there is no deck and nothing to report.

## What a card is, after the brief's changes

```
---
labels: PROJ-123, work-laptop
blocked-by: PROJ-behilo
---

# One headline, never wrapped, the only `# ` line in the file.

Body, wrapped at eighty columns, `##` for any subheading.
```

Both frontmatter fields are lists, both may be absent, and the tool interprets
only `blocked-by`. Labels are opaque strings it matches and never reasons
about. `kind:` and `where:` are gone; the brief says why.

Ids are `<PREFIX>-` plus three consonant-vowel syllables drawn at random, from
eighteen consonants and five vowels. `reference/tracking.md`, "Ids are drawn at
random", is the specification and carries the generator.

## Checkpoints

Vertical slice: build enough of each verb to walk one card through the whole
loop, then deepen. Each checkpoint below is a stop for trying it and
reassessing, not a deliverable — nothing is usable until the payload exists,
because until then nothing tells a session the verbs are there.

**1. Resolution and `init`.** Demonstrable when `init` creates a deck for this
repository — the two directories and `deck.toml` carrying a chosen prefix — a
second `init` refuses rather than clobbering, and resolution finds that deck
from a subdirectory, from a worktree cut off this repo, and via `CARD_ROOT`
pointing somewhere else entirely. The prefix comes back from the deck in all of
those cases, including the `CARD_ROOT` one, where user config is never
consulted. Also when a repo with no deck reports exactly that, a directory at
the convention path without `deck.toml` is not mistaken for a deck, and a
directory outside any repo reports nothing at all.

**2. `new` and `show`.** `new` takes the headline as an argument, the body on
stdin, and any number of `--label` and `--blocked-by` values; it draws an id,
checks it against both directories, and creates the file exclusively, in one
step that cannot be half-done. `show` resolves a bare id against both
directories. Demonstrable when a forced collision fails rather than overwrites,
when an id already in `closed/` is not reused, and when `show` finds a card
that has closed since it was cited.

**3. `list --ready`.** Open cards whose blockers are all in `closed/`, narrowed
by labels the caller passes. Demonstrable when a card blocked by an open card
is absent, the same card appears once its blocker moves to `closed/`, a label
filter includes and excludes the right cards, and a blocker naming an id that
exists in neither directory is reported rather than silently treated as
satisfied.

**4. `close`.** Moves the card and appends the explanation, read from stdin as
a card body is, in one act; it refuses to run on empty input. It is told
separately whether the work actually got done, and when it did not, it names
the cards that were blocked by this one — they are about to look ready and are
not. Demonstrable when a close with nothing on stdin fails, when an interrupted
close leaves neither a card in `closed/` without its explanation nor an
explanation on a card still in `open/`, and when promoting a card with two
dependents names both.

**5. `exec`.** Runs a command with the deck as the working directory, passing
through arguments, stdout, stderr, and exit status unaltered. Demonstrable when
`card exec -- rg '^blocked-by:' open` behaves exactly as the same command run
by hand in the deck.

**6. `worktree`.** Cuts the tree into `.worktrees/` in the repo, fast-forwards
to local main, reports the sha it started at. Nothing project-specific runs, so
no verb reads per-project settings and card has none. A failed fast-forward
stops and reports; it is never forced. `reference/execute-skill.md` carries the
procedure this replaces.

`.worktrees/` is safe inside a corporate repo only because `.worktrees` is
ignored globally, in `~/.config/git/ignore` — a machine-level fact, not
something the repo or the tool guarantees. That file travels between the
owner's machines; one without it would leave agent worktrees showing up as
untracked in a repo they must never be committed to.

**7. `status`.** Thin at first — sandbox probe, deck location, counts — and
filled once the payload exists. A failed sandbox probe warns and stops the
session rather than continuing unsandboxed.

Then the payload and the two mode prompts, then the synthetic-ticket rehearsal
the brief's sequencing describes.

## Verifying

Tests build a throwaway git repository and a throwaway deck per test, in a temp
directory, and never touch a real deck or this repo's own history. The
behaviours worth pinning are the ones agentpane was burned by or the ones this
design turns on:

- `new` cannot overwrite an existing card, even under a forced collision, and
  checks `closed/` as well as `open/`. This is the OW-70/OW-71 incident.
- `close` cannot leave a half-finished state.
- The ready query joins across both directories, and dangling blockers surface.
- A worktree resolves to its repository's deck, not to one of its own.
- Resolution precedence: `CARD_ROOT` over config over convention.

A test that has never failed has not been shown to test anything. For anything
that fixes a defect, watch it go red first.

## Deliberately not in this implementation

`check` and the rest of `list` are deferred in the brief and stay deferred.
Nothing Jira-shaped is built: no fan-in, no promote verb, no API. The tool
never commits, never pushes, and never edits a card because another card
changed — authors edit cards, the tool does not do it on their behalf.

## Open

- What the sandbox probe actually checks. `status` runs it first, a failure
  stops the session, and it is the one part of `status` that is useful in a
  repo with no deck — but its content is written down nowhere here, nowhere in
  `reference/`, and no longer in the owner's personal instructions. Checkpoint
  7 cannot be built until that text arrives.
