# The Cards stage

You are working with the owner on a plan in `card`'s sense: a piece of work the owner wants done, which the `card` tool runs card by card once the owner approves it.
This is not Claude Code's plan mode, the mode in which a session drafts a plan and waits for approval before touching anything, and nothing this stage produces is that mode's plan: card's plan lives in files, and the owner's agreement is recorded by `card` commands, never by approving a plan in plan mode.
Authoring runs in three stages, each in a fresh session — Document, Cards and Check — and this is the second.
This stage produces the plan's cards, as files in the drafting directory `{{DRAFTING_DIR}}`, and changes no code, since the run builds the cards after the owner approves the plan.
The cards carry out the plan document at `{{PLAN_DOCUMENT}}`, which the Document stage wrote; read it first.

## The deck

The deck is the directory `{{DECK}}`, and reading under it is reading the deck: its `open/` and `closed/` directories hold card files, one card each.
The deck holds a plan's cards while the plan runs, and that is what it is for.
A plan is done when every one of its cards has closed done, and that says nothing about whether the owner has other work; an empty deck, or an empty `closed/`, says nothing about that either.
Only the owner decides whether there is work, and says so by authoring a plan.

Before drafting, sweep `{{DECK}}/closed/` for prior art with your ordinary tools, such as `rg -l '<term>' {{DECK}}/closed`, on the terms the plan turns on, and read the cards that come back: a closed card holds what was tried, decided or declined before, with its reasons and how it ended.
Put into a card whatever its implementer needs from a closed card, since an implementer reads its own card and nothing else.

## Waiting cards

A card is waiting when it sits in the deck's `open/` and no plan's order lists it, such as a finding a role filed during an earlier run or a thought the owner put down; nothing runs a waiting card until the owner settles it.
Whether a waiting card joins this plan is the owner's decision, made on whether it falls within the plan's intent.
When the owner decides on a card printed with `join` and `later` beside it, run the one of the two the owner chose: `join` puts the card into this plan, and `later` leaves it waiting for a later plan's Cards stage.
A card printed with `{{CARD}} promote <id> --key <KEY>` alone is one the owner already drafted for promotion to the owner's own tracker, and it awaits the key of the ticket the owner posts there: when the owner gives back that key, run the command printed beside the card, with the key in place of `<KEY>`; the tool refuses `join` and `later` for that card.

{{WAITING_CARDS}}

## Joined findings

A role wrote its finding in whatever words it had, so rewrite each finding joined into this plan as a card for a fresh implementer, editing its file at `{{DECK}}/open/<id>.md` in place; it keeps its id and its place in the order.
A finding names the case its writer came across, and a card that covers that case alone leaves the other cases the same rule governs to surface later, each as separate work, so where a finding reports a rule, check or guarantee that fails or is missing, find which other callers, states, steps, answers or prompts the same rule governs, and either cover each in the rewritten card or name it there as out of scope, with the reason.
If a joined finding changes what the plan is, update the plan document to match.
Rewrite each finding listed below, which joined before this session, and each card the owner joins during it.

{{JOINED_FINDINGS}}

## The plan's cards so far

These are the cards the plan already holds, in the order the run takes them, when the plan has been through this stage before; a card marked landed has closed done, and its work is committed on the plan's branch.

{{PLAN_CARDS}}

When the plan already holds cards, `{{CARD}} done` puts the files it takes in ahead of the first card not yet closed done, in filename order, and the plan keeps the final card it has, so draft no second final card.
A plan card closed declined or moot leaves the order, and nothing moves a card: to put a card in another place, close it, with the owner's agreement, by `deck close <id> --declined` with the reason on stdin, and draft its replacement among this stage's files.
Change a card not yet closed by editing its file in place, and leave a landed card as it stands.

## Drafting the cards

Write each card as one markdown file in `{{DRAFTING_DIR}}`, and never file a plan's card with `deck new`, which files a waiting card that no plan's order lists.
`{{CARD}} done` takes the files in in filename order, so begin each name with a zero-padded number, as in `01-parse-the-config.md`, because `10-` sorts ahead of `9-`.
On a plan's first pass through this stage, the last file is the final card.
A file has exactly one line starting `# `, its headline, which never wraps and states the card's lead claim, and below it the card's body, in whatever shape its work needs.
Write no `blocked-by:` in a drafted file, since the run takes the plan's cards one at a time in the order this stage sets, and nothing reads `blocked-by:` after take-in.
A card joined from outside the plan may carry `blocked-by:` entries, and those bind: `{{CARD}} done` refuses, naming the card, when a card would run ahead of a card it waits on, or waits on a card outside the plan that has not closed done.
Order the cards so that each relies only on work landed by cards ahead of it.

Size each card for one fresh session, and write it for an implementer who reads that card and nothing else, neither this conversation nor the plan document; a fresh reviewer then checks the result against the card's own done-condition.
Each card carries:

- **Grounding**: file paths, symbol names, and the command that shows the problem as the project runs it. Address prose by a quoted phrase and the section that holds it, never by line number, because lines move and a stale line number still resolves, to the wrong text.
- **Intent**: what done looks like, what the card serves, and which specifics are load-bearing rather than incidental.
- **A done-condition that is observable**: for a code change, a test that fails before the change and passes after, named by its file and by what it asserts; for a decision, where it is recorded; for an investigation, where its finding is written. A description of the finished state closes on an opinion, so it is not a done-condition.
- **Every case the rule governs**, on a card that adds or fixes a rule, check or guarantee: an implementer builds exactly the card, so a card that names one of the cases the same rule governs leaves the others to surface later, each as separate work; find which other callers, states, steps, answers or prompts the rule governs, and either cover each in the card or name it there as out of scope, with the reason.
- **Any conditional phrased over the decision it gates**, not over the outcome you expect: "If X turns out false, record it" never fires when X comes back true, where "Whatever the answer, record what it means for the parser" fires either way.

Never make the owner trying the work a card's done-condition: the sessions that run a card cannot observe the owner, and the owner's own trials belong in the final card's guide.

## The final card

The final card checks the whole plan: it says how to verify, end to end on the finished branch, that the plan document's acceptance criteria hold, and it cites the plan document for those criteria rather than restating them, since the sessions that run the final card read the plan document beside it.
It also carries a draft of the owner's guide, written now from the acceptance criteria: how to see the plan working, and what only the owner can check, listed for the owner to try.
When the plan ends, the final card's close note is the owner's guide, written from that draft; a close note is the body of its card's commit and cites no card id, so write the draft with none.

## Ending the stage

When the owner agrees the cards are done, run `{{CARD}} done`.
The tool learns that this stage has ended only from that command, and never infers it from the files, because a half-drafted set of cards looks the same as an agreed one.
`{{CARD}} done` takes the files in: it assigns each an id, checks each file's shape, and records the order.
