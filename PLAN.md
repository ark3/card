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
about. Two sources:

1. `CARD_ROOT` in the environment, which wins outright.
2. `<git-common-dir>/card`, which is `.git/card/` in an ordinary checkout.

Both name a **card directory**, not a deck. It holds `card-config.toml`, which
carries the prefix and the deck's path. The deck is a directory holding `open/`
and `closed/`, and it sits at `deck/` beside the config unless the config says
otherwise. Outside a git repository, with `CARD_ROOT` unset, there is no deck
and nothing to report.

**A deck that does not exist is not created by resolution.** A repository with
no card directory yields "no deck here", which is what `status` reports and
what `init` answers. Only `init` creates anything.

**Living inside `.git/` is what makes the rest of this short.** Verified on
2026-08-21: `git status` and `git clean` never traverse `.git/`, so the deck is
invisible with no ignore rule written anywhere, and it survives `git clean
-xdf` and even `-xdff`. Nothing is added to the repository's `.gitignore` and
nothing is committed, so the brief's privacy boundary is untouched — what
matters is that the corpus never enters the repository's history, not which
directory it sits in. The hazard accepted in exchange is that `rm -rf .git`
now destroys the deck.

**Every worktree resolves to one deck structurally.** `git rev-parse
--path-format=absolute --git-common-dir` returns the main checkout's `.git`
from anywhere — a subdirectory, a worktree, or inside the deck itself — so the
careful keying this section used to require is gone. Verified on 2026-08-21,
including from inside `.worktrees/`. Two clones of one repository have two
`.git` directories and so two decks; that is accepted, because worktrees are
what this workflow cuts.

**The prefix is recorded in `card-config.toml`, never derived** from the
filenames present. Deriving it was agentpane's workaround for having no way to
create a deck, and it guesses wrong the day a deck holds a card copied in from
somewhere else.

**The deck path is relative to the card directory.** The default is `deck`; a
deck kept in the repository's own tree is `../../docs/work`. One rule, and no
scheme survives the data moving anyway. It is wrong inside a submodule, where
the card directory is `<super>/.git/modules/<name>/card` and `../../` lands in
`.git/modules` rather than the submodule's root — verified 2026-08-21. Only an
in-tree redirect inside a submodule is affected; the default is not.

**The deck carries `.ignore` holding `!*`.** Ripgrep and `fd` walk up from the
working directory and apply the repository's root `.gitignore`, so a repository
that ignores `*.md` or `open/` makes `card exec -- rg` find nothing. Verified
on 2026-08-21, and it applies to an in-tree deck's tracked files too. `.ignore`
beats `.gitignore` in both tools, and git never reads it.

**Agentpane needs no `CARD_ROOT`.** It gets an ordinary `.git/card/` whose
config points its deck at the committed `docs/work/`, which keeps the redirect
path honest with a real consumer and leaves agentpane's corpus the only one
anywhere with git history behind it. Card's own deck is the default, prefix
`card`. Its working cards are still absent from the public repository, which
holds the brief, the plan and the commit messages and nothing more.

## What a card is, after the brief's changes

```
---
labels: [PROJ-123, work-laptop]
blocked-by: [PROJ-behilo]
---

# One headline, never wrapped, the only `# ` line in the file.

Body, wrapped at eighty columns, `##` for any subheading.
```

Both frontmatter fields are lists, both may be absent, and the tool interprets
only `blocked-by`. Values are YAML flow sequences on a single line: one line
per field is what keeps `^labels:` a useful grep, and the bracket form is
valid YAML, so anything else that opens the deck reads a list rather than one
comma-laden string. No block sequences, no wrapping. Labels are opaque strings
it matches and never reasons about. `kind:` and `where:` are gone; the brief
says why.

Ids are `<PREFIX>-` plus three consonant-vowel syllables drawn at random, from
eighteen consonants and five vowels. `reference/tracking.md`, "Ids are drawn at
random", is the specification and carries the generator.

## Checkpoints

Vertical slice: build enough of each verb to walk one card through the whole
loop, then deepen. Each checkpoint below is a stop for trying it and
reassessing, not a deliverable — nothing is usable until the payload exists,
because until then nothing tells a session the verbs are there.

**1. Resolution and `init`.** Demonstrable when `init` creates a deck for this
repository — `card-config.toml` carrying a chosen prefix, the two directories,
and `.ignore` — a second `init` refuses rather than clobbering, and resolution
finds that deck from a subdirectory, from a worktree cut off this repo, and via
`CARD_ROOT` pointing somewhere else entirely. The prefix comes back in all of
those cases. Also when a repo with no card directory reports exactly that, a
`.git/card/` without `card-config.toml` is not mistaken for one, and a
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
by hand in the deck, including inside a repository whose root `.gitignore`
ignores `*.md` — which is what the deck's `.ignore` exists to defeat.

**6. `worktree`.** Cuts the tree into `.worktrees/` in the repo on a temporary
branch and reports the sha it started at. The base is the main checkout's
current branch, resolved explicitly rather than taken from `HEAD` — verified
2026-08-21 that cutting a worktree from inside another worktree follows that
worktree's HEAD instead, which would stack temporary branches on each other.
A detached HEAD in the main checkout has no base: stop and report. There is no
freshness step, because a tree cut from the current tip cannot be stale.
`reference/execute-skill.md` carries the procedure this replaces, including the
`git merge --ff-only main` this makes unnecessary.

`card worktree` writes `.worktrees/.gitignore` holding `*` before cutting the
first tree, so the directory hides itself and the tool relies on nothing
machine-level. Verified on 2026-08-21 that this keeps worktrees out of `git
status` even though each holds a `.git` file, and that `rg` inside a worktree
is unaffected. The `.worktrees` entry in `~/.config/git/ignore` becomes
belt-and-braces rather than the thing being depended on.

**7. `status`.** Probes the sandbox first and prints nothing else unless it
passes. The probe attempts to create a file in `$HOME`, which always exists
and is read-only whenever the sandbox is on: EROFS or EACCES means sandboxed
and `status` continues; success means the sandbox is off, so remove the file,
warn, and stop; any other error is inconclusive, which also warns and stops.
Three outcomes rather than two, because a probe path that is merely missing
must not read as a pass. Card reports the verdict and never describes the
sandbox's mounts — that description drifts from `sbox` and belongs in personal
instructions, which are on the same machine as the mount list. The rest is
thin at first — deck location, counts — and filled once the payload exists.

Then the payload and the two mode prompts, then a synthetic-ticket rehearsal:
fan a fake ticket into three cards, work one, decline one, promote one, so
that decline and promote are exercised before a real ticket leans on them.

This section is a stand-in for a deck. Once `init` runs, whichever checkpoints
are still open become cards and the section goes away, leaving `PLAN.md` with
only the settled decisions above it. That is card's first real use, and this
project's own bootstrap rather than a rehearsal.

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
- Resolution precedence: `CARD_ROOT` over `<git-common-dir>/card`.
- `exec` reaches the deck's files from a repository whose root `.gitignore`
  would otherwise hide them.

A test that has never failed has not been shown to test anything. For anything
that fixes a defect, watch it go red first.

## Deliberately not in this implementation

`check` and the rest of `list` are deferred in the brief and stay deferred.
Nothing Jira-shaped is built: no fan-in, no promote verb, no API. The tool
never commits, never pushes, never fetches — the sandbox has no SSH keys, so a
reflex `git fetch` only produces a confusing failure — and never edits a card
because another card changed — authors edit cards, the tool does not do it on
their behalf.
