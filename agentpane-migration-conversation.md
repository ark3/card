# Agentpane migration planning — conversation transcript

Source: session `c4d9bf8d-3aaa-40b8-8506-1939f5cb5298`, 2026-08-25.
Untracked, temporary reference only.

In this transcript, `**You:**` refers to the user and `**Me:**` refers to Claude, the agent.

---

**You:** What are sensible next steps for this repo? Do we have "card init" yet? Or maybe a different question, what would we need to do before we could migrate ../agentpane to this real implementation of cards?

**Me:** Good questions — these are authoring-mode questions (deciding what to build), so let me get that procedure, and dispatch readers at both repos in parallel: one to inventory what `card` itself still lacks against its plan, one to survey what ../agentpane currently uses for tracking. Quick answer on one part: yes, `card init` exists — `src/verbs/init.ts`, tested; the execute-harness tests call `init(["proj"], ...)` to create a deck with a prefix.

*[dispatched readers; swept the closed-card pile for prior art]*

While the two readers finish, the closed-pile sweep already surfaced useful prior art: this repo grew out of agentpane's proto-card system. Closed card card-bomani records that agentpane's tracking (`reference/tracking.md` in this repo's `reference/` dir) had a mandatory `kind:` frontmatter field with five values that `card` deliberately dropped, and card-bunuru's close note mentions "imported agentpane cards" as an anticipated event — so migration has been in the air here before.

The agentpane survey is in — and it's rich: agentpane's `docs/work/` corpus (101 items, two id generations, `kind:`/`where:` frontmatter, git-synced across two machines) is the direct ancestor of this tool, and its item OW-59 literally records the decision to build `card`. The key migration tension is already visible: agentpane relies on the corpus being *committed and pushed* for its two-machine workflow, while card's deck lives under `.git/` — private, unsynced.

Both readers are back:

**Yes, `card init` exists.** `card init <prefix>` — validates the prefix, finds the card directory (`CARD_ROOT` if set, else `<git-common-dir>/card`), creates `deck/open/`, `deck/closed/`, a `.ignore` holding `!*`, and writes `card-config.toml` last and exclusively, refusing to re-run. One deck per repository, shared across worktrees.

The migration-relevant catch: `resolveDeck` honors a `deck = "../../docs/work"` redirect in the config — the exact mechanism PLAN.md names for agentpane — but **`init` can't write one**. It always writes `deck = "deck"` in `.git/card/`. So adopting a repo with an in-tree deck is currently hand-work.

**What migration actually needs — the sync problem isn't one.** Agentpane's two-machine workflow depends on the corpus being committed and pushed; card's `.git/`-resident deck would break that, but the planned redirect keeps `docs/work/` exactly where it is, in-tree and git-synced. Each clone just needs its own one-time `.git/card/card-config.toml`.

What's genuinely in the way, in order of weight:

1. **Frontmatter schema — the real blocker.** All 101 agentpane items carry `kind:` and `where:`; card's parser hard-rejects unknown frontmatter fields. Every agentpane file fails to parse today. Owner decision: convert the corpus or teach card to tolerate extra fields — and card-bomani already rules out porting the five-kind taxonomy into card itself.
2. **The id-citation policy — a philosophical collision.** Card's privacy boundary is "nothing public ever cites a card id," enforced by `lint-commit`. Agentpane's convention is the opposite: 129 of 227 commit subjects name an `OW-` id, 235 `OW-` mentions in source/tests, deliberately — that corpus is public-tier. Card would need a per-deck "this deck is public" notion, or agentpane changes convention. Only you can pick.
3. **Small tool gaps.** Teach `init` (or document by hand) the redirect setup; mixed numeric `OW-1`…`OW-81` and drawn `OW-bigotu` ids resolve fine as filenames, but `lint-commit`/`idPattern` only recognize the drawn shape — fine, new ids just come from `card new`.
4. **Prose cutover in agentpane.** Nothing executable touches `docs/work/`, but ~66 prose references need rewriting: AGENTS.md's tracking sections, the `/author` and `/execute` skills (which card's payloads replace, including the `.worktrees/<id>` procedure `card worktree` absorbs), TRACKING.md gets a successor note. Agentpane's `**Work laptop:**` body marker maps naturally onto a card label.
5. **Bootstrap.** `card` isn't installable anywhere documented — every machine needs Bun plus this checkout on PATH. The work laptop also has to survive the `sbox` probe in `status`.

**Sensible next steps:** settle decisions 1 and 2 (yours), then init-redirect support, then a conversion pass over the corpus, then the agentpane prose cutover, then run agentpane on it for real. I haven't filed any of this — you're in discussion mode by your own protocol.

**You:**
1. kind and where will both go to labels. This was already decided, but I guess we're still not capturing everything, or at least surfacing it. Yes, migration will want to be a single big-bang cutover.
2. agentpane doesn't have a separate public tier tracker. Does card need changes to accommodate "this deck is public" somehow? Oh, the lint stuff, I guess?
3. I don't think we need to support auto-creating this repo. Hand migration is fine. Good point on being able to turn off the linting.
4. Yes, that'll be a big part of the cutover.
5. Not sure what you mean. `card` works from the CLI now. What am I missing? Maybe I'm being confused by "checkout on the PATH." What are you saying about sbox?

You crammed a lot of the good material in the last big paragraph.

**Me:** *[checked where the kind/where→labels decision actually lived]*

Found it — good news on "not capturing": the decision *was* captured, the failure was surfacing it. BRIEF.md's "What this project changes about the format" section: blockers become a field, labels become a field, `kind:` is dropped ("with labels present it is a mandatory label drawn from a closed set, and that set had already drifted once"), and `where:` is dropped for the same reason. My gap survey read BRIEF and still didn't connect that section to the migration question — a summarization miss, not a record miss.

One nuance: BRIEF doesn't send `where:` to a label — it says `where:` is dropped because "it named the code a card concerns, which the body says in more detail," i.e. its content belongs in the body. Your "both go to labels" diverges from that for `where:`, and `where:` values are long free-text with backticked file paths, which would make awkward labels. Flagging so the conversion card makes that choice consciously.

**2 — yes, two accommodations, one code, one prose.** Code: `lint-commit` needs a config-driven off switch (a key in `card-config.toml`). Prose: the payload every session reads *teaches* the privacy rule — "the deck is this project's private, agent-facing record," "nothing public ever cites a card id" — wrong guidance in a public-deck repo. That's BRIEF's deferred "per-project payload variants" question showing up with its first real customer. Minimal shape: one config key both the lint verb and a few payload sentences branch on.

**3 — agreed**, no `init` changes, lint switch comes out of #2. **4 — agreed**, cutover card carries the ~66-reference inventory. **5 — two separate small things, said badly:** install is fine (clone, bun, link onto PATH — the gap is just no README); sbox only trips a machine that has sbox installed but runs sessions unsandboxed.

Point taken on the cramming — noted in my memory to keep endings unpacked.

**You:**
1. The brief is wrong, then. We should fix it. At no point did I decide we were dropping "where" or moving it into the body. Don't invent complexity; where is either home server or work laptop, practically a boolean.
2. Okay, that will complicate things. We'll need to render the payloads in the code.
5. Fair, though no README exists, so this is not that surprising. Sbox is not a problem at all, as you've realized.

Can you uncram that paragraph so we can talk about it too? Numbers and all that helpful stuff?

**Me:** *[checked the actual `where:` values in agentpane before editing BRIEF]*

Good thing I checked — the brief isn't wrong; two different things got merged in memory:

**`where:` and the machine marker are two different fields.** All 101 `where:` values in agentpane's corpus are code grounding — file paths, module names (e.g. `'src/server/http/session-manager.ts'`), not one names a machine. The machine flag lives in TRACKING.md's `**Work laptop:**` marker — a mandated first-body-line, carried by 7 items. BRIEF already handles both exactly the way you want: `where:` → body (code grounding), `**Work laptop:**` → label (the machine boolean, BRIEF's own stated motivating case for labels — "resource gating"). Nothing to fix in BRIEF.

**Rendering:** noted — `status.ts` already renders `{{DECK}}`-style placeholders, so a public-deck key extends an existing mechanism.

**The uncrammed migration path, in order:**
1. **Public-deck config key** — one key in `card-config.toml`; `lint-commit` stands down on it, payload renders privacy sentences conditionally. The only card-side code change the migration needs.
2. **Corpus conversion** — big-bang over 101 files: `kind:` → label, `**Work laptop:**` → label, `where:` → body opening line. Scriptable; the script + a spot-check are the card.
3. **Agentpane prose cutover** — AGENTS.md, retire `/author`/`/execute` skills in favor of card's payloads, TRACKING.md successor note. ~66 references, all prose.
4. **Machine setup note** — README recording install + deck-config setup.

**Independent smaller items** (11 listed, e.g. `card status` inside a worktree gets the full payload instead of a trimmed one; `init` never mentions itself when there's no deck; four verbs ignore argv; a stale BRIEF pointer; no backup story for private decks; submodule path bug). My read: 1 and 2 are dispatchable as soon as authored, 3 depends on both, 4 is anytime.

**You:** Gotcha, I misunderstood. You are correct. Another, better-fitting experiment would be for me to use card on real work, on the work laptop, where Jira would be the public ticket repo. There card would work much closer to how it works here. What might I be missing in that context? I'll note that in this repo, you always [run] something directly card status adjacent in the beginning. That might be annoying in the real work situation; I guess I'll find out.

**Me:** Right — that experiment is actually the tool's *home* context: BRIEF's "two-tier Jira model" (inherited from OW-59) assumes a private deck under a corporate repo with Jira as the public tier. No public-deck key needed, none of the agentpane work applies. Four buckets of what you might be missing:

1. **Getting it onto the laptop** — clone, bun, link, plus `rg`. The bootstrap line can't live in the corporate repo's AGENTS.md (that's the privacy test itself), so it has to live in your *personal* global agent instructions on that machine — which means you get to tune the cadence yourself, unlike here where the repo mandates it.
2. **The deck is one unsynced copy on a machine you don't fully control** — `rm -rf .git`, a fresh clone, or an IT reimage destroys it. The only backup is a manual tar. This is the one thing I'd actually want solved before trusting real work to it.
3. **Leak vectors** — the card id appears in worktree path and branch name; pushing such a branch would publish an id, and pushing feature branches is muscle memory at work. Pick a distinct prefix per repo.
4. **Small frictions** — no Jira integration by design (`--promoted` flag + hand-filed close note), multiple repos mean multiple decks with no cross-deck view.

**You:** I'm not worried about the lack of backups. Consider that I've successfully been doing work without cards at all for a while. The information that would be captured in closed cards is simply lost right now. And open cards are short-lived.

**Me:** Fair, and it reframes the risk correctly: the deck is pure upside over your current baseline. Losing it returns you to the status quo, not below it. Backup drops off the list. The one thing to watch: the calculus holds only while that baseline stays true — it shifts if the deck ever becomes the *only* home of something you'd previously have written into a Jira comment. Not a reason to build anything now.

**You:** Okay, back to Agentpane. We have no cards here right now, right? But we have a few features we will need for cards to work in Agentpane.

**Me:** Confirmed — no open cards. And yes, though it's really **one feature with two consumers**, plus work needing no new features at all:

**The feature: a public-deck key in `card-config.toml`** (something like `public = true`, hand-written during setup). Two readers:
1. `lint-commit` stands down on it.
2. The payload renders conditionally — the privacy-boundary sentences must not be served in a public-deck repo, extending `status.ts`'s existing `{{DECK}}`-style substitution.

**Everything else needs no card-side change** — worth stating so nothing phantom gets built: the deck redirect already resolves, agentpane's `open/`/`closed/` layout already matches, mixed id generations are fine, `card new` will draw proper `OW-syllable` ids once `prefix = "OW"`.

So the card set I'd author: (1) public-deck key: lint-commit, (2) public-deck key: payload rendering (carries `--label payload`), (3) corpus conversion script, (4) prose cutover in agentpane. One routing question: do 3 and 4 — landing in agentpane's own repo — live in this deck, or as OW items in agentpane's own tracker? My lean: this deck, since splitting the migration's record across the system being replaced seems worse.

**You:** This migration will be very hands-on. I don't see the need to use the blocked-by mechanism here. Let's do 1, 2 here and 3, 4 as OW tickets. And I suppose we need to resolve OW-59. Please author 1 and 2.

**Me:** *[swept closed pile for prior art — card-vateva built lint-commit, card-fonupi weighed payload post-processing; amended card-rovilo to cite card-nefowe]*

Both cards filed — **card-rovilo** (lint-commit stands down on a public deck) and **card-nefowe** (conditional payload rendering, `payload` label). They cite each other, no blocked-by, either can land first. Judgment calls flagged for your veto: the key is spelled `public = true` (never explicitly discussed); rovilo refuses a non-boolean `public` value rather than guessing; nefowe's sentence inventory is my survey, not settled — the implementer confirms the final set; the cold-read settling question is mine ("may a commit in this repo cite a card id?").

Not done, deliberately: items 3/4 (corpus conversion, prose cutover) as OW tickets, and resolving OW-59 — agentpane-side writes in agentpane's own conventions, belonging to a session in that repo.

**You:** Good judgment calls. While the new tickets are motivated by migrating Agentpane, there is nothing Agentpane-specific about them, right?

**Me:** Right — nothing agentpane-specific in either. Agentpane appears in both bodies only as rationale, never in the mechanism. `public = true` is a property any deck can declare; no agentpane path, prefix, or convention is load-bearing. That matches card-bomani's recorded principle: "card is a generic tool dropped into a repository it knows nothing about." The work-laptop experiment could use `public` too if some work repo ever went public-tier, and nothing would need changing. The one place migration specifics will live is the OW tickets — generic capability here, agentpane's use of it over there.

---

Two cards came out of this thread (`card-rovilo`, `card-nefowe`, both in this deck); the corpus-conversion and prose-cutover work, plus resolving OW-59, was deliberately routed to agentpane's own tracker rather than filed as cards here.
