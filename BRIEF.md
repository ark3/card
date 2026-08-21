# card — design brief

Seeded 2026-08-20 from a discussion in agentpane, whose work-item workflow this
tool carries into **corporate repositories**: repositories governed by rules the
owner does not set and shared with colleagues who are not running this workflow.
Nothing about the workflow can be committed to one — not the corpus, and not the
prompts and rules that operate it — and that single constraint shapes everything
below.
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
- **The session stays thin.** Reading and writing happen in dispatched
  subagents; what they find lands in a file rather than in the session that
  dispatched them. The item is the handoff, so compaction costs little and a
  long-lived context is not a prerequisite for good work. Agentpane states
  only the prohibition — exploring in the session that is landing an item is
  the failure mode (`execute/SKILL.md`) — and the goal behind it is recorded
  here because it is a reason the design looks the way it does.

The discipline that produces these — agree-then-write authoring, evidence at
the source, verified claims with dates, review of every diff — travels as
prompts and skills, not in the tool. **The tool automates placement, never
judgment.** Evidence text stays typed by hand.

## The context that shapes the design: private corpus, corporate repo

The first deployment target is corporate work: official tracking in Jira,
corporate repos as defined above, and no desire to manage agents in public.
That produces a two-tier model:

- **Jira is the public, human-resolution record.** Coarse, compressed for
  colleagues. Commits and PRs cite Jira keys, like everyone else's.
- **The corpus is the private, agent-resolution tier.** Fine-grained, full
  reasoning, priced for cold model readers. It lives outside the repo and is
  keyed by repository — every clone and every worktree of one repo resolving
  to one deck — and the tool resolves that location rather than the repo
  declaring it.

Two sync points per ticket. **Fan-in** at ticket start: an authoring session
decomposes the Jira ticket into work items. **Fan-out** at ticket end: the
agent drafts Jira tickets from the surviving items, the owner iterates, the
agreed versions are filed; everything else closes with the reason it did not
survive. A ticket ends with none of its own cards open — the rule is per
ticket rather than per deck, because more than one ticket can be in flight at
once. Open cards are ticket-scoped and short-lived; the closed pile is the
durable asset.

Two rules follow, and both are load-bearing:

- **References are one-directional.** Items cite Jira keys and shas freely;
  nothing public ever cites an item id. This rule is the entire privacy
  boundary, and it is checkable.
- **Authoring must sweep the closed corpus for prior art.** Under ticket-scoped
  lifetimes, a deferral too small for Jira survives only as a closed item; if
  the next ticket's authoring step does not search `closed/`, it is
  functionally deleted.

## What the deliverable is: the whole workflow, delivered rather than installed

Not a CLI with documentation around it. In agentpane the workflow lives in four
committed files — the format spec in `docs/TRACKING.md`, the landing and
evidence rules in `AGENTS.md`, and the two skills under `.claude/skills/`. A
corporate repo can hold none of them: a checked-in skill file describing a
private work-item corpus discloses the workflow as surely as the corpus would.
So this repository holds all of it, and the tool is how a session reaches it.

**`card status` is the entry point and the only discovery mechanism.** With
nothing installed in the repo, nothing in the environment advertises that the
workflow exists. The bootstrap is one line in the owner's personal agent
instructions — run `card status` before other work — which is the one file that
is both private and always loaded. Everything else follows from what that
command prints.

What it prints: the sandbox probe, where the deck is and how many cards are in
it, the two modes, the verbs, and the handful of rules that hold in any mode —
cite ids and never restate a card, anything left undone becomes a card rather
than getting done, a finding that lives only in a transcript dies with the
session, references are one-directional, and the session stays thin. The modes
are a conditional the model resolves from what was already asked — going to
author, run `card author`; going to land a card, `card execute` — never a
question put back to the user. The verbs are taught, not merely named: `close`
does not retire the instruction for closing a card, it replaces a two-step
procedure with a command that still has to be explained.

**The payload carries only what cannot be written down in the corporate repo.**
That repo keeps its own documentation and is welcome to it: its check command,
its branch and review policy, where its evidence goes, its code conventions.
None of that is secret and none of it belongs here. Test each candidate line by
asking whether a colleague reading it would learn that this workflow exists.

**When the project has no deck, `status` says nothing about cards at all.** No
orientation, no modes, no rules. That is what makes the line safe to put in
personal instructions unconditionally: a project that does not use the workflow
pays one command and one line of output.

**The payload is read by whichever model is running.** Phrasing that reads as
advice to one model reads as a mandate to another: agentpane's "ask which mode
before doing anything else" is followed literally by GPT, which insists the
owner choose, and loosely by Claude, which does not — the sentence was a
miscommunication that only one reader exposed. OW-59 records a second instance,
where a Codex session built a work-item path by hand from a sentence that had
never misled anyone else. The literal reader is the normal case, not the edge
one, and prompts here are written for it. This is the same discipline as
pricing a card for a cold reader, applied to instructions rather than to cost.

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
  verbs, not the owner of a query language. It interprets exactly one relation
  between cards, matches labels as opaque strings, and has no opinion about
  anything else a card says. `card exec` keeps the raw files reachable on
  purpose.
- **Ids are drawn at random**, consonant-vowel syllables, because writers are
  unbounded even on one machine (concurrent sessions, dispatched agents).
  Draw, check both directories, create exclusively — as one step that cannot
  be half-done.

## What this project changes about the format

The format arrived whole from agentpane and is not up for redesign. Three
changes are decided anyway, each because the deck was being asked a question
its files could not answer.

**Blockers become a field.** Every blocking relation in agentpane's corpus is
prose — OW-59's own "blocked on OW-54 landing", OW-vezipo's "waits on OW-66
landing", OW-21's deferral to D13 — and nothing can query any of them. A card
lists the cards it waits on, and only that direction is stored: the cold reader
about to start a card is the one who most needs to be told it is stuck, and the
reverse question, what does closing this unblock, is a grep for the id.

**Labels become a field, uninterpreted.** The tool stores them, matches them,
and has no opinion about what any of them mean. The motivating case is resource
gating: agentpane marks the items that can only be done on the work laptop,
where the agents they need are installed, and OW-59 records what it costs for
that marker to live in prose — the survey prints forty headlines and never
shows it, the grep prints five paths and never shows what they are. Filtering
happens at the call site, so "what can I do on this machine" is a question the
caller asks rather than something the tool knows about machines.

**`kind:` is dropped.** Five kinds came from the table that preceded the
files, and the owner reports the field never did any work for him. With labels
present it is a mandatory label drawn from a closed set, and that set had
already drifted once. Anything worth classifying can be a label chosen when
there is a reason to choose one.

**`where:` is dropped for the same reason.** It named the code a card
concerns, which the body says in more detail and at greater length. What is
left is frontmatter of exactly two list-valued fields, blockers and labels,
both present because something computes over them. Every other fact about a
card is prose.

**The ticket a card belongs to is a label too.** That is what lets two tickets
share a deck, which happens whenever one is halted for the other — the common
case at work, where hitting a load-bearing bug means filing a ticket for it and
stopping the first until it lands. Filtering on the ticket key gives back the
single-ticket view, hides the halted ticket's cards for the duration, and is
the reason no stash or second deck is needed.

Two properties hold across all of it, and they are why the changes take this
shape. **No card is rewritten because another card changed.** Authors sharpen
cards deliberately; the tool never does it on their behalf, and a blocker
closing alters nothing in the cards that were waiting — status is the
directory, and a close is an append. **So every relation is computed at read
time**, never maintained as an index. That is not a performance choice; it is
what keeps the corpus something a person can edit with an editor and a grep.

## Verbs, with the evidence behind each

Build now:

- **`status`** — probe the sandbox, resolve the deck, print the guidance above.
  Read-only, cheap, run at the start of every session. A failed sandbox probe
  is where the session stops: warn the owner and do nothing further, rather
  than working unsandboxed. Evidence: with nothing installable in a corporate
  repo, guidance has to be delivered rather than stored, and there is no other
  delivery.
- **`init`** — establish that a deck exists for this project, under a chosen
  prefix. That is the whole of it, and what changes afterwards is what `status`
  reports. Evidence: a prefix cannot be derived from the filenames in the one
  deck that has none, which is a new one; and `status` reporting that a project
  has no deck is only useful if something answers it.
- **`new`** — draw an id, check `open/` and `closed/`, and write the card from
  a headline given as an argument and a body supplied on stdin, exclusively,
  in one call. The headline is a separate input because it is the one line
  every survey shows and the format permits exactly one of them: taking it as
  an argument makes "one `# ` line, never wrapped" structural instead of
  something the writer has to remember. Evidence: agentpane's
  OW-70/OW-71 silent overwrite (two sessions, one clone, no signal from git),
  and a three-step manual procedure that agents demonstrably half-do. Creating
  a skeleton and then editing it is that same half-done shape, one layer down.
- **`show <id>`** — resolve a bare id against both directories and print the
  card. Evidence: a Codex session was given a bare id, built the path by hand
  from the one shape the documentation stated, found the card had closed, and
  reported it missing. `exec -- cat` still reaches the raw file for anyone who
  wants it.
- **`list --ready`** — the cards that can be worked now: open, with every
  blocker in `closed/`, narrowed by whatever labels the caller filters on.
  Evidence: this is the first question of every execution session, so frequency
  rather than deck size is the argument. No grep answers it, because the join
  is between what a card says and which directory each blocker sits in; and the
  alternative, editing blocked cards when a blocker closes, is the rewrite the
  format exists to avoid. A blocker naming an id that exists in neither
  directory surfaces here too, which is a piece of `check` arriving through the
  door rather than being specified in advance.
- **`close`** — move to `closed/` and append the explanation, in one act that
  cannot be half-done: a card in `closed/` with no explanation, or an
  explanation appended to a card still in `open/`, are both states the verb
  exists to prevent. It cannot run without an explanation. What is *recorded*
  and what is *passed for validation* are different things — the prose is
  written for a later reader, while the tool separately needs to know whether
  this card's work actually got done, which is what lets it warn about
  dependents. Evidence: see "How a card ends" below.
- **`exec -- <cmd>`** — run the given command in the corpus directory. The
  escape hatch: arbitrary power to the user, grep-first workflows preserved,
  the corpus location deliberately leaked to whoever asks.
- **`worktree`** — create and set up an agent worktree: cut it, fast-forward
  to local main, report the starting sha, run the project's setup command
  (per-project config — `bun install` in one project is `mvn` in another).
  Evidence: agentpane's execute skill carries all of this as remembered prompt
  procedure today, including the fast-forward that exists because worktree
  baselines were observed stale. The sandbox probe this verb was first
  sketched with belongs to `status` instead: it is a fact about the session,
  not about a tree just cut.

Deliberately not built yet:

- **The rest of `list`** — grouping, a rendered survey, queries by age or
  label. The ready query above is built because it is asked constantly; the
  remaining backlog queries agentpane wanted have little to work on in a deck
  of five to ten fresh cards. Wait for usage to name one the raw grep cannot
  express.
- **`check`** — of the two invariants run by hand in agentpane on 2026-08-19,
  one is mis-specified and the other no longer exists. Documentation examples
  produce 100% false positives on the cited-id check, so it needs a way to tell
  a citation from an illustration. The closed-sha check has nothing left to
  check: no card claims a sha. The
  automatic-versus-portable tension — a check nobody types wants to live in a
  repo's build, but the tool is cross-project — is recorded in OW-59 and
  unresolved. The one-directional reference rule above is a candidate third
  invariant.
- **Anything Jira-shaped** — fan-in, promote, filing via API. No usage
  evidence exists yet; guessing verbs before living without them is the
  failure mode the parent project's method exists to avoid.
- **A project amending its own `author` or `execute` procedure.** Every deck
  works the same way today. Whether a project ever needs its own variant is
  unanswered — none has wanted one yet — and the question is who owns the
  procedure, not where its text is kept.
- **A `status` that knows it is inside a worktree** and prints a shorter
  payload there. Proposed to stop a dispatched subagent from being asked to
  pick a mode, then left unbuilt when the mode question stopped being a
  question. The remaining content — which card, which sha — is already stated
  inline by the prompt that dispatched the agent.

## How a card ends

A card ends one way: it moves to `closed/` and gains an explanation. There are
no close shapes and no vocabulary of outcomes, because the distinctions that
matter are ones only prose can carry — what was built and how it was verified,
what was decided against and why, what turned out to be moot, where the work
went if it went somewhere else.

**The explanation is written for a specific reader**: the next ticket's
authoring session, sweeping `closed/` for prior art before it writes anything.
That is the whole reason closed cards are kept. It also settles what a close
note should name. A commit sha is a working handle that dies at the next
squash-and-merge, so it is worth little; a Jira key, on a card that was
promoted, still resolves in a year and is the one identifier that outlives the
work.

**Closing is not the same as satisfying.** A card promoted to a Jira ticket, or
declined, or found moot, closes without its work being done — and every card
blocked by it is now reported ready when it is not. This is why `close` is told
whether the work got done: so it can name the cards about to be affected. The
warning arrives most often mid-execution rather than at fan-out, because that
is when a load-bearing bug surfaces, gets a card, and turns out to deserve a
ticket of its own.

**The dependents then get one of four dispositions**, decided by the owner and
not by the tool: folded into the same Jira ticket, given their own ticket that
depends on it, declined because they only mattered if the blocker went a
certain way, or re-examined — the edge may have been overstated, in which case
the card can simply be worked. Leaving them open is also legitimate when the
whole ticket is being halted, since the ticket-key filter hides them until the
blocker's work has actually landed.

**Promotion cannot carry dependencies out with it.** Nothing public may cite a
card, so a promoted card's blocked-by edges have to be restated in the new
ticket's own words, or the blocker gets promoted too and the two tickets link
to each other. The trail in the other direction stays private and takes two
hops: a card names the card it waits on, that card's close note names the Jira
ticket it became. No structured field ever points at Jira.

**And a promoted card is not re-filed.** Working the new ticket begins with an
ordinary fan-in, which is required to sweep `closed/` — where the promoted card
is sitting with its full text. It is the grounding for that fan-in rather than
something to duplicate.

## The opposed design, kept on hand

`reference/beads-rust-readme.md` is the README of `br`, a Rust port that
freezes the "classic beads" architecture its author's own tooling was built
around. It is the only document in `reference/` this project argues with rather
than carries, and it is kept because it is the same problem solved the other
way, at maturity: a database as the store with a git-friendly export beside it,
a status machine, and a scheduler that answers what to work on next.

Card takes two things from it — the dependency edge and labels — and declines
the rest for one recurring reason. Every declined feature is either selection
metadata for a backlog large enough that choosing is hard, or arbitration
between workers competing over one queue:

- **Statuses beyond open and closed** and **assignee** exist so a second worker
  does not pick up what a first is holding. One card at a time, held by the
  agent that dispatched it, needs neither.
- **Priority** ranks a pile. A ticket-scoped deck of five to ten fresh cards is
  not a pile.
- **Parent and epic rollups** duplicate a fact that already lives in the public
  tier. The Jira ticket is the parent, cards are fanned in from it, and a
  private copy of that link would point the wrong way across the privacy
  boundary.

Two of its choices are worth keeping in view precisely because card cannot copy
them. Cross-workspace resolution is a routing table committed inside the repo,
which is the one place card may not write. And `br agents` installs its own
instructions into the project's `AGENTS.md` — installation being exactly what
`card status` exists to replace.

## Sequencing

1. Minimal tool: corpus resolution, `status`, `init`, `new`, `show`,
   `list --ready`, `close`, `exec`, `worktree`.
2. Write the guidance `status` prints and the `author` and `execute` prompts it
   points at, ported from agentpane's skills with the Jira fan-in/fan-out
   added; dress-rehearse once on a synthetic ticket — fan a fake ticket into
   three items, work one, decline one, promote one.
3. First real ticket, chosen for low stakes rather than size.

Steps 1 and 2 are less separable than they look. **The payload specifies the
verb surface.** Writing the sentence a model has to follow — close a card with
`card close`, and it will not let you close without saying how it ended — is
what shows whether a verb's shape is right, so the guidance is drafted
alongside the verbs rather than wrapped around them afterwards. And nothing in
step 1 is usable alone: a tool no session is instructed to call is
indistinguishable from a tool that is not installed. The stops inside step 1
are checkpoints for catching design mistakes cheaply, not deliverables.

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
