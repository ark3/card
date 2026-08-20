# card — design brief

Seeded 2026-08-20 from a discussion in agentpane, whose work-item workflow this
tool carries into contexts where the corpus cannot live in the project repo.
The deciding item on the agentpane side is `docs/work/open/OW-59.md` there; the
format itself is specified in agentpane's `docs/TRACKING.md` ("The format:
Maildir-shaped work items", "Staying greppable", "Ids are drawn at random").
This document is the founding record for the tool's own repository: agentpane
is one consumer of the tool, not its home.

The tool is `card`, and the noun came before the name: an item is a **card**.
That is the lesson taken from beads, whose real gift is that each item is "a
bead" — the tool takes the item's name, not the other way around. The word
earns its place three times over. A hand of cards is private and the table is
public, which is this tool's privacy model exactly: cards are held, Jira is
what gets played, and spent cards go to the discard pile. Agentpane's ids were
already "drawn, not chosen" (`docs/TRACKING.md`), so the deck metaphor was in
the source material before anyone noticed. And the software-process lineage —
XP story cards, CRC cards, kanban cards — makes "card" the oldest word in the
domain for one unit of work small enough to hold. "Put a pin in that" is the
gesture for filing one mid-conversation. The metaphor lives in the name and
the conversation only: the verbs stay boring (`card new`, `card close`), never
`draw`/`play`/`discard`, because a themed CLI is charming for a week and then
it is a tool whose commands need translating.

## What is being carried, and why it is worth carrying

The workflow: one file per work item, status is the containing directory
(`open/` or `closed/`), flat frontmatter (`kind`, `where`), a single `# `
headline, prose body priced for a cold agent reader. Closing is a move plus a
dated note. The list is a grep.

The benefits, experienced over weeks of daily use in agentpane rather than
predicted:

- **Externalized memory.** A single place for anything that must not be
  forgotten. No "which conversation was that in", no fear of context
  compaction or session boundaries. Any session — human or agent, warm or
  cold — picks up from the corpus.
- **Small grounded items yield high-quality work.** Authoring forces the
  grounding (paths, symbols, what done looks like) before execution starts,
  and the execute-then-review loop catches drift. A cold read of an item
  before starting it has found ~20 real defects in an item that read finished.
- **Scope creep converts into new items.** The known agent failure of drive-by
  "improvements" becomes an encouraged result instead: file it, don't do it.
- **The closed corpus is accumulated archaeology.** Declined-with-reason and
  closed-with-evidence notes are exactly the grounding a later item needs;
  nothing is relitigated from scratch.

The discipline that produces these — agree-then-write authoring, evidence at
the source, verified claims with dates, review of every diff — travels as
prompts and skills, not in the tool. **The tool automates placement, never
judgment.** Evidence text stays typed by hand.

## The context that shapes the design: private corpus, shared repo

The first deployment target is corporate work: official tracking in Jira,
shared repos, and no desire to manage agents in public. That produces a
two-tier model:

- **Jira is the public, human-resolution record.** Coarse, compressed for
  colleagues. Commits and PRs cite Jira keys, like everyone else's.
- **The corpus is the private, agent-resolution tier.** Fine-grained, full
  reasoning, priced for cold model readers. It lives outside the repo, keyed
  by project, and the tool resolves its location by convention.

Two sync points per ticket. **Fan-in** at ticket start: an authoring session
decomposes the Jira ticket into work items. **Fan-out** at ticket end: the
agent drafts Jira tickets from the surviving items, the owner iterates, the
agreed versions are filed; everything else closes as `declined: <reason>` or
`deferred: <reason>`. The end state of every ticket is zero open items — open
items are ticket-scoped and short-lived; the closed corpus is the durable
asset.

Two rules follow, and both are load-bearing:

- **References are one-directional.** Items cite Jira keys and shas freely;
  nothing public ever cites an item id. This rule is the entire privacy
  boundary, and it is checkable.
- **Authoring must sweep the closed corpus for prior art.** Under ticket-scoped
  lifetimes, a deferral too small for Jira survives only as a closed item; if
  the next ticket's authoring step does not search `closed/`, it is
  functionally deleted.

## Requirements carried over from agentpane

- **No hardcoded prefix.** Derive it from filenames already present, or read
  it from per-project config. (Owner requirement recorded in OW-59,
  2026-08-17.)
- **Corpus root by convention or config, never assumed in-repo.** This is what
  makes the tool load-bearing here where it was optional in agentpane: with
  the corpus outside the repo, location abstraction is a missing capability,
  not a nicer rendering of an existing one.
- **The format stays the API.** Files remain greppable — one `# ` headline per
  file, flat one-line frontmatter scalars — and the tool is a resolver plus
  verbs, not the owner of a query language. `card exec` keeps the raw files
  reachable on purpose.
- **Ids are drawn at random**, consonant-vowel syllables, because writers are
  unbounded even on one machine (concurrent sessions, dispatched agents).
  Draw, check both directories, create exclusively — as one step that cannot
  be half-done.

## Verbs, with the evidence behind each

Build now:

- **`new`** — draw an id, check `open/` and `closed/`, create the skeleton
  file exclusively. Evidence: agentpane's OW-70/OW-71 silent overwrite
  (two sessions, one clone, no signal from git), and a three-step manual
  procedure that agents demonstrably half-do.
- **`close`** — move to `closed/`, append the note, resolve `HEAD` to a sha
  when the note is a `Fixed in`. Two close shapes: fixed-with-evidence, and
  declined/deferred-with-reason. Evidence: two tool calls to one, plus a sha
  only knowable after committing, plus two shapes to get right by hand.
- **`exec -- <cmd>`** — run the given command in the corpus directory. The
  escape hatch: arbitrary power to the user, grep-first workflows preserved,
  the corpus location deliberately leaked to whoever asks.
- **`worktree`** — create and set up an agent worktree: cut it, fast-forward
  to local main, report the starting sha, run the project's setup command
  (per-project config — `bun install` in one project is `mvn` in another),
  probe the sandbox. Evidence: agentpane's execute skill carries all of this
  as remembered prompt procedure today, including the fast-forward that
  exists because worktree baselines were observed stale.

Deliberately not built yet:

- **`list`** — its strongest arguments in agentpane (query by kind, what is
  unblocked, resource gating) are backlog queries over ~40 open items of
  mixed age. A ticket-scoped corpus is five to ten fresh items; wait for
  usage to name a query the raw grep cannot express.
- **`check`** — both invariants were run by hand in agentpane on 2026-08-19
  and both are mis-specified (documentation examples produce 100% false
  positives on the cited-id check; the closed-sha check does not know about
  the second close shape). Respecify before automating. The
  automatic-versus-portable tension — a check nobody types wants to live in a
  repo's build, but the tool is cross-project — is recorded in OW-59 and
  unresolved. The one-directional reference rule above is a candidate third
  invariant.
- **Anything Jira-shaped** — fan-in, promote, filing via API. No usage
  evidence exists yet; guessing verbs before living without them is the
  failure mode the parent project's method exists to avoid.

## Sequencing

1. Minimal tool: corpus resolution, `new`, `close`, `exec`, `worktree`.
2. Port the authoring and execution skills with the Jira fan-in/fan-out
   added; dress-rehearse once on a synthetic ticket — fan a fake ticket into
   three items, work one, decline one, promote one.
3. First real ticket, chosen for low stakes rather than size.

The trial is safe because the workflow fails soft: it is a private overlay on
how the work already gets done. A badly authored item means doing the work the
ordinary way; abandoning mid-ticket leaves the public record looking exactly
as it would have anyway. The blast radius is the owner's own time.

## Costs accepted with eyes open

- **Legacy grounding is front-loaded.** Early items in an old codebase will be
  slower to write and worse than agentpane's, because the archaeology has to
  happen first. The corpus compounds; the first month will not feel like the
  greenfield did.
- **Items can go stale against code the owner does not control** while a
  ticket is in flight. Checking the item against the source before starting
  it stops being hygiene and becomes load-bearing.
- **One-tree atomicity is gone.** In agentpane, retiring every copy of an
  overturned fact is one grep over one tree. Split across repo and corpus, the
  sweep is two runs — tree, then `card exec -- rg` — and nothing reminds you of
  the second.
- **Closed items go stale like all documentation.** They are dated evidence,
  not living docs, and are read the way git history is read.
