# Payload rule inventory

Working artifact of the rewrite planned in `plan.md`, built 2026-08-22 against
the payload as of commit "Stop the payload exempting its reader from the
base-branch bar". It cites cards freely because the mapping to the deck is the
completeness check; the owner accepted committing those ids for this repo
(decision 8 below).

Addresses follow the convention card-pavuge proposes: a rule is located by
file, section or step, and a quoted phrase — never by line number.

Each entry: **id — who it binds.** The rule, subject first. Then where it is
stated today, and the cards that put it there or sharpened it. "BRIEF" names a
restating section of BRIEF.md.

## 1. Rules that hold in any mode (status.md)

**S1 — any session.** Cite a card by id; never restate its content in
conversation ("a retelling ... drifts"). — status.md "Rules, in any mode".

**S2 — any session.** File anything left undone as a card rather than doing
it; scope noticed mid-work is filed, not fixed, and that is the wanted
outcome. — status.md "Rules, in any mode". BRIEF "What is being carried".

**S3 — any session.** Put any finding that must survive into a card — a new
one or a close note; a finding only in a transcript dies with the session. —
status.md "Rules, in any mode".

**S4 — any session, and everything public.** Cards cite public keys freely;
nothing public ever cites a card id — not a commit message, a pull request, or
a code comment. — status.md "Rules, in any mode"; forwarded at dispatch by
execute.md step 2. Cards: card-luyuji. BRIEF "The context that shapes the
design" ("This rule is the entire privacy boundary, and it is checkable").
→ Briefing file; also the hook candidate (plan step 5).

**S5 — any session.** Dispatch subagents for reading; do not explore in the
session that is landing a card. Writing is the session's own only where
execute.md hands it over (step 4's "commit it here" path). — status.md "The
session stays thin", which still says *writing* happens in subagents; that
half is stale. Cards: card-nufeku (open, resolves here), card-dofudi.

**S6 — any session.** Resolve the mode from what has already been asked —
authoring means run `card author`, landing means run `card execute`, anything
else means neither — and never put the choice to the owner. Run the mode's
procedure before acting. — status.md "Mode". BRIEF "What the deliverable is"
(the autonomy passage grew from this instinct; card-sayosu).

**S7 — any session.** Create a card only through `card new`, as one act: never
choose an id, never write a card file by hand, never create a skeleton to fill
in afterwards. — status.md verbs. BRIEF "Verbs" (`new`, the OW-70/OW-71
incident). Held under pressure in the rehearsal (card-damive).

**S8 — any session.** Reach a card through `card show <id>`; never build a
path from an id (a card changes directory when it closes). — status.md verbs.
BRIEF "Verbs" (`show`, the Codex incident).

**S9 — the closing session.** Write the close note for the next authoring
session sweeping closed/ for prior art: whether the work landed first, then
what was built and how verified, or what was decided against and why, or where
the work went; name a public ticket key over a sha. — status.md verbs
(`close`). BRIEF "How a card ends". Cards: card-zobaki (open) replaces the
"say whether the work landed" clause if its four flags land.

**S10 — owner.** The cards a not-done close strands are the owner's to
dispose of, not the session's. — status.md verbs (`close`); execute.md step 4.
BRIEF "How a card ends" (the four dispositions). Cards: card-vudake (open)
wants the four dispositions carried in the payload.

## 2. The executing session — the set

**X1 — executing session.** Work the set the owner handed you, in order; never
pick the next card yourself. Working through a set the owner picked is not
moving on your own. — execute.md opening. Cards: card-tirera. BRIEF "What the
deliverable is".

**X2 — executing session.** Given no id, run `card list --ready` and summarize
grouped for choosing (what each card is, what it costs, what it unblocks),
opening only the handful needed; then wait for the owner's pick, which may be
one id or several. — execute.md "Picking the set". Cards: card-tirera.

**X3 — executing session.** Gate continuing on the card's done-condition, not
the card: a runnable observable closing clean means go straight on; a
done-condition that is a judgment or decision means the owner is the only
instrument — hand back and stop, whatever else is in the set. — execute.md
"Between cards". Cards: card-tirera, card-sayosu; card-yozimu (open) — the
phrase "cold read" here collides with the dispatched reader's cold read and
one of the two names must change. BRIEF "What the deliverable is".

**X4 — executing session.** End the set early only on a genuine blocker: an
observable that will not go green, drift that kills a card's intent, work that
belongs to a ticket of its own, something that changes a later card, or your
own context running short. An over-cautious abort is the expensive failure. —
execute.md "Between cards". Cards: card-tirera; card-maheve (open) — "a card
that turns out stale" must not be on this list, since amendable staleness is
routine and has never once ended a set; BRIEF "What the deliverable is" moves
first.

**X5 — executing session.** Hand back per card as it closes — what changed,
what to run, what counts as working — and stop after the last card or at the
first you cannot close. — execute.md step 5. Cards: card-tirera.

**X6 — executing session.** After the set, the owner tries the work: working
means wait for the next pick; wrong means a new card or an amended one
re-dispatched; something else surfacing means a new card, not this session's
job. — execute.md "Between cards" tail.

## 3. The executing session — working one card

**W1 — executing session.** Check the card against the source before working
it (paths, symbols, claims): where they have drifted, amend the card yourself
and say what you changed — never work it as written, never stop for an
amendment you can make. Drift large enough to kill the card's intent is not an
amendment; it goes to a ticket of its own. — execute.md step 1. Cards:
card-jinuna (subject restored), card-dofudi.

**W2 — executing session.** Dispatch the reading; the card is the handoff, and
a session that does the reading has no room left to review what comes back. —
execute.md step 2 head; status.md "The session stays thin". Cards:
card-dofudi (the ban is on unnamed reading, not on steps 1 and 3).

**W3 — executing session.** Dispatch in one of two shapes — an implementer
(writes in a tree of its own, commits there) or a reader (reads and reports,
writes nothing) — one implementer per card at most, as many readers as the
work is worth, and never two dispatches at once: dispatch, review, then decide
the next. — execute.md "Working one". Cards: card-juwabu. Unstated rationale
recorded in card-juwabu's close and worth stating in the rewrite: every
dispatch is reviewed before the next is decided.

**W4 — executing session.** Hand the dispatched agent everything it needs,
because it starts cold and anything not handed over is lost: the project's own
instructions, the card's grounding and intent inline, the one card and nothing
else in the deck, the one-directional rule in its own words, and every
constraint you hold only from conversation (a repo not to touch, a freeze,
fixtures holding customer data). — execute.md step 2. Cards: card-luyuji.
→ Briefing file carries the fixed parts verbatim; conversation-held
constraints remain the dispatcher's to add.

**W5 — executing session.** Review what comes back yourself; the judgment is
never a subagent's, though dispatching a reader is not delegating it. Neither
a report nor a green test is the finding: check claims against the change and
the code it ran — confirming a claim is review however far the check reaches,
and an unconfirmable claim is itself a finding. Look for work beyond the card,
drift from a named spec, and tests never shown to fail. — execute.md step 3.
Cards: card-dofudi, card-homute.

**W6 — executing session.** Where you wrote the change yourself off a reader's
report, dispatch a reader at what you wrote — your own reading of your own
writing is the weakest review there is — and review its report the same way. —
execute.md step 3. Cards: card-homute.

**W7 — executing session.** Land the work where the card said it comes to
rest: a file in this repo means committed on the branch the main checkout is
on; a finding and nothing else means the close note carries it in full, never
a transcript pointer. — execute.md step 4. Cards: card-kojija.

**W8 — executing session.** Bring an implementer's commits back by your own
hand — which commits land is a judgment, not a merge — then remove the
worktree and delete its branch. What you wrote yourself, you commit in the
main checkout; nothing else in the procedure will. The session doing this is
the dispatching session — step 4 must name its actor, not rely on a sentence
twenty lines up. — execute.md step 4. Cards: card-kojija, card-gemipu,
card-yejotu; card-bonisi (open, resolves here).

**W9 — executing session.** Discharge the card's conditionals before the
close, whichever way the card's question came out: what a conditional calls
for comes to rest first (the card filed, the document committed). An answer
that fits neither branch is a new card, never a skip. Only then close, with
both flags in one sentence. — execute.md step 4. Cards: card-lopesa.

**W10 — executing session.** Say nothing about what the repository does with
the branch afterwards — no review policy, no merge, no PR; that is the
corporate repo's own documentation. — a *content* rule about the payload
itself, enforced by deletion in card-kojija. BRIEF "What the deliverable is"
("The payload carries only what cannot be written down in the corporate
repo"). → AGENTS.md content test, not payload prose.

**W11 — executing session.** Never do the card's work in your own context:
the card's code is an implementer's to write; edit only what review put in
front of you, to fix what review found. Writing up what a reader reported, and
amending a card, are not implementing. — execute.md "Never". Cards:
card-denoki (rule now states what it protects), card-jinuna (amendment seam
checked benign).

**W12 — executing session.** Never go looking for work the card did not name;
reading past what the card named is dispatched, not done here. Steps 1 and 3
are review and are yours. — execute.md "Never". Cards: card-dofudi.

## 4. Rules that bind the dispatched agent (→ briefing)

Today these travel only as paraphrase inside the dispatcher's prompt, per
execute.md step 2. The briefing file states them to the agent directly, which
also settles the addressee inversion card-yejotu fixed pointwise and
card-bonisi still tracks: a briefing says who its reader is in its first line.

**D1 — implementer.** You commit on the worktree's branch and never on the
base branch. — execute.md step 2. Cards: card-gemipu, card-yejotu.

**D2 — reader.** You read only, write nothing, commit nothing; your report is
your whole output. — execute.md step 2.

**D3 — both.** Work the one card you were given; do not go shopping in the
deck. — execute.md step 2.

**D4 — both.** Nothing public ever cites a card id: not a commit message, not
a pull request, not a comment in the code — the id in your path and branch
name stays out of everything you write, and "Fixes <id>" most of all; a
report quotes ids only because the report itself is private. — S4 forwarded.
Cards: card-luyuji.

## 5. The authoring session

**A1 — authoring session.** Produce cards a cold agent can act on; do not
change code. — author.md head.

**A2 — authoring session.** Sweep the closed pile before writing anything
(`card exec -- rg`), read what comes back with `card show`, and cite it as
grounding rather than copying it. — author.md first section. BRIEF "The
context that shapes the design" (load-bearing rule two).

**A3 — authoring session.** Discuss each observation to agreement before
writing its card; do not treat your own answers as agreement. — author.md
"Agree, then write". Cards: card-wizahi (open) argues the gate contradicts
BRIEF's autonomy passage and should become write-and-flag; card-fonupi's close
notes the gate lost its only in-file exception. Owner decision.

**A4 — authoring session.** A card that exists only in the conversation does
not exist. — author.md "Agree, then write". Survives card-wizahi unopposed.

**A5 — authoring session.** Decompose larger work (a ticket, or a planning
document standing in for one) into cards each carrying the ticket's key as a
label. — author.md. BRIEF "The context that shapes the design" (fan-in).

**A6 — authoring session.** Ground every card in addresses: file paths,
symbol names, the command that shows it working as this project runs it,
pointers to spec sections and closed cards; prefer a pointer over restating
what a file can re-derive. — author.md "What a card carries"; restated in the
filer's own vocabulary in execute.md "Filing one" (card-fonupi, two
statements deliberately, not two copies). Cards: card-pavuge (open) sharpens
what an address for prose is — a quoted sentence plus its section, with line
numbers decorative at most.

**A7 — authoring session.** State intent: what the card is in service of, and
which specifics are load-bearing rather than incidental. — author.md; also
execute.md "Filing one".

**A8 — authoring session.** State done as an observable, never a description
of the finished state. — author.md; execute.md "Filing one". Cards:
card-bomani (open): the only examples are code-shaped (test, screenshot);
the rewrite gives examples far enough apart to generalize — a red-first test,
a decision recorded where the next person will look, a finding that outlives
the session.

**A9 — authoring session.** Phrase every conditional over the decision it
gates, never over the answer expected — "whatever the answer, record what it
means for `<id>`". — author.md; execute.md "Filing one". Held under pressure
(card-damive rehearsal).

**A10 — authoring session.** Give the headline as the card's lead claim,
specific enough to stand alone in a listing; no template, no required
sections, nothing padded. — author.md "Writing it".

**A11 — authoring session.** `--blocked-by` names only what this card waits
on; the reverse question is a grep and is never stored. Labels are opaque
strings for the ticket key and anything worth filtering on. — author.md.
BRIEF "What this project changes about the format".

**A12 — authoring session.** Sharpen a card by editing its file (`card show
<id> --path`). The *tool* never rewrites a card because another card changed —
an author acting on a conditional is doing exactly what the workflow asks. —
author.md tail, currently missing its subject. Cards: card-karale (open,
resolves here). BRIEF "What this project changes about the format".

**A13 — authoring session, and the filer.** The test for a finished card: the
next agent's first tool calls are reads of things the card named; opening with
a codebase-wide grep means it was underspecified. — author.md tail; execute.md
"Filing one".

## 6. Filing mid-work (executing session)

**F1 — executing session.** Wherever the procedure sends you to a new card,
write it where you stand with the full authoring bar (A6–A9, A13) — you hold
the context and the picker starts cold — and carry on; filing is not a
discussion, and stopping to agree it is authoring's gate, not this mode's. —
execute.md "Filing one". Cards: card-fonupi.

**F2 — executing session.** Close with the evidence on stdin: `--work-done`
where the work is at rest, `--work-not-done` where it turned out to belong to
a ticket of its own; the stranded dependents are the owner's (S10). —
execute.md step 4. Cards: card-lopesa (order), card-zobaki (open, renames the
flags).

## 7. Verb entries are descriptions and must match the tool

Not conduct rules: status.md's verb list describes behavior, and each entry is
checked against the verb's actual output rather than judged. One known
mismatch: the `worktree` entry omits the base branch the verb prints
(card-tanali, open, resolves in the status.md rewrite).

## 8. Completeness check — closed cards

- card-damive — rehearsal; no rule of its own. Validated S7, A9, W5 under
  pressure; its findings are the provenance of most open cards.
- card-denoki — W11.
- card-dofudi — W5, W12, S5.
- card-fonupi — F1, A6–A9 duplication decision (superseded in part: the
  inventory now records the duplication the payload deliberately does not).
- card-gemipu — W8, D1, and step 2's location sentence (W4 context).
- card-homute — W5, W6.
- card-jinuna — W1.
- card-juwabu — W3.
- card-kojija — W7, W8, W10.
- card-lopesa — W9, F2.
- card-luyuji — W4, D4.
- card-sayosu — X3, S6, and BRIEF's autonomy passage (spec, not payload).
- card-tirera — X1, X2, X4, X5.
- card-yejotu — D1/D2 addressee fix; carried forward by the briefing and W8's
  actor naming.

Nothing in the closed pile maps to no entry; no rule is deliberately dropped.

## 9. Open cards — disposition under the rewrite

Resolved by the rewrite (each adopting the card's own "what done looks like"):
- card-bonisi → W8 (step 4 names its actor).
- card-nufeku → S5.
- card-karale → A12.
- card-yozimu → X3 (naming decision below).
- card-tanali → section 7.
- card-bomani → A8.
- card-pavuge → A6 (convention only; its mechanical-check question stays a
  decision to record, recommended declined for now per the card itself).
- card-maheve → X4, BRIEF first (decision below).
- card-wizahi → A3 (decision below).

Untouched by the rewrite (tool work, stay open): card-bunuru, card-hanifu,
card-pudaru, card-rawutu, card-sehiza, card-yowotu.

Interacting (sequencing decision below): card-zobaki (tool flags + S9/F2
wording), card-vudake (S10 doctrine into status.md, blocked by zobaki).

Legitimately declinable per its own text: card-yufisi.

## 10. Decisions, as the owner took them (2026-08-22)

1. **Staleness and the set (card-maheve).** Adopted: amendable staleness never
   ends a set; only drift that kills a card's intent does, as ticket-of-its-
   own. The matching BRIEF.md sentence changes first.
2. **The two cold reads (card-yozimu).** Adopted; naming delegated to the
   session. Chosen: "cold read" names only the dispatched reader's pre-start
   read; the post-write check is "the adversarial check"; and the set-stopper
   in X3 is named for what it is — a judgment or decision only the owner can
   make — with "cold read" removed from that list. Practice supports the
   split: closed cards routinely dispatched their cold-read checks and went
   on; what stopped sessions was owner-held judgment (card-sayosu).
3. **The agreement gate (card-wizahi).** Adopted: discuss-to-agreement becomes
   write-and-flag, per the card's own text; A4 survives unopposed.
4. **Sequencing against card-zobaki/card-vudake.** Adopted: zobaki's four
   flags land before or with the rewrite, and vudake's four dispositions fold
   into the rewritten status.md, so the close paragraph is written once.
5. **Briefing delivery.** Open — the owner asked for clarification; the
   mechanism question (worktree prints a paste-verbatim block, versus the
   block living inline in execute.md) is being resolved in conversation.
6. **Enforcing the id rule.** Decided: no hook — the owner declines hooks
   generally, and git shares `.git/hooks` across worktrees so a per-worktree
   hook needs worktree-scoped config, while a repo-wide one touches machinery
   a corporate repo may own. Instead a verb, `card lint-commit`, checks a
   message for card ids; filed as its own card.
7. **card-yufisi.** Open — the owner asked for its context again before
   deciding; recommendation stands to decline per the card's own reasoning.
8. **Id citations in committed artifacts.** Decided: commit the inventory
   as-is. No harm for this repo, and a future export-and-capture process may
   make the cited cards available to readers of the history.
