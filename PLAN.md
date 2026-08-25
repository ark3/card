# card — implementation plan

`BRIEF.md` records what card is and why.
This document records how the first implementation gets built: the decisions that are settled but are not design rationale, and what is deliberately left out.
Where the two disagree, the brief wins and this file is stale.

Written 2026-08-21, from a design conversation whose reasoning is in the brief.
`reference/` holds the agentpane documents the workflow is carried from; read those rather than having them restated here.

## Runtime and shape

TypeScript on Bun, matching agentpane so there is one toolchain between the two projects.
Bun 1.3.14 is what is installed on the home server.
Tests are Bun's own runner.

No dependencies.
Everything needed is in Bun: `Bun.TOML.parse` for config, `Bun.spawn` for git, `Bun.stdin` for card bodies.
Confirmed by hand on 2026-08-21 rather than assumed — `Bun.TOML.parse("[decks]\n\"/a\" = \"/b\"\n")` returns the nested object.

The tool has to be runnable from a work laptop and a home server with nothing built first, and from inside a dispatched agent's worktree.
Keep it to one entry point and a small module per verb; do not add a build step unless something forces one.

`check` runs the tests and then `tsc --noEmit`; settled 2026-08-24.
Bun strips annotations rather than checking them, so the annotations are load-bearing in review, and the checker is what makes them true on lines tests never execute.
The no-dependencies rule guards runtime simplicity and clone-and-run, and a dev-only static checker violates neither: nothing is built or emitted, `bun test` still runs on a fresh clone with no install, and only the typecheck half of `check` needs a one-time `bun install`.
TypeScript is pinned to an exact version, because an unpinned checker starts failing when TypeScript releases, not when the code changes.

## Deck resolution

This is the capability the tool exists for, so it is the part worth being exact about.
Two sources:

1. `CARD_ROOT` in the environment, which wins outright.
2. `<git-common-dir>/card`, which is `.git/card/` in an ordinary checkout.

Both name a **card directory**, not a deck.
It holds `card-config.toml`, which carries the prefix and the deck's path.
The deck is a directory holding `open/` and `closed/`, and it sits at `deck/` beside the config unless the config says otherwise.
Outside a git repository, with `CARD_ROOT` unset, there is no deck and nothing to report.

**A deck that does not exist is not created by resolution.** A repository with no card directory yields "no deck here", which is what `status` reports and what `init` answers.
Only `init` creates anything.

**Living inside `.git/` is what makes the rest of this short.** Verified on 2026-08-21: `git status` and `git clean` never traverse `.git/`, so the deck is invisible with no ignore rule written anywhere, and it survives `git clean -xdf` and even `-xdff`.
Nothing is added to the repository's `.gitignore` and nothing is committed, so the brief's privacy boundary is untouched — what matters is that the corpus never enters the repository's history, not which directory it sits in.
The hazard accepted in exchange is that `rm -rf .git` now destroys the deck.

**Every worktree resolves to one deck structurally.** `git rev-parse --path-format=absolute --git-common-dir` returns the main checkout's `.git` from anywhere — a subdirectory, a worktree, or inside the deck itself — so the careful keying this section used to require is gone.
Verified on 2026-08-21, including from inside `.worktrees/`.
Two clones of one repository have two `.git` directories and so two decks; that is accepted, because worktrees are what this workflow cuts.

**The prefix is recorded in `card-config.toml`, never derived** from the filenames present.
Deriving it was agentpane's workaround for having no way to create a deck, and it guesses wrong the day a deck holds a card copied in from somewhere else.

**The deck path is relative to the card directory.** The default is `deck`; a deck kept in the repository's own tree is `../../docs/work`.
One rule, and no scheme survives the data moving anyway.
It is wrong inside a submodule, where the card directory is `<super>/.git/modules/<name>/card` and `../../` lands in `.git/modules` rather than the submodule's root — verified 2026-08-21.
Only an in-tree redirect inside a submodule is affected; the default is not.

**The deck carries `.ignore` holding `!*`.** Ripgrep and `fd` walk up from the working directory and apply the repository's root `.gitignore`, so a repository that ignores `*.md` or `open/` makes `card cmd -- rg` find nothing.
Verified on 2026-08-21, and it applies to an in-tree deck's tracked files too.
`.ignore` beats `.gitignore` in both tools, and git never reads it.

**Agentpane needs no `CARD_ROOT`.** It gets an ordinary `.git/card/` whose config points its deck at the committed `docs/work/`, which keeps the redirect path honest with a real consumer and leaves agentpane's corpus the only one anywhere with git history behind it.
Card's own deck is the default, prefix `card`.
Its working cards are still absent from the public repository, which holds the brief, the plan and the commit messages and nothing more.

## What a card is, after the brief's changes

```
---
labels: [PROJ-123, work-laptop]
blocked-by: [PROJ-behilo]
---

# One headline, never wrapped, the only `# ` line in the file.

Body, one sentence per line, `##` for any subheading.
```

Both frontmatter fields are lists, both may be absent, and the tool interprets only `blocked-by`.
Values are YAML flow sequences on a single line: one line per field is what keeps `^labels:` a useful grep, and the bracket form is valid YAML, so anything else that opens the deck reads a list rather than one comma-laden string.
No block sequences, no wrapping.
Labels are opaque strings it matches and never reasons about.
`kind:` and `where:` are gone; the brief says why.

Ids are `<PREFIX>-` plus three consonant-vowel syllables drawn at random, from eighteen consonants and five vowels.
`reference/tracking.md`, "Ids are drawn at random", is the specification and carries the generator.

## Verifying

Tests build a throwaway git repository and a throwaway deck per test, in a temp directory, and never touch a real deck or this repo's own history.
The behaviours worth pinning are the ones agentpane was burned by or the ones this design turns on:

- `new` cannot overwrite an existing card, even under a forced collision, and checks `closed/` as well as `open/`.
  This is the OW-70/OW-71 incident.
- `close` cannot leave a half-finished state.
- The ready query joins across both directories, and dangling blockers surface.
- A worktree resolves to its repository's deck, not to one of its own.
- Resolution precedence: `CARD_ROOT` over `<git-common-dir>/card`.
- `cmd` reaches the deck's files from a repository whose root `.gitignore` would otherwise hide them.

A test that has never failed has not been shown to test anything.
For anything that fixes a defect, watch it go red first.

## Deliberately not in this implementation

`check` and the rest of `list` are deferred in the brief and stay deferred.
Nothing Jira-shaped is built: no fan-in, no promote verb, no API.
The tool never commits, never pushes, never fetches — the sandbox has no SSH keys, so a reflex `git fetch` only produces a confusing failure — and never edits a card because another card changed — authors edit cards, the tool does not do it on their behalf.
