# card — design brief

Written 2026-10-26, from two conversations with the owner, on 2026-10-02 and 2026-10-26; where the second revised the first, the second governs, and this brief records the result.
`card` cuts a plan into pieces small enough to run one per fresh session, and runs them: an item of work is a **card**, and a repository's cards are its **deck**.
This brief supersedes the first, kept verbatim at `reference/brief-2026-08-20.md` as the founding record: the lineage from agentpane and its deciding item (`reference/OW-59.md`), the argument with beads, why the tool and its noun are named as they are, and the mechanics this brief cites by section rather than restates ("What the first brief settles that still holds, and what changes" below).
The first brief is superseded for its order, not for error: it leads with the deck as externalized memory and a private corpus, and a reader who takes that lead holds the deck as a tracker — a durable store whose state is the project's state — from which "an empty deck means nothing to do" and "an ephemeral deck is worthless" follow as one inference.
The payload, the prose the tool prints to operate the workflow, derives from the brief, so a brief that teaches that prior re-teaches it with every derivation; a prior is displaced by another prior and never by rules, a reader holding the purpose does not need denials — the register rule that an exception states what its rule protects, applied to the whole document — and the purpose below is the one this brief puts first.

## The purpose: a plan in pieces

The owner, 2026-10-02.
"Plan mode" in these words is Claude Code's own: the mode in which a session drafts a plan and the owner approves it before the session touches anything.
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

In one sentence, which the owner accepted: sessions small enough to do good work, and a place to put things down that makes small sessions safe; everything else is mechanism.
Decomposition is how a session gets small, filing is how it stays small, the hand-back is how what it put down reaches the owner, and privacy is a constraint on where the deck can live, not a goal.
On the lineage, the owner: "The thought process started with Yegge's beads, which was all about concurrency and being very hands-off for the human, but the valuable part was the focus and the cooperating agents."

The mechanism is the answer to that paragraph, and it has four parts.

- **Authoring is plan mode that emits pieces.**
  The owner and a session settle, in stages, what the result is and how to reach it: a plan document stating the intent, the decisions and the acceptance criteria, and the cards that do the work, each grounded and sized for one fresh session, the last of them checking the whole against the criteria.
  Approval is the owner's explicit word, and it starts execution.
- **Execution is the tool running every piece, with no session above it.**
  For each card, in the order authoring set, the tool launches three fresh headless sessions in turn — a *reconciler*, which checks the card against the code as it now stands and amends it within its intent; an *implementer*, which builds exactly the card; and a *reviewer*, which checks the result against the card's own done-condition — and routes on each one's answer in code.
  No session chooses which card runs, reviews an implementer's work in its own context, or recommends what to run next; the tool decides every next step, and a session's judgment reaches the workflow only through the answer the tool reads.
- **Findings are written down, one card each, and never acted on by the role that found them.**
  Whatever a role notices outside its card goes into its answer, the tool files it as a card marked not yet accepted, and the role goes on with its card; the duplicates are the owner's to worry about later.
- **The owner is at the start and the end.**
  The owner, 2026-10-26: "I want to be there for the start and the end, and be uninvolved for the long middle."
  Between approval and the end of the plan the owner is reached only when a card bounces — its intent is wrong, it depends on work no earlier card landed, or a cap ran out — and the run stops there until the owner answers.
  At the end the tool hands the finished plan back: the final card's guide to seeing it work, and every finding by headline, for the owner to work, promote or decline, one decision at a time.

The deck holds a plan's cards while the plan runs, and that is what it is for.
Done is a fact about the plan — every one of its cards closed done — which the tool reports; it says nothing about whether the owner has other work, and an empty deck says nothing about that either.
Only the owner decides whether there is work, and says so by authoring a plan.
On the deck as a tool, the owner, 2026-10-02: "There is no right deck. Why are you treating the deck like a backlog? Isn't the whole point of this work that the deck isn't a backlog, it's a tool? If the session creates cards, it also makes me aware. It's up to me to execute or decline or promote those cards."

**Names, settled 2026-10-26.**
The unit of execution is a *plan*, and its document is the *plan document*.
The owner's "the thing" names the desired result — the feature, capability, fix or chore — and the plan is the doing of it: the plan document states the result as its intent and acceptance criteria, the plan's cards are its pieces, "the plan is done" means its cards closed done, and the result is what the final card's guide shows the owner.
The name was chosen because the owner's own account of the design runs through plan mode, so the name teaches the purpose; its cost is Claude Code's plan mode, which also produces something it calls a plan, and the stage prompts, which interactive sessions read, possibly in that mode, must keep the two apart.
A *run* is one plan's execution, from approval to its end.
The *hand-back* is what the tool prints for the owner when a run stops or ends.
An *interactive session* is the one the owner converses with; a *role session* is a headless one the tool launches.

## The deck is a store, and no session reads its state as its assignment

The deck is a durable store, said plainly: cards are files under the repository's `.git`, and a closed card stays there with its note.
The battle was never durability.
The two behaviours the owner does not want are a session concluding there is no work because the deck is absent or empty, and a session closing cards because it judged the work over; both are a session reading the deck's state as its assignment, and the rule against that is one real trackers also carry and models already hold: sessions work what the owner handed them.
Under the redesign the rule has little left to bind, because no session reads the deck to decide anything: the tool reads it, and a session touches it only by running the tool at the owner's ask.
Conceding that the deck is a store lets the denials go, and the test that this worked is that the payload derived from this brief is shorter than the one before it.

What the deck lasting does not buy is any part of the workflow.
No part of the workflow may depend on the deck lasting (2026-10-26): the workflow works with no closed pile at all, a closed pile is a bonus where a deck persists, and in an ephemeral container the deck must empty before the container does, every finding worked, promoted or declined.
Tracking cards in git — a deck committed in the repository's tree, as agentpane's is — is what card moves away from: agentpane showed it counterproductive, and what must last lives elsewhere ("The backlog lives above the deck" below).
The committed-deck feature need not be dropped at once, but nothing is optimized for it; the private deck under `.git`, which git does not track, is the working store.

## What the deck does for the work

The benefits were experienced in agentpane rather than predicted, and four of the first brief's five survive.

- **Small grounded cards yield high-quality work.**
  Authoring forces the grounding — paths, symbols, what done looks like — before execution starts, and a fresh reading of a card before it is built has found some twenty real defects in a card that read finished; under the redesign that reading is the reconciler's, and every card gets one.
- **Scope creep converts into new cards.**
  The known agent failure of drive-by "improvements" becomes an encouraged result instead: write it down, do not do it.
- **No session grows past one card.**
  The first brief called this "The session stays thin" and meant the session that dispatched the work; under the redesign no session dispatches.
  The tool holds the run's state, the reconciler reads the plan document, and an implementer or reviewer sees one card's prompt and nothing else — the final card's roles alone see the plan document beside it — so what a role finds lands in the deck rather than in a context that must then carry it; the card is the handoff, and a long-lived context is not a prerequisite for good work.
- **Externalized memory, within a piece of work.**
  A finding written down is one the next role or the owner can read: no "which conversation was that in" within a plan, and no fear of a session's context running out mid-plan.
  The guarantee is narrower than the first brief's "a single place for anything that must not be forgotten": the deck remembers for the plan, and what must outlive the plan goes into documentation or code as the plan's own work.

Dropped: "The closed corpus is accumulated archaeology."
Its "nothing is relitigated from scratch" makes the closed pile an archive and the deck a record, which is the tracker prior again, and the owner accepts an occasional re-derivation: "worry about the duplicates later."

The discipline that produces these — grounded authoring, a done-condition on every card, review of every diff — lives in what each role's prompt asks of a model, not in anything the tool decides, though the tool now builds every prompt ("Delivery" below).
**The tool automates placement, never judgment.**
Every verdict is reached by a model, and code only routes on it.

## Why filing: focus

A finding is written down so that whoever found it can put it down.
That is the whole reason: write it down so you can put it down, and the hand-back carries it to the owner.
The first brief motivated filing by survival — "a finding not written is gone" — and the payload derived from it says so in stronger words, a finding "dies with the session" and a card is "its own only copy"; that vocabulary is retired wherever it motivates filing, because it teaches the deck as the store of what must not be lost, which is the prior this brief displaces, and survival is at most a property of a card, not the reason to write one.
Filing stays cheap for the same reason: a finding is written in the deck's private register, in whatever words the role has, and rewritten only if the owner promotes it.

## Two deployments

The two deployments split by what sits above the deck, not by public versus private.

- **Work.**
  A corporate repository — governed by rules the owner does not set and shared with colleagues not running this workflow — with a Jira ticket fanned into a plan and a private deck under `.git` on the server.
  Nothing of the workflow is committed to the repository: not the deck, not the prompts, and not a skill file, which would disclose the workflow as surely as the deck would.
  This is the control case, working and unchanged in shape; what changes is delivery: no `sbox` wrapper is required, since sandboxing belongs to the harness, and no `card status` runs at the start of every session ("Delivery" below).
- **Personal.**
  The owner owns the repository, so a deck committed in its tree is possible, and on 2026-10-02 that was the choice, so that every clone carried the deck; it fell on 2026-10-26 with the rule that nothing depends on the deck lasting, and a personal repository now has the same private deck under `.git` that a work one does.
  A Claude Code cloud container works because the tool runs there, not because a session in it dispatches anything: the container has `claude`, and a session there launched `claude -p`, whose session in turn launched a subagent (the owner's check with Haiku, October 2026, which flagged `MAX_SUBAGENT_SPAWN_DEPTH=1` as possibly needing adjustment).
  Authoring's fresh session per stage works there too, since `/clear` keeps the container's filesystem (the owner's quick experiment, 2026-10-02).
  A session in the container is an interactive session like any other, running `card` at the owner's ask; a deck created there empties before the container does, by the rule above.
  The container's VM stops within minutes of the session going idle, so a run there proceeds only while a session keeps it awake ("Where the run lives" below).

## The backlog lives above the deck

Cards are priced for execution soon, so a card that waits decays, and a durable deck with nothing above it turns into a backlog, which cards are the wrong shape for.
The owner, on agentpane: "It's not the public aspect ... It's more that cards are not a good way to manage a backlog, and yet having a durable set of cards causes me to use it that way anyhow."
At work Jira absorbs the backlog, so the deck stays one plan's worth; a personal project has no layer above, so the deck becomes it.

So, as advice to the owner rather than a rule for sessions: a deck is sized to one plan with a ticket layer above it, and a project with no ticket layer will turn its deck into a backlog, so give it one — a repository's own issues will do for a personal project.
Card designates no ticket layer and assumes none: one may not exist for a given plan, may not hold what matters, and may be unreadable or unwritable to the agent, so what authoring produces lives in the deck, and a finding reaches the ticket layer only by the owner's promotion, on text rewritten to be public-safe ("Findings become cards marked not yet accepted" below).
Card has no lasting tracker of its own and needs none (2026-10-26): the backlog lives in whatever ticket layer the owner already uses, the record of what was done lands in git, each card's commit carrying its close note, and the plan document's rationale dies with an ephemeral deck.
That last is accepted: "things that really want to be saved need to be in documentation or code comments", so a plan whose decisions must outlive it carries them there as part of its own work, and a merge request is not a place to store information (owner, 2026-10-26).

**Pending the sweep.**
The sizing rule above is conclusion, not yet observation, and one experiment tests it.
The owner, 2026-10-02:

> "the way to find out would be to do a sweep there and promote everything, probably *combining* several cards into individual tickets.
> Perhaps that's the correct next step, to un-backlog Agentpane and see how things feel there, keeping the work use-case as-is."

If agentpane's deck afterwards holds only what is being worked and that feels right, the rule is confirmed; if it refills with things that are neither tickets nor work, the ticket layer is not the whole story.
How often several cards fold into one ticket is the number to record: it says how much of the pile was backlog written at card grain too early.
The sweep happens in agentpane, whose own deck tracks it, and the owner reports its result; on 2026-10-26 the owner judged the redesign orthogonal to the sweep, so this brief did not wait for it.

## Rejected along the way

Each with its reason, since a rejection without one is relitigated.

- **A real tracker in the cards role.**
  The owner has Jira for work and does not want one for cards; a tracker would bring the store prior back by construction, lose the dependency edge and the tool's own delivery of the workflow, and put a personal token on corporate machines.
- **An append-only findings file.**
  It needs a triage pass to become anything; a card is executable the moment the owner accepts it.
- **A "durability horizon".**
  A construction a session made to reconcile "not that durable" with the survival vocabulary; unneeded once the vocabulary says store.
- **A deck committed in a personal repository's tree, with a committed config to find it by.**
  Chosen on 2026-10-02 so that a fresh clone would carry the deck, which left a gap — the config lived under `.git` and a clone had none, so the tool reported no deck — and both fell on 2026-10-26 with the rule that nothing depends on the deck lasting.
- **Refusing to create a deck unasked — reversed.**
  On 2026-10-02 auto-creating a private deck was rejected as a workaround the committed deck made unnecessary, and an earlier decision had settled that adopting card in a repository is the owner's decision and not a session's, so the tool's no-deck messages named no remedy.
  Both premises fell: the committed deck went, and under "Delivery" nothing runs unasked, so every invocation is the owner's ask and running `card` is the owner adopting it.
  The tool now creates the deck when it starts a plan, and the earlier decision is prior art this brief overrides.

## Execution and authoring, redesigned

Settled with the owner on 2026-10-26.
The conversation began on 2026-10-07 by reading Tasktron (`reference/tasktron.clj`; its source and what card draws from it are in `reference/README.md`), a single-file script that authors a plan in interactive stages and then executes every subtask unattended, each role a fresh headless agent session whose prompt is built in code.
The owner's aim: the Tasktron-shaped benefits of card everywhere, including a fresh checkout in an ephemeral Claude Code cloud container, while keeping card's benefits.
The owner's principle, which most of what follows serves: "I want to be there for the start and the end, and be uninvolved for the long middle."

### The frame

- **The unit of execution is the plan, not a set of cards.**
  Authoring settles what the plan is and how to do it; after the owner approves, execution does all of it.
  The owner never picks cards to run, and nothing recommends what comes next: "either the thing will be done (nothing left to do) or it won't be done."
- **No dispatching session is required.**
  The tool decides every next step, and launches each role itself as a fresh headless `claude -p` session, which the cloud-container check under "Two deployments" showed works there.
  A relay, in which an interactive session passes tool-built prompts to its own subagents, was sketched and judged unnecessary.
  The `sbox` requirement goes: sandboxing belongs to the harness.
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
It bounces to the owner when the intent itself is wrong, when the card depends on work no earlier card has landed — a problem of order for authoring to fix — or when it cannot reach agreement with the implementer within a cap.
It is named "reconciler" over "editor", whose instinct is to improve prose and which invites rewriting cards to taste, and over reusing "author".

**The card is a fixed contract for each implement-and-review cycle.**
The owner: "the 'conversation' between the implementer and reviewer will be much more productive if they share a single notion of what the card is."
Only the reconciler changes a card, and never during a cycle.
The contract is the card as authoring and the reconciler wrote it; what the tool appends during a cycle — the implementer's account, the reviewer's feedback, the close note — is the card's record, beneath the contract and never part of it.

**Implementer.**
Implementation only: "I really don't want the implementer thinking about whether the card is correct. I want the implementer's frame of mind to be implementation."
A finding that does not block the work goes into the implementer's answer, and the tool files it as a card.
A finding that blocks it — the card cannot be implemented as written: something it cites is absent, its approach cannot work, its done-condition cannot be reached — bounces to the reconciler, and the two converse until they agree, within a cap.
On agreement the card is amended, the tool discards the uncommitted work by resetting and cleaning the plan's worktree, and a fresh implementer starts there.
This path is rare and allowed to be expensive; the discovery survives in the amended card, and discarding the work removes the implementer's reason to steer the amendment towards what it had built.
Accepted cost: an implementer will sometimes knowingly build a card it thinks flawed, and the flaw becomes a card instead of a fix.

**The implementer's account.**
The card plus the diff is not enough to review: "The card does not carry what the implementer has discovered during implementation."
The implementer returns an account — choices made within the card's room and why, what it tried and dropped, constraints it found, what it noticed and left alone, its doubts — and the tool appends it to the card.
The reviewer takes the account as claims to check against the code, not as reasoning to inherit; handing it the implementer's whole session would cost the independence a fresh reviewer exists for.

**Reviewer.**
A fresh session gets the card, now carrying the account, and the diff, and runs the card's done-condition itself; there is no machine check and no `check:` field.
Its verdict drives the tool, and it chooses one of three outcomes: approve, with the close note; fix small things itself, with no second review; or request a revision.
Feedback is appended to the card and the same implementer session is resumed — one implementer per version of the card, since an amendment after a blocking finding starts a fresh one.
The revision rounds are capped, and a cap that runs out stops the card for the owner.
The three outcomes give the reviewer the judgment a dispatching session used to exercise — send it back, fix it, or, for a badly written card, start fresh, which is now the reconciler's path.

**Landing.**
Execution starts by making sure the plan's branch, named by authoring, exists: the tool creates it from its recorded start point if it is absent, and uses it as it stands if it is present, as when the owner made it or a stopped run resumes.
The tool then holds that branch checked out in a worktree for the plan for the whole run, so git itself refuses to check it out anywhere else while the run is live, and the tool never touches the main checkout or cares what it has checked out; the owner accepted not having the branch in the main checkout during a run as the price (2026-10-26).
Cards run in series in that one worktree: the implementer works there uncommitted, the reviewer reviews the uncommitted diff and makes its small fixes in place, revision rounds continue on the same state, and on approval the tool makes the card's one commit, with the close note as its message, and closes the card done (owner, 2026-10-26).
This was chosen over a worktree per card, cut from the plan's tip and fast-forwarded back, because a fresh tree can need its dependencies installed before anything runs, once per card, while the roles of one card never run at once and nothing needs their work apart; disposal in place is deterministic code, and one commit per card matches the card as the smallest unit.
An implementer that commits out of habit moves the worktree's HEAD, which the tool detects and undoes, keeping the changes.
When every card has closed done and the findings are settled, the tool removes the plan's worktree, so the owner can check the branch out, and leaves the branch.
Before then the owner tries the finished plan in that worktree, whose path the tool prints with the final card's guide, since the guide asks the owner to try it before settling (owner, 2026-10-26).
The tool creates and merges no branches but the plan's and its own temporary ones; landing the plan's branch anywhere else, such as a merge request to `develop`, is the owner's act after the run.
The reconciler's check against the current tip absorbs an earlier card changing the ground under a later one, which under today's payload ends a set.
Parallel runs are a separate decision that nothing here needs; they would bring per-card trees back.

**Stopping.**
The run stops at the first card that does not close done, and the owner usually wants to question the stopped session before answering it, since that session holds the context; the tool chose its id, so it can always be reached (owner, 2026-10-26).
Both routes stay, and the owner picks: where a terminal is at hand, the owner resumes the stopped session interactively, which works freely on the owner's machine; where none is, as in a cloud container, the owner's interactive session relays, putting the owner's questions to the stopped session by resuming it headless, and once the owner has decided, the answer goes through the tool, which resumes the session to continue and reads its answer against the schema.
The relay route was checked on 2026-10-26, on the owner's server and in a cloud container: a stopped `claude -p` session answers question-only resumes without resuming its work or touching files, and a later resume carrying the decision finishes the work against the schema.
Choosing the id is required, not only convenient: in a cloud container every `claude -p` launched without `--session-id` got one and the same id, across containers and working directories, appended to one transcript per directory, and a resume of that id followed only the newest call's conversation, so roles of one card launched in series in one worktree would collide and a resume would reach the wrong one (checked October 2026).
So the tool launches every role session with `--session-id` set to a fresh uuid it records, and resumes by that uuid; unsetting `CLAUDE_CODE_SESSION_ID` did not help.
Rejected: the owner's session reading the stopped session's transcript and answering from it, which has one model reading another's reasoning with no way to ask what it meant.

**Where the run lives.**
Approval starts the long middle, hours of role sessions the owner does not wait for, so the run must outlive the turn and the session that started it, and a check on 2026-10-26 settled where it can.
On the owner's server a detached process survives the end of the turn and the exit of the `claude -p` that started it, reparented to the sandbox around the daemon that launched the session, and dies only when that sandbox exits; two heartbeats, one from the session's shell and one from a `claude -p` child that exited straight after, ran on with no gap for the hour observed.
In a Claude Code cloud container it does not: the container is a microVM that stops within about five minutes of the session going idle, one sample, and comes back as a fresh boot with its disk kept and every process gone.
So the tool never relies on the run surviving: it writes enough state after every card for a dead run to resume from the last card closed, since the disk and the plan's worktree survive the stop, and the resume discards the in-flight card's uncommitted work as `card stop` does, so that card reruns from its reconciler; it records the kernel's boot id beside the run's pid and treats a changed boot id as death, since pids restart low after a boot and a pid file alone can name an unrelated live process; and in a cloud container a run makes progress only while some session keeps the VM awake, which leaves an unattended run there open ("What stays open").

**Findings become cards marked not yet accepted.**
The reconciler, implementer and reviewer all report findings, through one optional field every role's answer shares, and the tool files each one the same way, noting the role that filed it (owner, 2026-10-26).
A finding is something outside the card's contract that the reporting role must not act on; a problem inside the contract goes through that role's own outcomes — the reviewer's revision, the reconciler's amendment or bounce, the implementer's blocking bounce — because a defect filed as a finding lets its card close done with the defect parked behind the mark.
The reviewer is the reason the field is shared: a fresh reader of a diff sees what the implementer was too close to, and without the field it either drops what it sees or widens "fix small things itself" past the card.
The tool hands a marked card to no implementer and treats it as ready for nothing until the owner clears the mark; at the end of the plan the owner settles each: work it now, promote it, or decline it.
Why the gate: agentpane's deck, with nothing above it, reached 93 open cards, 56 of them filed by reviews and runs, and filed 281 cards against 275 closed between 2026-09-23 and 2026-10-15.
Why still a card: a card is executable the moment it is accepted, with no triage pass to turn it into one.
The owner settles findings one decision at a time, each its own invocation carrying the decision in its arguments or on stdin, made as the owner makes it, so a settling session that dies midway loses nothing already decided (owner, 2026-10-26).
Promotion is always the owner's act, since the agent may be unable to reach the tracker: a model rewrites the finding as public-safe text at promotion time, the tool checks it for card ids as it checks a close note and prints it for the owner, the owner posts it, and the tool records the card as promoted with the key the owner gives back.
Findings are filed in the card's private register and rewritten only when promoted, because filing should stay cheap and most findings never go public.
A finding the owner chooses to work now joins this plan when it falls within the plan's intent, and starts a new plan when it falls outside it (owner, 2026-10-26).
The test is the plan's intent and not the card's contract because a finding is by definition outside its card yet may still belong to the plan, while work outside the plan would ride on its branch and into its merge request.
A joining finding takes the final card's path: the owner adds it in an authoring session ahead of the final card, it passes the check before approval, the plan document is updated if the finding changes what the plan is, and the final card runs again; the plan is not done until it does, which is the fact about its cards and not a regression.
Where the owner has no tracker for the plan, working or declining are the choices, and declining a finding the owner has read loses nothing the filing was for: "It also makes me aware" (owner, 2026-10-26).

**The close note.**
The reviewer writes it on approval: what landed, how it was verified, and how to see it working.
It is public-safe — no card ids, written for colleagues — so the one text serves the hand-back, a closed pile and a public tracker, while the card above it keeps the private detail; the owner is "not worried about the public-safe constraint causing any trouble."
It is also the card's commit message, so it is written to serve as one; the tool appends it, checks it for card ids before committing — a note that fails goes back to the reviewer by the repair prompt under "Delivery", scoped to the close note alone — and prints it for the owner; posting it to a tracker is the owner's act.

### The plan document and the final card

**A document per plan** holds what the plan is: its intent, the design decisions and their reasons, the alternatives rejected and why, and the acceptance criteria.
Every reconciler reads it, and so do the final card's roles; the implementers and reviewers of other cards never see it.
Only the reconciler changes it, within the plan's intent; changing the intent goes to the owner.
Why it is not in the cards alone: a reconciler choosing a new approach after a blocking finding needs the rejected alternatives and their reasons, or it can amend towards an approach authoring rejected while every check still passes.
Which cards make up the plan, and in what order, the tool stores where it likes; reconcilers do not see it, since the tool builds every prompt.

**The final card checks the whole plan.**
Authoring writes it as the last card: how to verify end to end that the plan document's acceptance criteria hold on the finished branch, citing the document for the criteria.
It runs through the same roles as any card, and a gap it finds is a blocking finding: the implementer raises it as one, and a reviewer that finds a gap the implementer missed requests a revision, which brings it to the same place.
The reconciler cannot close that gap, since amending a verification card into implementation exceeds its intent, and new cards change the plan the owner approved; so the reconciler bounces it to the owner, the run stops, and the hand-back names it.
The owner answers in an authoring session that adds cards ahead of the final card, which pass the check before approval like any others, and a bare `card` then carries the plan on, running the final card again (owner, 2026-10-26).
Rejected: the reconciler drafting fix cards behind the mark, which gives a reconciler authoring's work without the check, and an unattended authoring stage, which drops the interactive check and can loop with no one deciding.
Chosen over a final step the tool always runs as "a much more powerful approach", since authoring writes a check fitted to the plan.

**The final card's close note is the owner's guide to the finished plan**: how to see it working, and anything its agents could not check, listed for the owner to try.
It takes the place of Tasktron's manual test plan, whose point the owner put as "write the plan at the beginning to preserve the original intent; hand it off after I've forgotten the details": the final card is written before the build, from the acceptance criteria.
It also takes the place of the hand-back step today's payload asks of a session, "Say what changed and how to see it".

### Authoring

**Staged**, which the owner wants to try because the ad hoc approach "has worked okay, but that doesn't mean it's optimal": write the plan document (what the plan is); write the cards (how, ending with the final card); a check before approval; the owner's approval, on which the session runs the verb that starts execution.
Authoring also settles the plan's branch: its name, following the host repository's convention (at work, `feature/abc-123-...` for a Jira ticket ABC-123), and the point it starts from, such as `develop`; the tool records both for execution.
A bare `card` carries an approved plan on from wherever it stands, such as after the owner answers a stopped run.

**A fresh session per stage**, the plan document being the handoff, so every stage boundary is a free cold read of it.
The owner does not work at a terminal by choice: authoring is always "Please run `card`", and the tool prints the prompt for whatever stage is next.

**Recorded transitions.**
When the owner agrees a stage is done, the session runs a verb that records it, and the tool reads the record; inferring the stage from the document's content was rejected, because a half-written document looks the same as an agreed one.
Stages can loop back until approval, and approval is only ever the owner's explicit word.

**The check before approval is interactive**: a fresh session checks the plan document and the cards, presents its findings, and edits what the owner decides — the owner at the start, uninvolved through the middle.

**A bare `card` does the next thing**: start authoring, print the next stage, execute an approved plan, say what a stopped run is waiting on, or say the plan is done.
With more than one plan in progress it asks which; the common case of one should need no naming.

### Delivery

**The bootstrap goes.**
No global instruction runs `card status` in every session, which the owner calls "a hack" kept to carry a sandbox check that belongs in the harness.
A skill takes its place, installed in the owner's personal skills and never in a repository card works in.
Bare `card` acts, so it runs only when asked, and a skill's text is read only when the skill is invoked, so beyond the skill's one-line description no workflow text reaches a session unasked.
That retires at its source the failure of 2026-08-26 the first brief records under "What the deliverable is": a status printout that spoke imperatively about the present session, read by a fresh session on a corporate machine that then implemented a ticket handed to it in discussion phrasing.
The constraint that shaped the first brief holds: nothing of the workflow is committed to any repository card works in, and the skill lives outside every such repository.

**Installing is two one-liners** (owner, 2026-10-26): a global package install for the tool and `npx skills add` for the skill, with Node or Bun assumed present, including in a fresh cloud container.
Both install from the public repository and nothing is published: `bun install -g github:ark3/card` for the tool and `npx skills add ark3/card` for the skill, so there is no registry account, no name to find, and no release step; an install takes the tip of main, a tag pins a version, and `"private": true` in `package.json` blocks only publishing.
The skill's source lives in card's own repository; "never in a repository" bars the skill from the repositories card works in, not from the one it ships from.
The runtime is Bun, for now: the tool calls Bun's own APIs and its `bin` is a `.ts` file, so its one-liner is `bun install -g`, and only the skill's `npx` works under Node alone; the Claude Code cloud container carries Bun 1.4.4.
Rejected for now: porting to Node, a real card touching the suite as well; a compiled executable per platform, which no package-manager one-liner installs; and publishing to npm under a scoped name, which adds an account and a publish step per release for a shorter command.

**The tool creates the deck when it starts a plan**, under a fixed default prefix, asking nothing (2026-10-26), and `card new` creates it the same way when a thought is put down where no deck exists yet.
Bare `card` and `card new` are the only entries, and every other operation happens inside a plan the tool started, so no state of the workflow has no deck, and "no deck here" answers an asked invocation with a refusal.
The prefix stops being a decision because the owner no longer thinks about cards one at a time and recognizes them by headline; `card init <prefix>` stays for anyone who wants to choose one before the first plan.

**The tool builds each role's prompt in code**, so every prompt has one reader, and the two hops of today — the payload telling a session what a dispatch prompt carries, then the session writing it — become one.
The role and stage prompts themselves are implementation work, written in the implementation cards and not here (2026-10-26); this brief carries what governs them: the principles below, each role's outcomes above as the skeleton of its answer schema, and the obligation to keep card's plan apart from Claude Code's plan mode; the cards that write them draw on this brief, the payload as it stands today, and `reference/tasktron.clj`.
The principles are Tasktron's prompting lessons, read from `reference/tasktron.clj` on 2026-10-07:

- **Code steers, so no prompt does.**
  No Tasktron agent decides what comes next, whether to stop, whether to ask the owner, who commits, or whether it may act; code decides all of it.
  The payload passages that have been hardest to get right across models — the mode fork, authorization, when to stop, who commits, guidance read by a dispatched agent it was not addressed to — are all a model steering the workflow from prose, which is the price of judgment living in prose; prompts that never ask a model to steer never have to survive the difference between how two models read them.
- **One reader per prompt.**
  Each prompt is built for one role and one step, and no agent sees another role's text, so "you" is always the right reader and the register rule "a sentence that grants what another role is denied names the granted role, never 'you'" never arises.
- **Two hops became one**, as above.
  Hypothesis, unconfirmed by the owner: a misreading at the payload hop arrives at the dispatch hop as a defective prompt, with nothing between to catch it, and that accounts for part of the model-to-model variance in the payload's history.
- **The schema is the instruction.**
  The final-answer text is generated from the same schema the code validates against (`final-answer-instructions`), so the instruction cannot drift from what the code accepts.
- **A malformed answer gets a repair prompt scoped to the report alone** (`prompt-answer-correction` in `reference/tasktron.clj`), sent by resuming the same session, at most twice before the invocation fails.
  It has three parts: a fence around the work — "The work attempt is finished. Do not continue implementing or reviewing. Do not modify any files. Correct only the final report."; the validation error quoted back verbatim after "The previous report was invalid:"; and the answer's schema restated.
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

The relay check reported what the relay asks of the prompts: no question-only resume restarted the work in four runs, so a fence on question resumes is optional insurance, not a requirement; the tool passes `--json-schema` only on the resume it reads, the continue; and a run ending in a schema answer leaves a synthetic "No response requested." reply in the transcript, which the resumed model reads as its own, so a relay prompt should not lean on "your last answer".

**What the tool prints for the owner, the session relays unaltered.**
A session runs every invocation of the tool, never the owner at a terminal — resuming a stopped role session at a terminal is not an invocation of the tool — and the owner sees a command's output only by going to look, so anything the tool means for the owner reaches the owner only in the session's reply (owner, 2026-10-26).
A session left to its own judgment retells, and a retelling is a second copy that drifts from the first: a promotion text that is retold proves nothing the card-id check said about what the owner posts, and a condensed final-card guide can drop the one step that mattered.
So the tool's output has two registers: text for the session, and text for the owner, marked as such, which the prompt beside it directs the session to put in its reply unaltered, not summarized — all of it, not only where exactness matters, because one rule asks a literal reader for no judgment of category, and text the tool marks for the owner is already written for the owner.
This is "code steers" applied to what the owner hears: the tool decides what reaches the owner, not a session's sense of what is worth repeating.
It binds every site where the tool tells the owner something: the stop and what it waits on, the findings and the settling prompt, promotion text, close notes, the final card's guide, and progress.

### The verb surface

The verbs are the operations the interactive sessions — the authoring stages, the check before approval, answering a stopped run, settling findings at the end — need, with today's verbs retired by default wherever a headless role or the tool now does the work.
Settled 2026-10-26 by the walk-through the owner accepted; where the run lives was settled the same day, under "Where the run lives".

The owner asks a session to run `card`, which creates the deck if needed and prints the prompt for the next stage; when the owner agrees a stage is done, the session runs a second invocation, `card done`, which records the transition and takes in what the stage wrote — the plan document and the cards are plain files where the stage's prompt says, and the tool assigns ids and checks their shape there, so authoring needs no verb that files one card, since a plan's card is live for nothing before approval; at approval that invocation starts execution, and the owner invokes nothing through the long middle.
At the end the owner has a session run `card` again, any session; with every card closed done it prints for the owner the final card's guide, the branch and the path of the worktree holding it, and the findings by headline with the role that filed each, and with findings it prints the settling prompt, so settling needs no entry of its own and ends, with no `card done`, at the last decision.
Each decision is its own invocation; promotion takes two, because the card-id check must come before the owner posts: the first carries the session's public-safe draft on stdin, for one finding or several folded into one ticket, and the tool checks it, prints it for the owner, and marks them awaiting a key, which `card` keeps listing; the second records the owner's key and closes them promoted.
The test that decides each invocation: one is justified only where an interactive session needs code to run at a moment the session chooses, and its content rides on arguments or stdin, never on a file left waiting.

The spelling, settled 2026-10-26:

- `card` — the next thing, or where things stand.
- `card done` — a stage the owner agreed is done; at approval it starts the run.
- `card stop` — stop a run now ("What stays open").
- `card join <finding>`, `card later <finding>` for a new plan, `card decline <finding>` with the reason on stdin, `card promote <finding>...` with the draft on stdin, and `card promote <finding>... --key <KEY>` to record the key — settling findings.
  `later` rather than `new`, which would read as today's `card new`, a different act.
- `card ask`, with the owner's question on stdin, which resumes the stopped session headless and prints its answer for the owner; and `card resume`, with the owner's answer on stdin, or with nothing where the owner already answered the session at a terminal — a stopped run.
- `card new '<headline>'`, body on stdin — a thought put down outside a stage and outside a run, filed as a card marked not yet accepted ("Putting a thought down" below).
- `card init <prefix>` — kept from today, for choosing a prefix before the first plan.

The session never chooses among these: `card` prints, for the current state, the exact commands open in it, so the session copies a command rather than recalling a vocabulary (owner, 2026-10-26).
Separate words were chosen over folding the acts into `card done` with arguments: the owner's choice has to be carried either way, so folding saves nothing there, while a session holding a stale picture of the state — the run finished, or another session approved — gets a loud refusal from a word used in the wrong state, where a folded `done` would quietly do what the current state means by it, approval included, which "Recorded transitions" keeps to the owner's explicit word.

**Putting a thought down.**
The brief first landed with no verb that files one card, and the owner added one on 2026-10-26: "put a pin in that" is the gesture the design began with, and the purpose sentence promises "a place to put things down", which a surface whose only entries are an authoring stage and a run's findings keeps only for authoring and for roles, so a thought in any other interactive session could be kept only by opening a plan for it.
`card new` is today's verb kept, with one change: the card it files is marked not yet accepted, like a role's finding, so no run picks it up until the owner settles it.
It passes the test above: an interactive session needs code to run at the moment the thought comes, and the headline and body ride on an argument and stdin.
It comes back the way a finding does: `card` prints the marked cards with the settling prompt whenever any exist and no run is live, so a thought put down with no plan in progress returns at the next bare `card`, where `later`, `decline` and `promote` apply and `join` needs a plan to join.

**Retired.**
Of today's thirteen verbs — `status`, `init`, `new`, `show`, `list`, `close`, `cmd`, `lint-commit`, `worktree`, `author`, `execute`, `run`, `workflow` — `init` and `new` survive, `new` narrowed as "Putting a thought down" says.
A verb is how something outside the tool's control loop acts on the deck, and the headless roles act only through their answers: the tool itself puts the card in the prompt (`show`), files a run's findings (what `new` did for a session, which it now does only for the owner's own thoughts), appends the account and the close note and closes the card (`close`), holds the plan's worktree (`worktree`), commits, and checks text for card ids (`lint-commit`).
`status`, `workflow`, `execute` and `run` served a session steering the workflow, which a bare `card` that does the next thing, the end of the bootstrap, and prompts built in code retire together; `author` has nothing of its own once a bare `card` starts authoring and prints the next stage.
`list` answered a session asking what is ready, which no session asks: the tool reads the deck's state, and `card` says where things stand.
`cmd`, the escape hatch to the raw files, goes by the owner's choice of 2026-10-26, made after the brief first landed with it absent from the spelling and no reason given.
Its only work was resolving the deck's path for a session that did not know it, and the cards stage prompt, built in code, prints that path already resolved — the absolute path under the git common directory, since a linked worktree's `.git` is a file — so no code needs to run at a moment the session chooses, which is the test above failing, and the session reads the deck with its ordinary tools, where a wrapper with a `--` separator is a place literal readers stumble.
The deck's location was never the secret, and a printed prompt is not committed, so the disclosure costs nothing; what the prefix still bought, a transcript that announces deck access and a nudge that the session is touching the tracker, the one-reader prompt gives in words.
The prompt prints the path only where a sweep is wanted, the cards stage, which keeps a closed pile a bonus in the prompt as in this brief.

### What stays open

**Stepping in mid-run.**
The floor is settled (2026-10-26), and the rest is to be learned from experience.
While a plan runs, `card` reports the active card and role and how many cards have closed, which rests on the liveness record under "Where the run lives".
`card stop` stops now: the tool ends the active role session, discards the in-flight card's uncommitted work as it does after a blocking finding, and leaves that card open, so resuming reruns it from its reconciler; "stop after this card" was set aside because one card can take long, and a stop the owner cannot count on to come promptly is little use.
Changing the plan mid-run needs nothing more: stop, amend it in authoring by the final card's path, and approve to resume.
Pausing, or steering a role partway through a card, waits until a real run shows the owner wants it.

**An unattended run in a cloud container.**
The VM stops within minutes of an idle session ("Where the run lives"), so a run meant to proceed unattended for hours there needs either a session that stays busy in a turn for the duration, which is untested, or a host other than the container.

**The two-hops hypothesis** under "Delivery" is unconfirmed by the owner.

## What the first brief settles that still holds, and what changes

The redesign leaves the card file, the runtime and deck resolution alone, and this brief cites `reference/brief-2026-08-20.md` for them rather than restating them.

- **The card file's format**: "What this project changes about the format" there — three frontmatter fields, `blocked-by:` and `labels:` written by the author and `closed:` written by the tool, one `# ` headline, prose; no card rewritten because another changed, and every relation computed at read time.
  With it "Requirements carried over from agentpane": the format stays the API, and ids are drawn at random (`src/id.ts`); and "How a card ends": the four close outcomes and the close note under its own heading.
- **The runtime**: "Settled during the build" there — no runtime dependencies, everything in Bun, `bun run check` as `bun test` then `tsc --noEmit`, TypeScript pinned to an exact version.
- **Where the deck lives**: "Settled during the build" there — the card directory under the git common directory, `card-config.toml` beside the deck, every worktree resolving to one deck and every clone to its own, the prefix recorded and never derived from the filenames present.
- **The one-directional reference rule**: "The context that shapes the design" there — items cite the public tier's keys freely, and nothing public ever cites a card id.
  It is the entire privacy boundary and it is checkable, and under the redesign the tool checks it itself, on every close note and on every promotion text.

What changes about them:

- **Nothing is optimized for a deck in the tree, and the workflow works with no closed pile.**
  The first brief's "Authoring must sweep the closed corpus for prior art" cannot be load-bearing: where a closed pile exists an authoring session may read it, at the path the cards stage prompt prints ("Retired", on `cmd`), and where none does nothing is missing.
  Of the refusals of `new` and `close` from a linked worktree, which "Settled during the build" records, `close`'s goes with the verb and `new`'s stays with it.
- **The install story.**
  "clone-and-run" becomes two one-liners, and the runtime stays Bun for now ("Delivery").
- **The tool creates the deck**, under a fixed default prefix, when it starts a plan or when `card new` finds none; `card init <prefix>` is kept for choosing one first, and "No hardcoded prefix" there narrows to the prefix being recorded in the deck and never inferred from it.

## Costs accepted with eyes open

Restated for the redesign; the first brief's list is not carried.

- **The deck has one copy, and it may not outlive its container.**
  It sits under `<git-common-dir>/card/`, which nothing syncs and no clone carries, and in a cloud container it dies with the container.
  Accepted because nothing depends on it lasting: what must outlive a plan goes into documentation or code as the plan's own work, each card's commit carries its close note, and the backlog lives in the owner's ticket layer.
- **An implementer will sometimes knowingly build a card it thinks flawed**, and the flaw becomes a card instead of a fix.
  That is the price of an implementer whose frame of mind is implementation.
- **The plan's branch is not in the main checkout during a run.**
  The tool holds it in the plan's worktree so that git refuses a second checkout; the owner tries the finished plan there, at the path the hand-back prints.
- **Cards go stale against code the owner does not control** while a plan is in flight.
  The reconciler is the answer: a check against the tip before every card, load-bearing rather than hygiene.
- **One-tree atomicity is gone.**
  Retiring every copy of an overturned fact is a sweep over the tree and a second over the deck, and nothing reminds you of the second.
- **The tool names the harness in code.**
  It launches `claude -p`, sets `--session-id`, and resumes by it; a harness joins only if it accepts a session id the caller chooses, which the collision under "Stopping" makes a requirement rather than a convenience.
  Codex was weighed on 2026-10-02 and left out on that test: `codex exec` lists no `--session-id`.

## Where the implementation stands

The tool as it stands on 2026-10-26 is the first brief's: the thirteen verbs named under "Retired", and a payload of three chapters that a dispatching session reads and follows.
This brief records the design that replaces it; the payload derives from this brief, and the implementation cards follow.
