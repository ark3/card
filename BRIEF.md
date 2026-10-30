# card — design brief

`card` cuts a plan into pieces small enough to run one per fresh session, and runs them: an item of work is a **card**, and a repository's cards are its **deck**.
It is two programs: `card`, which runs the workflow, and `deck`, which keeps the files ("Two executables" below).
The prior this design displaces is the deck as a tracker — a durable store whose state is the project's state — from which "an empty deck means nothing to do" and "an ephemeral deck is worthless" follow as one inference.
The prompts the tool shows its sessions derive from this brief, so the brief leads with the purpose: a reader holding the purpose needs no denials, and a prior is displaced by another prior, never by rules.
How this design was reached — its dates, the owner's words in full, and the evidence behind its factual claims — is kept in `reference/brief-2026-10-27.md`, and the first brief, with the lineage from agentpane, in `reference/brief-2026-08-20.md`; `reference/README.md` says what each is.

## The purpose: a plan in pieces

"Plan mode" in the owner's words below is Claude Code's own: the mode in which a session drafts a plan and the owner approves it before the session touches anything.
Card's *plan*, named at the end of this section, is a different object — the unit this tool executes — and this brief keeps the two apart wherever they could be confused.

> "Think of plan mode.
> A good, well-grounded plan is usually quite large, many lines of detail and distraction.
> Running that plan as one shot is usually a mistake, but running it in pieces is unnatural (for you, as in, I can say 'just do step 3' but you are always aware of the whole thing).
> Adding a discovery to that plan while executing is very expensive!
> Where does it go?
> Does it contradict other things?
> All the time, the whole plan is tugging at you, distracting you.
>
> So that's what I'm trying to fix.
> I want to plan, with sufficient detail, with well-sized chunks.
> That's what authoring is for.
> Then, in a fresh session, I want to execute.
> I want tight focus for that, look at just one card, the implementer doesn't even see that, the reviewer is a fresh session once more.
> Findings?
> Just write them down, one card for each, worry about the duplicates later."

In one sentence: sessions small enough to do good work, and a place to put things down that makes small sessions safe; everything else is mechanism.
Decomposition is how a session gets small, filing is how it stays small, the hand-back is how what it put down reaches the owner, and privacy is a constraint on where the deck can live, not a goal.

The mechanism is the answer to that paragraph, and it has four parts.

- **Authoring is plan mode that emits pieces.**
  The owner and a session settle, in stages, what the result is and how to reach it: a plan document stating the intent, the decisions and the acceptance criteria, and the cards that do the work, each grounded and sized for one fresh session, the last of them checking the whole against the criteria.
  Approval is the owner's explicit word, and it starts execution.
- **Execution is the tool running every piece, with no session above it.**
  For each card, in the order authoring set, the tool launches three fresh headless sessions in turn — a *reconciler*, which checks the card against the code as it now stands and amends it within its intent; an *implementer*, which builds exactly the card; and a *reviewer*, which checks the result against the card's own done-condition — and routes on each one's answer in code.
  No session chooses which card runs, reviews an implementer's work in its own context, or recommends what to run next; the tool decides every next step, and a session's judgment reaches the workflow only through the answer the tool reads.
- **Findings are written down, one card each, and never acted on by the role that found them.**
  Whatever a role notices outside its card goes into its answer, the tool files it as a waiting card, and the role goes on with its card; the duplicates are the owner's to worry about later.
- **The owner is at the start and the end.**
  In the owner's words: "I want to be there for the start and the end, and be uninvolved for the long middle."
  Between approval and the end of the plan the owner is reached only when the run stops at a card ("Stopping and answering" below), and the run waits there until the owner answers.
  At the end the tool hands the finished plan back — the final card's guide to seeing it work, and every finding by headline — for the owner to try, to settle each finding one decision at a time, and to end the plan with `card finish`.

The deck holds a plan's cards while the plan runs, and that is what it is for.
Done is a fact about the plan — every one of its cards closed done — which the tool reports; it says nothing about whether the owner has other work, and an empty deck says nothing about that either.
Only the owner decides whether there is work, and says so by authoring a plan.
In the owner's words: "There is no right deck. Why are you treating the deck like a backlog? Isn't the whole point of this work that the deck isn't a backlog, it's a tool? If the session creates cards, it also makes me aware. It's up to me to execute or decline or promote those cards."

**Names.**
The unit of execution is a *plan*, and its document is the *plan document*.
The owner's "the thing" names the desired result — the feature, capability, fix or chore — and the plan is the doing of it: the plan document states the result as its intent and acceptance criteria, the plan's cards are its pieces, "the plan is done" means its cards closed done, and the result is what the final card's guide shows the owner.
The name teaches the purpose, since the owner's own account of the design runs through plan mode; its cost is that Claude Code's plan mode also produces something it calls a plan, so the stage prompts, which interactive sessions read, possibly in that mode, keep the two apart.
A *run* is one plan's execution, from approval to its end.
The *hand-back* is what the tool prints for the owner when a run stops or ends.
An *interactive session* is the one the owner converses with; a *role session* is a headless one the tool launches.
A card is *waiting* when it sits in `open/` and no plan's order lists it: it is not yet accepted, and nothing runs it until the owner settles it ("Findings" below).

## The deck is a store, and no session reads its state as its assignment

The deck is a durable store, said plainly: cards are files under the repository's `.git`, and a closed card stays there with its note.
The two behaviours the owner does not want are a session concluding there is no work because the deck is absent or empty, and a session closing cards because it judged the work over; both are a session reading the deck's state as its assignment, and the rule against that is one real trackers also carry and models already hold: sessions work what the owner handed them.
Here the rule has little to bind, because no session reads the deck to decide anything: the tool reads it, and a session touches it only through the tool at the owner's ask, at the path the Cards stage's prompt prints, or directly where the owner asks, with `deck agent-help` for the conventions.
Conceding that the deck is a store lets the denials go, and the test that this worked is a cold read of the two places a session reads about the deck, the Cards stage's prompt and `deck agent-help`, asked what the deck is for and what an empty deck says.

No part of the workflow depends on the deck lasting: the workflow works with no closed pile at all, a closed pile is a bonus where a deck persists, and in an ephemeral container the deck must empty before the container does, every finding worked, promoted or declined.
Cards are not tracked in git: a deck committed in the repository's tree, as agentpane's was, proved counterproductive there, and what must last lives elsewhere ("The backlog lives above the deck" below).
The deck lives under the git common directory, which git does not track; the config can point it at another path, a deck in the tree included, but nothing in the workflow is built for that case.
There is no public mode: the card-id check runs on every deck ("The card file and the deck" below).

## What the deck does for the work

These benefits were experienced in agentpane rather than predicted.

- **Small grounded cards yield high-quality work.**
  Authoring forces the grounding — paths, symbols, what done looks like — before execution starts, and a fresh reading of a card before it is built once found some twenty real defects in a card that read finished; that reading is the reconciler's, and every card gets one.
- **Scope creep converts into new cards.**
  The known agent failure of drive-by "improvements" becomes an encouraged result instead: write it down, do not do it.
- **No session grows past one card.**
  The tool holds the run's state, the reconciler reads the plan document, and an implementer or reviewer sees one card's prompt and nothing else — the final card's roles alone see the plan document beside it — so what a role finds lands in the deck rather than in a context that must then carry it; the card is the handoff, and a long-lived context is not a prerequisite for good work.
- **Externalized memory, within a piece of work.**
  A finding written down is one the next role or the owner can read: no "which conversation was that in" within a plan, and no fear of a session's context running out mid-plan.
  The guarantee is narrow: the deck remembers for the plan, and what must outlive the plan goes into documentation or code as the plan's own work.

The discipline that produces these — grounded authoring, a done-condition on every card, review of every diff — lives in what each role's prompt asks of a model, not in anything the tool decides, though the tool builds every prompt ("Delivery" below).
**The tool automates placement, never judgment.**
Every verdict is reached by a model, and code only routes on it.

## Why filing: focus

A finding is written down so that whoever found it can put it down.
That is the whole reason: write it down so you can put it down, and the hand-back carries it to the owner.
No prompt motivates filing by survival — "a finding not written is gone", "it dies with the session" — because that teaches the deck as the store of what must not be lost, which is the tracker prior; survival is at most a property of a card, not the reason to write one.
Filing stays cheap for the same reason: a finding is written in the deck's private register, in whatever words the role has, and rewritten only if the owner promotes it or joins it to a plan.

## Two deployments

The two deployments split by what sits above the deck, not by public versus private.

- **Work.**
  A corporate repository — governed by rules the owner does not set and shared with colleagues not running this workflow — with a Jira ticket fanned into a plan, a private deck under `.git` on the server, and Pi as the harness, since Claude Code is not available there.
  Nothing of the workflow is committed to the repository: not the deck, not the prompts, and not a skill file, which would disclose the workflow as surely as the deck would.
- **Personal.**
  The owner owns the repository, and it has the same private deck under `.git` that a work one does.
  A Claude Code cloud container works because the tool runs there: the container has `claude`, and a session there can launch `claude -p`.
  Authoring's fresh session per stage works there too, since `/clear` keeps the container's filesystem.
  A session in the container is an interactive session like any other, running `card` at the owner's ask, and a deck created there empties before the container does, by the rule above.

## The backlog lives above the deck

Cards are priced for execution soon, so a card that waits decays, and a durable deck with nothing above it turns into a backlog, which cards are the wrong shape for.
The owner, on agentpane: "It's not the public aspect ... It's more that cards are not a good way to manage a backlog, and yet having a durable set of cards causes me to use it that way anyhow."
At work Jira absorbs the backlog, so the deck stays one plan's worth; a personal project has no layer above, so the deck becomes it.

So, as advice to the owner rather than a rule for sessions: a deck is sized to one plan with a ticket layer above it, and a project with no ticket layer will turn its deck into a backlog, so give it one — a repository's own issues will do for a personal project.
Card designates no ticket layer and assumes none: one may not exist for a given plan, may not hold what matters, and may be unreadable or unwritable to the agent, so what authoring produces lives in the deck, and a finding reaches the ticket layer only by the owner's promotion, on text rewritten to be public-safe ("Findings" below).
Card has no lasting tracker of its own and needs none: the backlog lives in whatever ticket layer the owner already uses, the record of what was done lands in git, each card's commit carrying its close note, and the plan document's rationale dies with an ephemeral deck.
That last is accepted — "things that really want to be saved need to be in documentation or code comments" — so a plan whose decisions must outlive it carries them there as part of its own work, and a merge request is not a place to store information.

## Rejected alternatives

Each with its reason, since a rejection without one is relitigated; a rejection that bears on one mechanism is stated beside it instead.

- **A real tracker in the cards role.**
  The owner has Jira for work and does not want one for cards; a real tracker would bring its prior back by construction, lose the dependency edge and the tool's own delivery of the workflow, and put a personal token on corporate machines.
- **An append-only findings file.**
  It needs a triage pass to become anything; a card is executable the moment the owner accepts it.
- **The closed pile as an archive, where nothing is relitigated from scratch.**
  It makes the deck a record, which is the tracker prior again, and the owner accepts an occasional re-derivation: "worry about the duplicates later."
- **A "durability horizon" for the deck.**
  It was a construction for reconciling "not that durable" with a vocabulary of survival, and it is unneeded once the deck is plainly a store and filing is for focus.
- **A deck committed in the repository's tree, so that every clone carries it.**
  Nothing depends on the deck lasting, so nothing needs a clone to carry it, and a committed deck would also need a committed config to be found by.
- **Refusing to create a deck where none exists**, leaving that to the owner as a separate act.
  Nothing runs unasked ("Delivery" below), so every invocation is the owner's ask, and running `card` is the owner adopting it; the tool creates the deck when it starts a plan.

## Execution

### The frame

- **The unit of execution is the plan, not a set of cards.**
  Authoring settles what the plan is and how to do it; after the owner approves, execution does all of it.
  The owner never picks cards to run, and nothing recommends what comes next: "either the thing will be done (nothing left to do) or it won't be done."
- **No dispatching session is required.**
  The tool decides every next step and launches each role itself as a fresh headless session of one of two harnesses, Claude Code or Pi ("The harness" below), wherever the harness runs, a Claude Code cloud container included.
  A relay, in which an interactive session passes tool-built prompts to its own subagents, was sketched and judged unnecessary.
- **Routing a verdict is placement; reaching it is judgment.**
  Every verdict is reached by a model, and code only routes on it, which keeps "the tool automates placement, never judgment".
- **Nothing depends on the deck lasting**, as "The deck is a store" states.
- **No issue tracker can be assumed**, as "The backlog lives above the deck" states, so what authoring produces lives in the deck.

### Executing one card

For each card, in the order authoring set, the roles run in the order below.

**Reconciler.**
A fresh session before every implementation checks the card against the code at the tip of the plan's branch and amends it within its intent.
It runs once per card, before the card's first implementer; a blocking finding brings it back to converse and amend, and the fresh implementer that follows needs no second reconciling, since the amendment is the reconciler's own; revision rounds do not bring it back.
It also keeps the plan document true, within the plan's intent.
It edits the card's contract and the plan document and nothing else, and the tool holds it to that on every answer it gives, before it acts on the answer: a reconciler that has changed the worktree, or the card's frontmatter or record, has failed ("When a role fails" below), with each changed path or record section named.
The tool stops rather than repairs, leaving the change in place for the owner: a reconciler that oversteps is a bug in the reconciler or its prompt, to be found and fixed, and undoing the change quietly would hide it.
A done-condition only the owner can judge, it rewrites to name evidence an agent can check, and the card's close note then passes the owner's trial on in its "how to see it working".
It stops the run for the owner when the intent itself is wrong, when the card depends on work no earlier card has landed — a problem of order for authoring to fix — or when it cannot reach agreement with the implementer within a cap.
Its check against the current tip absorbs an earlier card changing the ground under a later one.
It is named "reconciler" over "editor", whose instinct is to improve prose and which invites rewriting cards to taste, and over reusing "author".

**The card is a fixed contract for each implement-and-review cycle.**
The owner: "the 'conversation' between the implementer and reviewer will be much more productive if they share a single notion of what the card is."
Only the reconciler changes a card, and never during a cycle.
The contract is the card as authoring and the reconciler wrote it; what the tool appends during a cycle — the implementer's account, the reviewer's feedback, the close note — is the card's record, beneath the contract and never part of it.

**Implementer.**
Implementation only: "I really don't want the implementer thinking about whether the card is correct. I want the implementer's frame of mind to be implementation."
A finding that does not block the work goes into the implementer's answer, and the tool files it as a card.
A finding that blocks it — the card cannot be implemented as written: something it cites is absent, its approach cannot work, its done-condition cannot be reached — goes to the reconciler, and the two converse until they agree, within a cap.
On agreement the card is amended, and the tool first holds the reconciler to its bounds as it does on proceeding ("Reconciler" above): it compares the worktree with what it held when the reconciler was resumed, which is the implementer's uncommitted work, and the card's frontmatter and record with what they were then, and a reconciler that changed any of them has failed, with the change and the work left in place.
Within bounds, the tool discards the uncommitted work by resetting and cleaning the plan's worktree, removes from the card the `## Account` and `## Review feedback` sections of the discarded work, as a rerun does ("Stopping and answering" below), and a fresh implementer starts there on the amended card without the record of the work it replaces.
This path is rare and allowed to be expensive; the discovery survives in the amended card, and discarding the work removes the implementer's reason to steer the amendment towards what it had built.

**The implementer's account.**
The card plus the diff is not enough to review: "The card does not carry what the implementer has discovered during implementation."
The implementer returns an account — choices made within the card's room and why, what it tried and dropped, constraints it found, what it noticed and left alone, its doubts — and the tool appends it to the card.
The reviewer takes the account as claims to check against the code, not as reasoning to inherit; handing it the implementer's whole session would cost the independence a fresh reviewer exists for.

**Reviewer.**
A fresh session gets the card, now carrying the account, and the diff, and runs the card's done-condition itself; there is no machine check and no `check:` field.
Its verdict drives the tool, and it chooses one of three outcomes: approve, with the close note and the commit's subject; fix small things itself and approve, with no second review; or request a revision.
Feedback is appended to the card and the same implementer session is resumed — one implementer per version of the card, since an amendment after a blocking finding starts a fresh one.
The revision rounds are capped, and a cap that runs out stops the run for the owner.
A session reviewing an implementer's work has three judgments to make — send it back, fix it, or, for a badly written card, start fresh — and the reviewer holds the first two, while starting fresh is the reconciler's path.

### Landing

Execution starts by making sure the plan's branch, named by authoring, exists: the tool creates it from its recorded start point if it is absent, and uses it as it stands if it is present, as when the owner made it or a stopped run resumes.
The tool then holds that branch checked out in a worktree for the plan, under `.worktrees/`, from the start of the run until the plan ends, so git itself refuses to check it out anywhere else meanwhile, and the tool never touches the main checkout or cares what it has checked out.
Cards run in series in that one worktree: the implementer works there uncommitted, the reviewer reviews the uncommitted diff and makes its small fixes in place, revision rounds continue on the same state, and on approval the tool makes the card's one commit, the reviewer's subject over the close note as its body, and closes the card done.
Before committing, the tool checks the lines the card's diff adds for card ids, as it checks the close note: a diff that fails goes back to the reviewer, resumed with the offending lines quoted, to remove the id as one of its small fixes, and a diff still failing after two tries stops the run as a role that failed.
A commit the host repository's hook refuses goes back to the reviewer the same way, resumed with git's output quoted, to fix what the hook refused as one of its small fixes, in the worktree's files or in its subject and close note, and a commit still refused after two tries stops the run as a role that failed, with git's output as the cause and nothing committed.
The tool never passes `--no-verify`, because at work the host repository's rules are not the owner's to waive, and most hooks are linters and message-format checks, which are the reviewer's small fixes anyway.
A card that changed nothing, as the final card usually does, still gets its commit, an empty one, so that every card's close note lands in git, the final card's guide included.
This was chosen over a worktree per card, cut from the plan's tip and fast-forwarded back, because a fresh tree can need its dependencies installed before anything runs, once per card, while the roles of one card never run at once and nothing needs their work apart; disposal in place is deterministic code, and one commit per card matches the card as the smallest unit.
An implementer that commits out of habit moves the worktree's HEAD, which the tool detects and undoes, keeping the changes.
The worktree stays after the last card closes, so the owner can try the finished plan there, at the path the hand-back prints, before settling its findings; `card finish` removes it and leaves the branch, so the owner can check the branch out, and `card drop` does the same for a plan given up.
The tool creates and merges no branches but the plan's and its own temporary ones; landing the plan's branch anywhere else, such as a merge request to `develop`, is the owner's act after the plan.
Parallel runs are a separate decision that nothing here needs; they would bring per-card trees back.

### Stopping and answering

A run stops in one of three ways, and each leaves something different waiting.

- **A role stops it.**
  The reconciler finds the card's intent wrong, finds that the card depends on work no earlier card has landed, or cannot agree with the implementer within the cap; the final card finds a gap in the plan ("The final card checks the whole plan" below); the reviewer's revision rounds run out; or a role ends without a valid answer ("When a role fails" below).
  The plan is then *bounced*: the role session whose answer stopped the run is resumable and waiting, and the hand-back says what it asks.
- **The owner stops it**, with `card stop`.
  The tool ends the active role session, discards the in-flight card's uncommitted work as it does after a blocking finding, and leaves that card open, so resuming reruns it from its reconciler; nothing waits.
  "Stop after this card" was set aside, because one card can take long, and a stop the owner cannot count on to come promptly is little use.
- **It dies**: a reboot, the environment that launched it shutting down, or a cloud container's VM stopping when its session goes idle.
  Nothing waits on the owner, so bare `card` carries a dead run on by itself ("Where the run lives" below).

After a bounce the owner usually wants to question the stopped session before answering it, since that session holds the context; the tool chose its id, so it can always be reached.
Two routes stay, and the owner picks.
Where a terminal is at hand, the owner resumes the stopped session interactively.
Where none is, as in a cloud container, the owner's interactive session relays: `card ask` puts the owner's question to the stopped session by resuming it headless and prints its answer for the owner, and once the owner has decided, `card resume` carries the answer to the session, which the tool resumes to continue, reading its answer against the schema.
The relay works on both harnesses: a stopped session answers question-only resumes without resuming its work or touching files, and a later resume carrying the decision finishes the work against the schema; a fence on question-only resumes is optional insurance, not a requirement.
`card ask` and `card resume` reach the role session whose answer stopped the run; when the implementer and the reconciler run out their cap, that is the reconciler, which is the role that stops the run.
`card resume` takes the owner's answer on stdin, or nothing: where the owner answered the session at a terminal, where it retries a role that failed, and after `card stop`, where no session waits.
`card amend` takes a bounced or stopped plan back to the Cards stage, where an authoring session changes the plan, and `card done` and then `card approve` carry the run on from the first card not yet closed done, so a card added ahead of the stopped one runs first and the stopped card's reconciler sees the amendments.
A card that reruns from its reconciler starts on a clean worktree: after `card resume` from a stop, when a dead run is carried on, and after `card amend` from a bounce.
It starts from the card as it was before the discarded cycle began, too: the tool removes the `## Account` and `## Review feedback` sections that cycle appended, so no role of the rerun reads an account of work its worktree does not hold, and keeps the rest, a landed cycle's record on a reopened final card and the `## Gap` a gap stop appended included.
Rejected: the owner's session reading the stopped session's transcript and answering from it, which has one model reading another's reasoning with no way to ask what it meant.

The tool launches every role session with a session id it chooses, a fresh uuid it records, and resumes by that id.
Choosing the id is required, not only convenient: in a cloud container every `claude -p` launched without one got one and the same id, across containers and working directories, appended to one transcript per directory, and a resume of that id followed only the newest call's conversation, so roles of one card launched in series in one worktree would collide and a resume would reach the wrong one.
Unsetting `CLAUDE_CODE_SESSION_ID` does not help; only choosing the id does.

**When a role fails.**
A role that ends without a valid answer — a crash, an error, a usage limit, an answer still malformed after two repair prompts, a close note or diff still citing a card id after two, or a commit the host repository's hook still refuses after two — stops the run with the cause named, as a bounce.
`card resume` retries it by resuming the same session, and `card ask` can ask that session what happened.
A usage limit stops the run like any other failure; waiting it out instead stays open ("What stays open" below).
A role running short of context needs no route of its own: it answers, or it fails into this one.

### Where the run lives

Approval starts the long middle, hours of role sessions the owner does not wait for, so `card approve` returns at once and the run goes on as a detached process that outlives the turn and the session that started it.
A run can still die, so the tool never relies on it surviving.
It writes enough state after every card for a dead run to resume from the last card closed, since the disk and the plan's worktree outlive the process.
It records the kernel's boot id beside the run's pid and treats a changed boot id as death, since pids restart low after a boot and a pid file alone can name an unrelated live process.
Bare `card` carries a dead run on, and the card that was in flight reruns from its reconciler on a clean worktree, so a death costs only that card's progress.

### Findings

The reconciler, implementer and reviewer all report findings, through one optional field every role's answer shares, and the tool files each one the same way, as a waiting card.
A finding is something outside the card's contract that the reporting role must not act on; a problem inside the contract goes through that role's own outcomes — the reviewer's revision, the reconciler's amendment or stop, the implementer's blocking finding — because a defect filed as a finding lets its card close done with the defect parked in a waiting card.
The reviewer is the reason the field is shared: a fresh reader of a diff sees what the implementer was too close to, and without the field it either drops what it sees or widens "fix small things itself" past the card.
The tool writes the filing role, the card the finding was found under and the plan into the body's first line as it files.

Waiting is the whole mark: the tool stores which cards make up each plan and in what order, and a card in `open/` that no plan's order lists is by that fact not yet accepted.
A second copy of that bit, as a field or a directory, would be a maintained index of the kind the card format rules out, and a card hand-written into `open/` lands on the safe side, waiting.
The tool hands a waiting card to no implementer and treats it as ready for nothing until the owner settles it.
Why the gate: agentpane's deck, with nothing above it, reached 93 open cards, 56 of them filed by reviews and runs, and over three weeks filed 281 cards against 275 closed.
Why still a card: a card is executable the moment it is accepted, with no triage pass to turn it into one.

The owner settles findings one decision at a time, each its own invocation carrying the decision in its arguments or on stdin, made as the owner makes it, so a settling session that dies midway loses nothing already decided.

- `card join` accepts a finding into the plan, ahead of the final card, when it falls within the plan's intent.
  At a plan's end it takes the plan back to the Cards stage, where the finding is rewritten as a card for a fresh implementer, since a role wrote it in whatever words it had, and the plan document is updated if the finding changes what the plan is.
  The join itself reopens the final card in place, so from that moment the plan is not done until the final card closes done again, which is the fact about its cards and not a regression.
  The plan then passes the check before approval like any other, and `card approve` runs the joined cards and then the final card again.
- `card later` leaves a finding outside the plan, waiting, for a Cards stage not yet run to join, when it falls outside the plan's intent; a settling verb that started a plan for it instead would put a second plan in progress as a side effect of settling, and a plan's name on every command.
- `card decline` closes it, with the reason on stdin.
- `card promote` sends it to the owner's ticket layer, in two invocations.

The test for joining is the plan's intent and not the card's contract, because a finding is by definition outside its card yet may still belong to the plan, while work outside the plan would ride on its branch and into its merge request.
Where the owner has no tracker for the plan, working or declining are the choices, and declining a finding the owner has read loses nothing the filing was for: "It also makes me aware."

Promotion is always the owner's act, since the agent may be unable to reach the tracker.
The first invocation carries the session's public-safe draft on stdin, for one finding or several folded into one ticket; the tool checks it for card ids as it checks a close note, prints it for the owner, and marks the findings awaiting a key.
The owner posts it, and the second invocation, `card promote <finding>... --key <KEY>`, records the key the owner gives back and closes the findings promoted.
A finding awaiting its key counts as settled for `card finish`, and bare `card` keeps listing it, with the second invocation open, until the key is recorded.
Findings are filed in the card's private register and rewritten only when promoted or joined, because filing should stay cheap and most findings never go public.

### The close note

The reviewer writes it on approval: what landed, how it was verified, and how to see it working.
It is public-safe — no card ids, written for colleagues — so the one text serves the hand-back, a closed pile and a public tracker, while the card above it keeps the private detail.
It is also the body of the card's commit message, so it is written to serve as one; the subject is the reviewer's too, one line under the host repository's commit convention, which the plan document records beside the branch ("Authoring" below), and where the document records none, an imperative with a capital letter and no trailing period, as Git's own history is written.
The tool composes the message — the subject, a blank line, the note wrapped at 72 columns — and checks both for card ids before committing; a subject or note that fails goes back to the reviewer by the repair prompt under "Delivery", scoped to the message alone.
The note may hold paragraphs and lists, which the tool fills paragraph by paragraph and item by item, each item's continuation lines under its text, so a list's items never run together; it holds no code, fenced or indented, because a commit message is no place for code, and a command named in backticks within a sentence is prose.
The note is read where it lands, in the commit and in the closed card, which `git log` on the plan's branch and `deck show` reach; bare `card` lists a closed card by its headline and never prints its note, and posting the note to a tracker is the owner's act.

### The harness

The tool drives two harnesses, Claude Code and Pi, because Claude Code is not available at work, where the tool is used most.
Each harness's flags are spelled once in code.
Claude Code launches a role with `claude -p --output-format json --permission-mode bypassPermissions --session-id <uuid>` and resumes it the same way with `--resume <uuid>` in place of `--session-id`; Pi launches and resumes alike with `pi -p --session-id <uuid>`, which creates the session or continues it.
Both read the prompt on stdin, which has no size limit where an argument does.
`--permission-mode bypassPermissions` is there because a headless session has nobody to answer a permission prompt, and a fresh cloud container carries no settings that would; Pi has no permission prompt, and its `--approve` means trusting project-local files, not tool permission.
Pi passes the admission test under "Costs accepted", a harness that accepts a session id the caller chooses.
The run's harness is chosen once, at approval — Claude Code where `claude` is on PATH, else Pi, and `card approve --harness claude|pi` to name one — and recorded in the plan's state, so every launch and resume of that run, `card ask` included, uses the same one; the model and effort are left to each harness's own settings.
Structured answers take one path on both harnesses: the prompt states the schema and the path of an answer file in the plan's directory, outside the worktree, and the session writes its answer there as one JSON object and responds `done`; the tool checks the file as Tasktron's `parse-agent-answer` checks a final text, and a turn that ends without a valid file gets the repair prompt under "Delivery".
The tool takes the answer the moment the file holds complete JSON, and ends the harness and everything the role's commands left running at once, because a harness's turn ends only when its process exits, and Claude Code's `-p` does not exit while a background task the session started still runs; a server or watcher a role starts to check its work would otherwise hold the turn, and the run, open for as long as it lives.
Pi can background work too, and whether its `-p` waits on that work was never measured, which the answer file makes moot: the answer arrives the same way whatever a harness waits on before it exits.
The tool removes the file before each turn, so no turn reads an earlier one's answer, and reads no answer from the final text, not even as a fallback, so there is one answer path and the final text's form is no source of repair rounds.
Where a harness exits on its own, the tool still reads Claude Code's JSON output for whether the session ended in an error.
Claude Code's own `--json-schema` is not passed for now ("What stays open" below).

## The plan document and the final card

**A document per plan** holds what the plan is: its intent, the design decisions and their reasons, the alternatives rejected and why, and the acceptance criteria.
Its frontmatter carries the plan's branch, the point the branch starts from and the host repository's commit convention, which the tool reads for execution.
Every reconciler reads it, and so do the final card's roles; the implementers and reviewers of other cards never see it.
During a run only the reconciler changes it, within the plan's intent; changing the intent goes to the owner.
Why it is not in the cards alone: a reconciler choosing a new approach after a blocking finding needs the rejected alternatives and their reasons, or it can amend towards an approach authoring rejected while every check still passes.
Which cards make up the plan, and in what order, the tool stores where it likes; reconcilers do not see it, since the tool builds every prompt.

**The final card checks the whole plan.**
Authoring writes it as the last card: how to verify end to end that the plan document's acceptance criteria hold on the finished branch, citing the document for the criteria.
It runs through the same roles as any card, and a gap it finds is a blocking finding: the implementer raises it as one, and a reviewer that finds a gap the implementer missed requests a revision, which brings it to the same place.
The reconciler cannot close that gap, since amending a verification card into implementation exceeds its intent, and new cards change the plan the owner approved; so the reconciler answering the blocking finding stops the run for the owner, and the hand-back names the gap.
The final card's first reconciler, which runs before any implementer, leaves verifying the criteria to the implementer and proceeds even where it sees a criterion unmet, so a gap reaches the card's record and the owner by the one route.
Rejected: offering that first reconciler a stop for the gap as well, which gives one case a second route, and leaving it to stop for `order`, which on the final card is what a gap looks like, so the gap never reached the record.
The owner answers with `card amend`, in an authoring session that adds cards ahead of the final card, which pass the check before approval like any others, and `card approve` then carries the plan on and runs the final card again; it is still open, since the gap stopped it, and the tool appends the gap to its record, so the roles that run it again see what the last run found.
A final card closed done is reopened when a finding joins the plan at its end ("Findings" below), in place: the tool moves it back to `open/`, removes its `closed:` field and keeps its record.
Rejected: the reconciler drafting fix cards as waiting cards, which gives a reconciler authoring's work without the check, and an unattended authoring stage, which drops the interactive check and can loop with no one deciding.
Chosen over a final step the tool always runs, since authoring writes a check fitted to the plan.

**The final card's close note is the owner's guide to the finished plan**: how to see it working, and anything its agents could not check, listed for the owner to try.
It is written before the build, from the acceptance criteria, to preserve the original intent and hand it back after the owner has forgotten the details; it takes the place of Tasktron's manual test plan, which serves the same end.

## Authoring

**Staged**, as an experiment against ad hoc authoring, which "has worked okay, but that doesn't mean it's optimal".
There are three stages, each in a fresh session:

- **Document** writes the plan document, what the plan is, and settles what the host repository decides: the plan's branch, its name following the host's convention (at work, `feature/abc-123-...` for a Jira ticket ABC-123) and the point it starts from, such as `develop`, and the commit convention, where the host asks more than the default under "The close note" — a ticket key or a type prefixed to the subject.
- **Cards** writes the cards, how, ending with the final card.
- **Check** checks the plan document and the cards before approval.

The Document and Cards stages end with `card done`; the Check stage ends with `card approve`, which starts the run, or `card amend`, which returns the plan to the Cards stage.
The Check stage's prompt says in plain words that `card approve` is the owner's word and starts the run, so a fresh session is told the stakes before it can act.

**The cards are plain files where the Cards stage's prompt says**, and the stage's `card done` takes them in: it assigns ids, checks each file's shape, and records the order, with the last file as the final card.
A plan amended after it ran keeps the order of its cards: the cards taken in go ahead of the first card not yet closed done, a plan card closed declined or moot leaves the order, and nothing moves a card, so a card in the wrong place is declined and redrafted.
Cards written for a plan carry no `blocked-by`, since the run follows the order authoring sets.
A card that joins the plan from outside it may carry entries, and those bind: at take-in no card may come before a card it waits on, and a blocker outside the plan must already be closed done, or `card done` refuses and names it.
Nothing in `card` reads `blocked-by` after take-in, since the run follows the order.
Authoring needs no verb that files one card, since a plan's card is live for nothing before approval.
The Cards stage's prompt prints the deck's absolute path, under the git common directory, since a linked worktree's `.git` is a file, so the session sweeps the closed pile with its ordinary tools rather than through a wrapper verb, whose `--` separator is a place literal readers stumble.
The prompt says in words that the session is reading the deck, and a printed prompt is not committed, so printing the path discloses nothing.
The path is printed only there, where a sweep is wanted, which keeps a closed pile a bonus.

**A fresh session per stage**, the plan document being the handoff, so every stage boundary is a free cold read of it.
The owner does not work at a terminal by choice: authoring is always "Please run `card`", and the tool prints the prompt for whatever stage is next.

**Recorded transitions.**
When the owner agrees a stage is done, the session runs the verb that records it, and the tool reads the record; inferring the stage from the document's content was rejected, because a half-written document looks the same as an agreed one.
Approval is only ever the owner's explicit word.

**The check before approval is interactive**: a fresh session checks the plan document and the cards, presents its findings, and edits what the owner decides — the owner at the start, uninvolved through the middle.
It flags a done-condition only the owner can judge on any card but the final one, whose guide is where the owner's own trials belong.
A card it would add goes through `card amend` and the Cards stage, since a card hand-written into `open/` only waits.

## The plan's states and the verb surface

The verbs are the operations the interactive sessions need — the authoring stages, the check before approval, answering a stopped run, settling findings at the end — and no more, because the headless roles act only through their answers: the tool itself puts the card in the prompt, files a run's findings, appends the account and the close note and closes the card, holds the plan's worktree, commits, and checks text for card ids, each deck operation through `deck`'s modules.
The test that decides each invocation: one is justified only where an interactive session needs code to run at a moment the session chooses, and its content rides on arguments or stdin, never on a file left waiting.

A plan is always in one state, which the tool records.
Bare `card` acts on it as the table says and prints the exact commands open in it, so the session copies a command rather than recalling a vocabulary; every other `card` verb is refused there, naming the state and printing the commands that are open.
A held plan, below, is the one exception: it stays in its state and opens no command.

| State | Bare `card` | Open, and where each leads |
|---|---|---|
| Document | prints the Document stage's prompt | `done` → Cards, refused while the document's frontmatter lacks the branch or its start point |
| Cards | prints the Cards stage's prompt, with the deck's path and the waiting cards | `join`, `later` (stay); `done` → Check, taking the cards in |
| Check | prints the Check stage's prompt | `approve` → Running; `amend` → Cards |
| Running | reports the active card and role, and how many cards have closed | `stop` → Stopped |
| Bounced | reports what the stopped role asks, and why | `ask` (stays); `resume` → Running; `amend` → Cards |
| Stopped | reports the card the run stopped at | `resume` → Running; `amend` → Cards |
| Dead | carries the run on → Running | `stop` → Stopped |
| Ended | prints the final card's guide, the branch, the worktree's path, the findings with the role that filed each, and the settling prompt | `later`, `decline`, `promote` (stay); `join` → Cards; `finish` → over |

Running moves on by itself: to Bounced when a role stops the run, and to Ended when the last card closes done.
Dead is Running with its process gone, which the tool detects by pid and boot id ("Where the run lives").
`card decline` and `card promote` are open in every state for a waiting card, and `card drop` in every state for the plan.

A verb that writes more than once — `done` in the Cards stage, `join` at Ended, `amend`, `drop` — records the decision it carries in the plan's record before its first other write, and every invocation of `card` finishes a recorded verb before it does anything else, so a verb that died partway is finished from its record, never undone.
What could refuse such a verb is checked before the record, and what is written after the record gives way to the verb or is kept as newer: a recorded drop removes the worktree by force, so files written into it after the owner decided go with the plan, though a worktree the owner locked with `git worktree lock` still refuses, and a card a recorded `done` filed and someone edited since is kept as edited.
So a recorded verb fails to finish only on a git or disk error, and its plan is then held: it opens no command, not even `drop`, since its recorded decision can be neither undone nor treated as finished, and every other verb assumes a whole state, which a half-dropped plan, say, is not.
The cards the recorded verb carries, those a `done` files and the one a `join` takes in, are the held plan's meanwhile, so no other plan's listing offers them and no other plan's `join`, nor `decline` or `promote`, takes them.
Bare `card` on a held plan prints the error that stopped the verb, then refuses, saying the plan is held until its recorded verb finishes and why it opens no command; with more than one plan in progress, it lists the held plan with its state, marked held, says the same, and prints no command for it.
The next invocation of `card`, any verb and any plan, tries the recorded verb again once the error is put right; other plans, and `decline` and `promote` on waiting cards, go on meanwhile.

- **Starting.**
  Bare `card` with no plan in progress lists the waiting cards, with `decline` and `promote` open for each, and starts a new plan in the Document stage; the plan exists from there, and `card drop` ends one started by mistake.
- **More than one plan.**
  With more than one plan in progress, bare `card` lists the plans with their states and prints each command with `--plan <slug>` filled in, right after the word `card`.
  `--plan` is accepted by every verb in any position; only bare `card --plan <slug>` starts a plan under a slug no plan has, and every other verb refuses a slug it does not know, so a typo cannot start one.
  A plan started without a name gets a placeholder slug, which its document's headline replaces when the Document stage ends.
  A second plan starts while one is in progress when the first is halted for it, the common case at work, where a load-bearing bug gets a ticket of its own and the first plan waits until it lands.
- **Finishing.**
  `card finish` is the owner's word that the plan is over, after trying it in the worktree: it is refused while a finding is unsettled, removes the worktree and keeps the branch, and pairs with `card approve`, so the owner starts the run and ends the plan.
  It is the only verb an unsettled finding holds back.
- **Dropping.**
  `card drop` gives a plan up from any state: it ends a live role session, removes the worktree, keeps the branch, and closes declined, with one note naming the dropped plan, every card of the plan not yet closed done, the one in flight included, since a card that waits decays; cards waiting in no plan stay waiting.

In use: the owner asks a session to run `card`, which creates the deck if needed and prints the prompt for the next stage; when the owner agrees a stage is done, the session runs `card done`, and at the end of the Check stage it runs `card approve`, and the owner invokes nothing through the long middle.
At the end the owner has any session run `card` again, which prints for the owner what the Ended row names; settling needs no entry of its own, and `card finish` ends the plan.

The spelling:

- `card` — the next thing, or where things stand.
- `card done` — a stage the owner agreed is done: the Document stage or the Cards stage.
- `card approve` — the owner's approval, at the end of the Check stage; it starts the run.
- `card amend` — back to the Cards stage, from the Check stage or from a bounced or stopped plan, printing that stage's prompt, since a session amending cards needs that prompt handed to it, which a stop report could carry only by printing a prompt most stops never need.
- `card stop` — stop a run now.
- `card ask`, with the owner's question on stdin — a bounced plan.
- `card resume`, with the owner's answer on stdin or nothing — a bounced or stopped plan.
- `card join <finding>`, `card later <finding>`, `card decline <finding>` with the reason on stdin, `card promote <finding>...` with the draft on stdin, and `card promote <finding>... --key <KEY>` to record the key — settling findings.
  `later` rather than `new`, which would read as filing a card, the act of `deck new`.
- `card finish` — end the plan.
- `card drop` — give the plan up.
- `--plan <slug>` — the plan a command means: needed to start a plan while another is in progress, and to name one while more than one is.

Separate words were chosen over folding the acts into `card done` with arguments: the owner's choice has to be carried either way, so folding saves nothing there, while a session holding a stale picture of the state — the run finished, or another session approved — gets a loud refusal from a word used in the wrong state, where a folded `done` would quietly do what the current state means by it, approval included, which "Recorded transitions" keeps to the owner's explicit word.
For the same reason approval has its own word: a `done` from a session that thinks the plan is still in the Cards stage when it is already in the Check stage is refused, where a `done` that also approved would have started the run.

**Putting a thought down.**
"Put a pin in that" is the gesture the design began with, and the purpose promises "a place to put things down", which a surface whose only entries were an authoring stage and a run's findings would keep only for authoring and for roles.
So `deck new '<headline>'`, body on stdin, files a thought from any interactive session as a waiting card, and no run picks it up until the owner settles it.
It passes the test above: an interactive session needs code to run at the moment the thought comes, and the headline and body ride on an argument and stdin.
It comes back at the next bare `card` with no plan in progress, which lists the waiting cards before it starts authoring, with `decline` and `promote` open for each and the Cards stage ahead to `join` them.
The settling prompt prints only at a plan's end: printed whenever a waiting card existed and no run was live, it would reach a session mid-authoring, with `join` left to guess which plan.

## Two executables: `card` and `deck`

The tool is two programs.
One manipulates a collection of text files under conventions — the deck under the git common directory and its config, the prefix and the ids, the card file with its three frontmatter fields and its `# ` headline, the open and closed directories, the close note and the `closed:` field, and the check of a text for card ids — and knows nothing of agents, plans or branches.
The other understands agents and implements the workflow on one of two harnesses: it builds the prompts, launches and resumes the roles, holds the plan's branch and worktree, stops and answers, settles findings, and is itself run by interactive sessions.

The first is `deck`, named for the collection as `card` was named for the item, and its verbs are boring:

- `deck init <prefix>` creates the deck under a chosen prefix.
- `deck new '<headline>' [--label L]... [--blocked-by <id>]...`, body on stdin, draws an id and files a waiting card as one act.
  It refuses a blocker that is closed or exists nowhere, and refuses to run from a linked worktree, naming the main checkout to run from, since a role session works in the plan's worktree and files findings only through its answer.
- `deck show <id>` prints a card wherever it is, and with `--path` prints its file's location instead.
- `deck list [--open | --ready | --closed] [--label L]...` lists cards, a blocked one with the blockers it still waits on and a closed one with how it ended.
- `deck close <id> --done|--promoted|--declined|--moot`, close note on stdin, moves the card to `closed/`, writes the outcome as `closed:` and appends the note, as one act, and names the cards it was blocking.
- `deck lint`, a text on stdin, fails when the text cites a card id, naming each.
- `deck agent-help` prints, on demand, the conventions a session needs when the owner asks it to touch the deck directly — the file's shape, the verbs, how to cite an id, the one-way reference rule — and nothing prints it unasked; it is prose a model reads, so it lives under `payload/` like the prompts.

`deck`'s modules also do two things for `card`: reopen a closed card in place, and append a record section beneath a card's contract.
The second program is `card`, which the rest of this brief describes, and it touches a card file only through `deck`'s modules.
One package carries both executables, so one install delivers both, and `card` calls `deck` in process, as a library, not as a subprocess: simpler, typed and testable, with the process boundary still available later, since `deck`'s executable is a thin wrapper over the same modules.
The split buys a base that is tested on its own and that the workflow never reaches around, and a human-facing way to look at the deck, `deck list --label` for one, that the workflow's reasoning never has to justify or deny.
The guardrail: `deck` keeps exactly these verbs and the two operations, because a file tool that grows features of its own is a tracker with a CLI, which is the prior this brief displaces.
`deck` creates the deck where none exists, under the fixed default prefix, on `deck new` and when `card` starts a plan, and `deck init <prefix>` chooses another prefix first.
A session that finds `deck` on PATH could list the deck and reason from it; that exposure is accepted, since no prompt sends a session there but the Cards stage, and the rule stands that the tool reads the deck and sessions work what the owner asked.

## Delivery

**Nothing runs unasked.**
No instruction in any session's configuration runs `card`, and no skill is installed: authoring is "Please run `card`", bare `card` acts only when asked, and every printout carries beside it what the session must do with it, so no workflow text reaches a session unasked, not even a description.
Text that reaches a session unasked gets acted on: a status printout that spoke imperatively about the present session once led a fresh session on a corporate machine to implement a ticket it had been handed in discussion phrasing.
Nothing of the workflow is committed to any repository card works in, and `deck agent-help` covers the rare direct use of the deck, on demand.

**Installing is one command**: `bun install -g github:ark3/card` delivers both executables, with Bun assumed present, including in a fresh cloud container.
It installs from the public repository and nothing is published, so there is no registry account, no name to find, and no release step; an install takes the tip of main, a tag or a sha pins a version, and `"private": true` in `package.json` blocks only publishing.
The runtime is Bun, for now: the tool calls Bun's own APIs, its `bin` entries are `.ts` files, which Bun links from a GitHub source, and the Claude Code cloud container carries Bun.
Rejected for now: porting to Node, a real card touching the suite as well; a compiled executable per platform, which no package-manager one-liner installs; and publishing to npm under a scoped name, which adds an account and a publish step per release for a shorter command.

**The tool creates the deck when it starts a plan**, under a fixed default prefix, `card`, asking nothing, and `deck new` creates it the same way when a thought is put down where no deck exists yet.
Every `card` verb but bare `card` acts inside a plan the tool started, and `deck new` and `deck init` create the deck as bare `card` does, so no state of the workflow has no deck, and "no deck here" answers any other invocation with a refusal.
The prefix is not a decision, because the owner does not think about cards one at a time and recognizes them by headline; `deck init <prefix>` is for anyone who wants to choose one before the first plan.

**The tool builds each role's prompt in code**, so every prompt has one reader and reaches that reader directly, with no session between the procedure and the role writing a prompt of its own.
The role and stage prompts themselves are implementation work, written in the implementation cards and not here; this brief carries what governs them: the principles below, each role's outcomes above as the skeleton of its answer schema, and the obligation to keep card's plan apart from Claude Code's plan mode.
The cards that write them draw on this brief and on `reference/tasktron.clj`.
The prose of each prompt lives in one file per reader under `payload/`, imported as text and substituted in code, because the register rules of this repository's AGENTS.md bind that directory and a cold read needs a file to hand over.
The principles are Tasktron's prompting lessons, read from `reference/tasktron.clj`:

- **Code steers, so no prompt does.**
  No Tasktron agent decides what comes next, whether to stop, whether to ask the owner, who commits, or whether it may act; code decides all of it.
  In this project's own history the prompt passages hardest to get right across models — the mode fork, authorization, when to stop, who commits, guidance read by a dispatched agent it was not addressed to — were all a model steering the workflow from prose, which is the price of judgment living in prose; prompts that never ask a model to steer never have to survive the difference between how two models read them.
- **One reader per prompt.**
  Each prompt is built for one role and one step, and no agent sees another role's text, so "you" is always the right reader and the register rule "a sentence that grants what another role is denied names the granted role, never 'you'" never arises.
- **The schema is the instruction.**
  The answer instruction is generated from the same schema the code validates against (`final-answer-instructions`), so the instruction cannot drift from what the code accepts.
- **A malformed answer gets a repair prompt scoped to the report alone** (`prompt-answer-correction` in `reference/tasktron.clj`), sent by resuming the same session, at most twice before the role counts as failed ("When a role fails").
  It has three parts: a fence around the work — "The work attempt is finished. Do not continue implementing or reviewing. Do not modify any file except the answer file named below. Correct only the report you write there."; the validation error quoted back verbatim after "The previous report was invalid:"; and the answer's schema restated.
  Resuming keeps the agent's knowledge of what it did, and the fence keeps a format error from reopening the work, so a bad report costs one short turn rather than a fresh session; card's role answers are machine-read the same way and want the same repair.
- **The strongest sentences state their own mechanism.**
  "subtasks execute in temporary git worktrees at a different filesystem location, so absolute paths resolve to the wrong checkout"; "the body ... is included verbatim in every subtask agent's prompt, so duplicated material is paid for once per subtask".
  Sentences that patch an observed failure are concrete and carry their reason, such as the slug rule with its worked example (`configure-srcdbclj`, "not `configure-src-db-clj`") and "A dangling `dependencies:` id is invisible on reading".
  This is the register rule "an exception states what its rule protects", reached independently.
- **A prompt can pre-empt the host project's own instructions.**
  The worktree preamble ends "any instruction to put work on a branch does not apply here", because a headless agent also loads the repository's agent files, which may say otherwise.
- **Each outcome states what follows from choosing it.**
  The reviewer's `amended` option ends "because your edits go to integration once the checks pass rather than to another review", which turns choosing a label into deciding on the stakes.
- **The review procedure has a countable answer.**
  "Work through the subtask body one requirement at a time and name the code that satisfies each. Report any requirement you cannot point at"; every requirement either has a pointer or does not, which is this repository's own "ask for the answer, not for the reading experience" applied to review.
- **The weakest prompts are the borrowed ones.**
  The authoring prompts are adapted from a generic brainstorming and planning template ("YAGNI ruthlessly", sections of "200-300 words", a bold "Key Principles" list restating the process above it): they say things twice, advise rather than direct ("Prefer multiple choice questions"), and the plan prompt uses `## Subtasks` both as a heading of its own instructions and as the name of the document's section.
  They survive because the owner sits in that conversation and corrects course, which is the only place loose prose is affordable; this repository's register rules would reject them, and card's stage prompts should not copy them.

**What the tool prints for the owner, the session relays unaltered.**
A session runs every invocation of the tool, never the owner at a terminal — resuming a stopped role session at a terminal is not an invocation of the tool — and the owner sees a command's output only by going to look, so anything the tool means for the owner reaches the owner only in the session's reply.
A session left to its own judgment retells, and a retelling is a second copy that drifts from the first: a promotion text that is retold proves nothing the card-id check said about what the owner posts, and a condensed final-card guide can drop the one step that mattered.
So the tool's output has two registers: text for the session, and text for the owner, marked as such, which the prompt beside it directs the session to put in its reply unaltered, not summarized — all of it, not only where exactness matters, because one rule asks a literal reader for no judgment of category, and text the tool marks for the owner is already written for the owner.
This is "code steers" applied to what the owner hears: the tool decides what reaches the owner, not a session's sense of what is worth repeating.
It binds every site where the tool tells the owner something: the stop and what it waits on, the findings and the settling prompt, promotion text, the final card's guide, and progress.

## The card file and the deck

The card file's format is the API, and it stays greppable.

- A card is a markdown file named by its id, with exactly one `# ` line, its headline, which never wraps, and prose below it in whatever shape its own work needs.
- Text the tool pastes into a card from a session — an account, review feedback, a gap, a close note, a promotion draft, a finding's body — is re-leveled beneath the section it is written under: outside fenced code, its headings shift down together until the shallowest is level 3, and a fence it leaves open is closed at its end, so no pasted text can read as a headline or a record boundary.
  Every reader of a card's structure decides what is fenced code by one rule, and the tool closes a fence the text above a record heading leaves open before it writes the heading.
- Its frontmatter permits three fields and no others, one line each and no block sequences, so a grep for `^labels:` shows a line with its values: `blocked-by:` and `labels:`, lists the author writes, and `closed:`, the outcome the tool writes at close.
  Each field is optional: a writer omits a list that is empty, `closed:` appears only on a closed card, and a card with no fields has no frontmatter.
- Labels are opaque strings the tool stores and matches, with no opinion about what any of them mean.
- An id is the deck's prefix and random consonant-vowel syllables, drawn, checked against both directories and created exclusively as one act, because writers are unbounded even on one machine.
- A card ends one way: it moves from `open/` to `closed/`, gains `closed:` holding `done`, `promoted`, `declined` or `moot`, and gains its close note under a `## Close note` heading.
  `done` says the work landed where the card said it would; the other three say it never happened: `promoted`, the work went to a public ticket; `declined`, someone chose not to do it; `moot`, the reason the card existed is gone.
- No card is rewritten because another changed, so every relation is computed at read time and never maintained as an index, which is what keeps the deck something a person can edit with an editor and a grep.

Where the deck lives:

- The card directory is `CARD_ROOT` when that is set and `<git-common-dir>/card` otherwise; it holds `card-config.toml`, which names the prefix and the deck's path relative to the card directory, `deck` by default.
- git never traverses `.git/`, so the deck needs no ignore rule anywhere and survives `git clean -xdf`.
- Every worktree resolves to the one deck and every clone to its own, which is accepted, since worktrees are what this workflow cuts.
- The prefix is recorded in the config and never derived from the filenames present, since a derived prefix guesses wrong the day a deck holds a card copied in from elsewhere.

The runtime has no runtime dependencies: everything is in Bun.
`bun run check` runs `bun test` and then `tsc --noEmit`, because Bun strips type annotations rather than checking them, and the checker is what makes them true on the lines tests never run; TypeScript is pinned to an exact version, because an unpinned checker starts failing when TypeScript releases, not when the code changes.

The one-way reference rule: cards cite public keys — tickets, branches, commits — freely, and nothing public ever cites a card id: not a commit message, not a pull request, not a comment in the code, not a close note, not a promotion text.
It is the entire privacy boundary, and it is checkable, so the tool checks it on every deck: on every close note and every promotion text, and on the lines each card's diff adds, before the card's commit is made.

## Costs accepted with eyes open

- **The deck has one copy, and it may not outlive its container.**
  It sits under `<git-common-dir>/card/`, which nothing syncs and no clone carries, and in a cloud container it dies with the container.
  Accepted because nothing depends on it lasting: what must outlive a plan goes into documentation or code as the plan's own work, each card's commit carries its close note, and the backlog lives in the owner's ticket layer.
- **An implementer will sometimes knowingly build a card it thinks flawed**, and the flaw becomes a card instead of a fix.
  That is the price of an implementer whose frame of mind is implementation.
- **The plan's branch is not in the main checkout until the plan ends.**
  The tool holds it in the plan's worktree so that git refuses a second checkout; the owner tries the finished plan there, at the path the hand-back prints.
- **Cards go stale against code the owner does not control** while a plan is in flight.
  The reconciler is the answer: a check against the tip before every card, load-bearing rather than hygiene.
- **A run that dies loses the card in flight**, which reruns from its reconciler on a clean worktree.
- **A usage limit stops the run until the owner resumes it.**
- **The diff check can refuse an id-shaped string the code really needs**, such as a fixture in a test, and the run then stops for the owner.
- **A fact lives in two trees.**
  Retiring every copy of an overturned fact is a sweep over the repository and a second over the deck, and nothing reminds you of the second.
- **The tool names its harnesses in code.**
  It launches `claude -p` or `pi -p`, sets the session id, and resumes by it ("The harness"); a harness joins only if it accepts a session id the caller chooses, which the collision under "Stopping and answering" makes a requirement rather than a convenience.
  Pi accepts one; Codex was weighed and left out on that test: `codex exec` lists no `--session-id`.

## What stays open

- **Pausing, or steering a role partway through a card**, waits until a real run shows the owner wants it.
- **Waiting out a usage limit**, rather than stopping the run, waits until a real run shows the stall matters.
- **What Pi's plain `-p` shows when a session fails** is unchecked, and "When a role fails" rests on it there; Claude Code's JSON output says so directly.
- **Claude Code's `--json-schema`** is deferred, not dropped, until a check of where the answer lands when it is passed.
  In the checks so far a schema answer arrived in a `structured_output` field and left a synthetic "No response requested." reply in the transcript, which a resumed model reads as its own, so the text parse may find no answer where the flag is passed.
  If it is passed, it goes only on invocations whose answer the tool reads, never on a question-only resume, and a relay prompt should not lean on "your last answer".
- **Whether a ticket layer keeps a deck sized to one plan** is a conclusion not yet observed.
  A sweep of agentpane's deck, promoting everything into tickets, is the experiment; how often several cards fold into one ticket is the number to record, since it says how much of the pile was backlog written at card grain too early.
  If the deck afterwards holds only what is being worked and that feels right, the rule is confirmed; if it refills with things that are neither tickets nor work, the ticket layer is not the whole story.

## Acceptance criteria

The design is implemented when every one of these holds on the finished branch; the last card of the work that builds it checks them.

1. **The surface.**
   In a git repository with no deck, bare `card` creates the deck under the prefix `card` and prints the Document stage's prompt.
   `card`'s verbs are `card`, `card done`, `card approve`, `card amend`, `card stop`, `card ask`, `card resume`, `card join`, `card later`, `card decline`, `card promote` in its two forms, `card finish` and `card drop`, with `--plan <slug>` accepted by any.
   `deck`'s verbs are `deck init`, `deck new`, `deck show`, `deck list`, `deck close`, `deck lint` and `deck agent-help`.
   Each executable refuses any other verb as unknown.
   In every state of the table under "The plan's states and the verb surface", bare `card` does what the table says, and every `card` verb not open there refuses, names the state, and prints the commands open in it.
   Only bare `card --plan <slug>` starts a plan under a new slug.
2. **Staged authoring.**
   Three stages, each printed by bare `card`.
   `card done` ends the Document stage, refusing a document whose frontmatter lacks the branch or its start point, and ends the Cards stage by taking the card files in: ids assigned, shape checked, the order recorded with the last file as the final card, and every `blocked-by` entry enforced against that order and the deck.
   `card approve` ends the Check stage, records the harness, starts the run and returns at once.
   `card amend` returns to the Cards stage from the Check stage, a bounce or a stop.
   A cold read of each stage prompt tells card's plan from Claude Code's plan mode.
3. **Executing one card.**
   Under either harness, chosen at approval by the PATH rule or `--harness` and recorded for the run, the tool launches reconciler, implementer and reviewer as fresh headless sessions with fresh recorded ids, each prompt built in code from one payload file per reader, each answer parsed from the session's output against the role's schema stated in the prompt, with the repair prompt on a malformed answer at most twice.
   Routing matches "Executing one card", "Stopping and answering" and "When a role fails".
4. **Findings and the record.**
   Every role's answer shares one optional findings field.
   Each finding is filed into `open/` in no plan's order, so no run picks it up, with the filing role, card and plan in the body's first line.
   The account, the feedback and the close note are appended beneath the contract.
5. **Landing.**
   The branch is created from the start point if absent and held in the plan's worktree under `.worktrees/` until `card finish` or `card drop`.
   Each card lands as one commit, its subject under the convention the plan document records and the close note as its body, after the id check on the message and on the lines the diff adds, an empty commit where the card changed nothing.
   An implementer's own commits are undone with the changes kept.
   The main checkout is never touched.
6. **Stopping and answering.**
   The run stops at the first card that does not close done, and at a role that ends without a valid answer, with the cause named.
   Bare `card` reports a bounced or stopped plan and waits.
   `card ask` relays a question to the session whose answer stopped the run and prints its answer for the owner.
   `card resume` continues with the owner's answer or with nothing.
   `card stop` ends the role session, discards the in-flight work and leaves the card open to rerun from its reconciler on a clean worktree.
7. **Where the run lives.**
   The run outlives the invocation that approved it.
   State is written after every card.
   Liveness is pid plus boot id.
   A dead run is carried on by bare `card` from the last card closed, the card in flight rerunning from its reconciler on a clean worktree.
   During a run bare `card` reports the active card and role and how many cards have closed.
8. **The plan document and the final card.**
   Reconcilers and the final card's roles read the plan document, and nobody else does.
   The final card runs last.
   A gap it finds stops the run; `card amend` adds cards ahead of it, and `card approve` runs it again with the gap in its record; a finding joined at the plan's end reopens it in place.
9. **The end.**
   With every card done, bare `card` prints the final card's guide, the branch, the worktree's path, the findings by headline with the role that filed each, and the settling prompt.
   `card join` moves a finding into the plan and takes the plan back to the Cards stage; `card later` records the decision and leaves the card waiting; `card decline` closes it; `card promote` takes two invocations, with the id check first.
   `card finish` refuses while a finding is unsettled, then removes the worktree and keeps the branch.
   `card drop` ends a plan from any state, closing declined, with one note, every card of the plan not yet closed done.
   `deck new` files a waiting card, and with no plan in progress bare `card` lists the waiting cards and starts authoring.
10. **The owner register.**
    Everything the tool means for the owner is marked for unaltered relay at every site "What the tool prints for the owner" names.
11. **Delivery.**
    `bun install -g github:ark3/card` installs both executables.
    Nothing is added to any session's configuration, and nothing of the workflow is committed to a repository card works in.
    `deck agent-help` prints the deck's conventions on demand, and nothing prints them unasked.
    A cold read of the Cards stage's prompt and of `deck agent-help`, asked what the deck is for and what an empty deck says, answers that the deck holds a plan's cards while the plan runs and that an empty deck says nothing about whether there is work.
12. **The card file and the deck.**
    The card file's format as "The card file and the deck" states it.
    The Bun runtime, with `bun run check` green.
    The deck under the git common directory, with its config beside it.
    The one-way reference rule checked on every close note, promotion text and card diff, on every deck.
