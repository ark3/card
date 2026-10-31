import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import relay from "../payload/relay.md" with { type: "text" };
import { parseCard } from "../src/cardfile.ts";
import { type Cycle, fileHeld } from "../src/cycle.ts";
import { createDeck, type Deck } from "../src/deck.ts";
import { gitOrThrow } from "../src/git.ts";
import { ensureBranch, holdWorktree, land } from "../src/landing.ts";
import { closeCard, drawIds, fileCard, fileCardAs } from "../src/operations.ts";
import { startPlan, writeRecord } from "../src/plan.ts";
import { clearCardRoot, queue, removeTempDirs, stand, tempRepo } from "./helpers.ts";

const CARD = path.join(import.meta.dir, "..", "src", "card.ts");
// Each death is a fresh fixture and several runs of `card`.
const SLOW = 180_000;
// How many deaths are tried at once.
const BATCH = 6;

beforeEach(clearCardRoot);
afterAll(removeTempDirs);

/** Runs `card`, and with `dieAfter`, kills it after that many writes. */
async function card(args: string[], cwd: string, dieAfter?: number) {
  const env: Record<string, string | undefined> = { ...process.env, CARD_DIE_AFTER: dieAfter === undefined ? undefined : String(dieAfter) };
  delete env.CARD_ROOT;
  const proc = Bun.spawn([process.execPath, CARD, ...args], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

/** A fixture, and the headline of a finding its verb files, where it files one. */
type Fixture = { repo: string; deck: Deck; args: string[]; files?: string };

/** A repository with a `proj` deck and the plan `greeting`, its document written, and a way to file a card in it. */
async function greeting() {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  const file = (headline: string) => fileCard(deck, { labels: [], blockedBy: [], headline, body: "Body.\n" });
  const plan = await startPlan(deck, "greeting");
  await Bun.write(plan.document, "---\nbranch: plan/greeting\nstart-point: main\n---\n\n# Greet\n\nThe plan's intent.\n");
  return { repo, deck, plan, file };
}

/** The plan in the Cards stage with two cards drafted and a waiting card joined. */
async function drafted(): Promise<Fixture> {
  const { repo, deck, plan, file } = await greeting();
  const joined = await file("Add a farewell");
  await writeRecord(plan, { state: "Cards", placeholder: false, joins: [joined] });
  await Bun.write(path.join(plan.cardsDir, "01-add-the-greeting.md"), "# Add the greeting\n\nBody.\n");
  await Bun.write(path.join(plan.cardsDir, "02-check-the-plan.md"), "# Check the plan\n\nGuide.\n");
  return { repo, deck, args: ["done"] };
}

/** The plan in the Cards stage after an amend, holding two cards and a joined one, with no run yet. */
async function inCards(): Promise<Fixture> {
  const { repo, deck, plan, file } = await greeting();
  const first = await file("Add the greeting");
  const final = await file("Check the plan");
  const joined = await file("Add a farewell");
  await writeRecord(plan, { state: "Cards", placeholder: false, cards: [first, final], final, joins: [joined] });
  return { repo, deck, args: ["drop"] };
}

// A finding a reviewer gave with its approval, which its cycle holds.
const GOODBYE = { headline: "Nothing says goodbye", body: "The greeting has no farewell." };

/**
 * The plan at its first card's land step, the work left uncommitted in the
 * worktree, the reviewer having approved with a finding its cycle holds, not
 * yet filed: Bounced, or Running with a dead run, which reads Dead.
 */
async function atLand(state: "Bounced" | "Running", verb: string): Promise<Fixture> {
  const { repo, deck, plan, file } = await greeting();
  const first = await file("Add the greeting");
  const final = await file("Check the plan");
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  writeFileSync(path.join(tree, "hello.txt"), "half\n");
  const base = (await gitOrThrow(["rev-parse", "main"], repo)).trim();
  const session = { harness: "pi" as const, id: crypto.randomUUID(), dir: tree };
  const cycle: Cycle = {
    card: first,
    base,
    role: "reviewer",
    step: "land",
    sessions: { reviewer: session.id },
    rounds: 0,
    exchanges: 0,
    held: [GOODBYE],
    subject: "Add the greeting",
    note: "Landed.",
  };
  const bounce = state === "Bounced" ? { role: "reviewer" as const, session, cause: "the host repository's hook still refused the commit after 2 returns" } : null;
  await writeRecord(plan, { state, placeholder: false, cards: [first, final], final, harness: "pi", run: await deadRun(), cycle, bounce });
  return { repo, deck, args: [verb], files: GOODBYE.headline };
}

/** The plan with a run on record, which reads Dead when `state` is Running, its worktree clean, both its cards open. */
async function afterRun(state: "Running" | "Stopped"): Promise<Fixture> {
  const { repo, deck, plan, file } = await greeting();
  const first = await file("Add the greeting");
  const final = await file("Check the plan");
  await ensureBranch("plan/greeting", "main", repo);
  await holdWorktree(plan.slug, "plan/greeting", repo);
  const base = (await gitOrThrow(["rev-parse", "main"], repo)).trim();
  const cycle: Cycle = { card: first, base, role: "implementer", step: "implement", sessions: {}, rounds: 0, exchanges: 0 };
  await writeRecord(plan, { state, placeholder: false, cards: [first, final], final, harness: "pi", run: await deadRun(), cycle });
  return { repo, deck, args: ["drop"] };
}

/** A run record whose process has exited. */
async function deadRun() {
  const dead = Bun.spawn([process.execPath, "-e", ""]);
  await dead.exited;
  return { pid: dead.pid, boot: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() };
}

/**
 * Whether the plan `greeting` holds a recorded drop, which a drop that died
 * holds from its record until its plan's directory is renamed away.
 */
function dropRecorded({ deck }: Fixture): boolean {
  const state = path.join(deck.cardDir, "plans", "greeting", "state.json");
  return existsSync(state) && JSON.parse(readFileSync(state, "utf8")).pending?.verb === "drop";
}

/** The plan Ended, both its cards closed done, with one finding filed, unsettled, when `withFinding`. */
async function ended(withFinding: boolean): Promise<Fixture & { finding: string }> {
  const { repo, deck, plan, file } = await greeting();
  const first = await file("Add the greeting");
  const final = await file("Check the plan");
  await ensureBranch("plan/greeting", "main", repo);
  await holdWorktree(plan.slug, "plan/greeting", repo);
  await closeCard(deck, first, "done", "Landed.");
  await closeCard(deck, final, "done", "Guide.");
  const finding = await file("Nothing says goodbye");
  const findings = withFinding ? [{ id: finding, role: "reviewer" as const, card: first }] : [];
  if (!withFinding) await closeCard(deck, finding, "declined", "Not needed.");
  await writeRecord(plan, { state: "Ended", placeholder: false, cards: [first, final], final, harness: "pi", findings });
  return { repo, deck, finding, args: [] };
}

/** Two waiting cards and no plan. */
async function waiting(): Promise<Fixture> {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  const file = (headline: string) => fileCard(deck, { labels: [], blockedBy: [], headline, body: "Body.\n" });
  const ids = [await file("Nothing says goodbye"), await file("Nothing says hello")];
  return { repo, deck, args: ["promote", ...ids, "--key", "GREET-42"] };
}

/**
 * The deck and the plan `greeting` as every verb reads them, each card id put
 * as its card's headline, since each fixture draws ids of its own. A plan
 * bare `card` starts under a placeholder is left out.
 */
async function snapshot({ repo, deck }: Fixture) {
  const headlines = new Map<string, string>();
  const cards: string[] = [];
  for (const [where, dir] of [
    ["open", deck.openDir],
    ["closed", deck.closedDir],
  ] as const) {
    for (const name of readdirSync(dir).filter((each) => each.endsWith(".md"))) {
      const text = readFileSync(path.join(dir, name), "utf8");
      const { headline, closed } = parseCard(text);
      headlines.set(name.slice(0, -3), headline);
      const sections = (heading: string) => text.split("\n").filter((line) => line === `## ${heading}`).length;
      cards.push(`${where} ${closed ?? "-"} ${headline}, ${sections("Close note")} close notes, ${sections("Promotion")} promotions`);
    }
  }
  const named = (ids: string[]) => ids.map((id) => headlines.get(id) ?? id);
  const plansDir = path.join(deck.cardDir, "plans");
  const plans = existsSync(plansDir) ? readdirSync(plansDir).filter((name) => !name.startsWith("draft-")).sort() : [];
  const dir = path.join(plansDir, "greeting");
  let plan = null;
  if (existsSync(dir)) {
    const state = path.join(dir, "state.json");
    const record = existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : null;
    plan = {
      files: readdirSync(dir).filter((name) => !name.startsWith(".")).sort(),
      drafts: existsSync(path.join(dir, "cards")) ? readdirSync(path.join(dir, "cards")).sort() : null,
      record:
        record === null
          ? null
          : {
              state: record.state,
              cards: named(record.cards),
              final: record.final === null ? null : named([record.final])[0],
              joins: named(record.joins),
              later: named(record.later),
              findings: named(record.findings.map(({ id }: { id: string }) => id)),
              bounced: record.bounce !== null,
              pending: (record.pending ?? null) !== null,
            },
    };
  }
  const tree = path.join(repo, ".worktrees", "greeting");
  const worktree = existsSync(tree) ? await gitOrThrow(["status", "--porcelain", "--untracked-files=all"], tree) : null;
  return { cards: cards.sort(), plans, plan, worktree };
}

// Each verb, its fixture, and whether it is a plan's verb, which bare `card`
// finishes; `promote` writes no plan's record, so only its retry finishes it.
const VERBS: [string, () => Promise<Fixture>, boolean][] = [
  ["card done in the Cards stage", drafted, true],
  ["card drop in the Cards stage", inCards, true],
  ["card drop in Bounced", () => atLand("Bounced", "drop"), true],
  ["card drop in Dead", () => afterRun("Running"), true],
  ["card drop in Stopped", () => afterRun("Stopped"), true],
  ["card amend in Bounced", () => atLand("Bounced", "amend"), true],
  ["card stop in Dead", () => atLand("Running", "stop"), true],
  ["card finish at Ended", async () => ({ ...(await ended(false)), args: ["finish"] }), true],
  [
    "card join at Ended",
    async () => {
      const fixture = await ended(true);
      return { ...fixture, args: ["join", fixture.finding] };
    },
    true,
  ],
  ["card promote --key over two cards", waiting, false],
];

for (const [verb, setup, planVerb] of VERBS) {
  test(
    `${verb}, killed after each of its writes in turn: bare card then finds the deck as it was before the verb or as the verb leaves it, and a retry of the verb ends where an uninterrupted one does`,
    async () => {
      const uninterrupted = await setup();
      const before = await snapshot(uninterrupted);
      const run = await card(uninterrupted.args, uninterrupted.repo);
      expect(run.stderr).toBe("");
      expect(run.code).toBe(0);
      const after = await snapshot(uninterrupted);
      expect(after).not.toEqual(before);
      // What the owner is told, which a drop finished from its record prints too.
      const dropped = verb.startsWith("card drop") ? ownerBlockOf(run.stdout, uninterrupted) : null;
      // Every retry ends as this does, so each files the finding once too.
      const { files } = uninterrupted;
      if (files !== undefined) expect(after.cards.filter((line) => line.includes(files))).toEqual([`open - ${files}, 0 close notes, 0 promotions`]);

      /** Kills the verb after its `writes`th write, unless it finishes first, and returns whether it died. */
      async function killed(fixture: Fixture, writes: number): Promise<boolean> {
        const dying = await card(fixture.args, fixture.repo, writes);
        if (dying.code === 0) return false;
        expect(dying.stderr).toBe("");
        expect(dying.code).toBe(137);
        return true;
      }

      /** Whether the verb died after its `writes`th write, checking bare `card` and a retry after the death where it did. */
      async function dieAfter(writes: number): Promise<boolean> {
        const looked = await setup();
        if (!(await killed(looked, writes))) return false;
        const recorded = dropRecorded(looked);
        const bare = await card([], looked.repo);
        expect(bare.code).toBe(0);
        if (planVerb) expect([before, after]).toContainEqual(await snapshot(looked));
        if (dropped !== null && recorded) expect(ownerBlockOf(bare.stdout, looked)).toBe(dropped);

        const retried = await setup();
        expect(await killed(retried, writes)).toBe(true);
        await card(retried.args, retried.repo);
        expect(await snapshot(retried)).toEqual(after);
        return true;
      }

      let deaths = 0;
      for (let from = 1; deaths === from - 1; from += BATCH) {
        const died = await Promise.all(Array.from({ length: BATCH }, (_, index) => dieAfter(from + index)));
        deaths += died.filter(Boolean).length;
      }
      // A hook gone inert lets the verb finish at its first try, which this refuses.
      expect(deaths).toBeGreaterThan(1);
    },
    SLOW,
  );
}

test("a card stop killed right after its settling recorded the held finding's id is finished before card resume runs: the finding is filed once and listed in the plan's findings", async () => {
  // The first death after which the record holds the finding's id.
  let fixture: Fixture;
  let state: string;
  for (let writes = 1; ; writes++) {
    fixture = await atLand("Running", "stop");
    expect((await card(fixture.args, fixture.repo, writes)).code).toBe(137);
    state = path.join(fixture.deck.cardDir, "plans", "greeting", "state.json");
    if (JSON.parse(readFileSync(state, "utf8")).cycle.held[0].id !== undefined) break;
  }
  const { repo, deck } = fixture;
  expect(readdirSync(deck.openDir).filter((name) => readFileSync(path.join(deck.openDir, name), "utf8").includes(GOODBYE.headline))).toEqual([]);

  // The resumed run's reconciler stops it, so it writes nothing more once it bounces.
  const outer = process.env.PATH;
  try {
    const control = stand(["pi"]);
    queue(control, [{ answer: JSON.stringify({ outcome: "stop", cause: "intent", question: "Is a greeting wanted?" }) }]);
    const resumed = await card(["resume"], repo);
    expect(resumed.code).toBe(0);
    for (const deadline = Date.now() + 20_000; JSON.parse(readFileSync(state, "utf8")).state !== "Bounced"; await Bun.sleep(50)) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the resumed run to bounce");
    }
  } finally {
    process.env.PATH = outer;
  }

  const filed = (await snapshot(fixture)).cards.filter((line) => line.includes(GOODBYE.headline));
  expect(filed).toEqual(["open - Nothing says goodbye, 0 close notes, 0 promotions"]);
  const { findings } = JSON.parse(readFileSync(state, "utf8"));
  expect(findings).toHaveLength(1);
  expect(readFileSync(path.join(deck.openDir, `${findings[0].id}.md`), "utf8")).toContain(`# ${GOODBYE.headline}`);
}, 60_000);

test("a card done that died once recorded, its drafts then deleted, is finished from the record: bare card finds the plan in Check with every drafted card filed", async () => {
  const fixture = await drafted();
  expect((await card(fixture.args, fixture.repo, 1)).code).toBe(137);
  const cardsDir = path.join(fixture.deck.cardDir, "plans", "greeting", "cards");
  for (const name of readdirSync(cardsDir)) rmSync(path.join(cardsDir, name));

  const bare = await card([], fixture.repo);
  expect(bare.code).toBe(0);
  const { plan } = await snapshot(fixture);
  expect(plan!.record).toMatchObject({ state: "Check", cards: ["Add the greeting", "Add a farewell", "Check the plan"], pending: false });
});

test("a card done that died after filing a card, that card then edited, keeps the card as edited: bare card finds the plan in Check with it in the order, and no plan held", async () => {
  const fixture = await drafted();
  expect((await card(fixture.args, fixture.repo, 2)).code).toBe(137);
  const record = JSON.parse(readFileSync(path.join(fixture.deck.cardDir, "plans", "greeting", "state.json"), "utf8"));
  const filed = path.join(fixture.deck.openDir, `${record.pending.drafts[0].id}.md`);
  const edited = readFileSync(filed, "utf8").replace("Body.", "Body, edited after the death.");
  writeFileSync(filed, edited);

  const bare = await card([], fixture.repo);
  expect(bare.stderr).not.toContain("finishing it failed");
  expect(bare.code).toBe(0);
  expect((await snapshot(fixture)).plan!.record).toMatchObject({ state: "Check", cards: ["Add the greeting", "Add a farewell", "Check the plan"], pending: false });
  expect(readFileSync(filed, "utf8")).toBe(edited);
});

test("a drop that died once recorded, an untracked file then written into its worktree, is finished all the same: bare card finds the plan gone, its cards closed declined once, and no plan held", async () => {
  const fixture = await afterRun("Stopped");
  expect((await card(fixture.args, fixture.repo, 1)).code).toBe(137);
  const tree = path.join(fixture.repo, ".worktrees", "greeting");
  writeFileSync(path.join(tree, "scratch.txt"), "written after the death\n");

  const bare = await card([], fixture.repo);
  expect(bare.stderr).not.toContain("finishing it failed");
  expect(bare.code).toBe(0);
  const { plans, cards } = await snapshot(fixture);
  expect(plans).toEqual([]);
  expect(cards).toEqual(["closed declined Add the greeting, 1 close notes, 0 promotions", "closed declined Check the plan, 1 close notes, 0 promotions"]);
  expect(existsSync(tree)).toBe(false);
});

// Each verb whose record carries card ids, its fixture, and the ids it carries.
const CARRIES: [string, () => Promise<Fixture>, (pending: { drafts?: { id: string }[]; id?: string }) => string[]][] = [
  ["card done in the Cards stage", drafted, (pending) => pending.drafts!.map(({ id }) => id)],
  [
    "card join at Ended",
    async () => {
      const fixture = await ended(true);
      return { ...fixture, args: ["join", fixture.finding] };
    },
    (pending) => [pending.id!],
  ],
];

for (const [verb, setup, carried] of CARRIES) {
  test(`a plan held on a recorded ${verb} holds the ids it carries: another plan is shown none of them waiting, and join, decline and promote refuse each, naming the held plan`, async () => {
    const fixture = await setup();
    const { repo, deck } = fixture;
    expect((await card(fixture.args, repo, 1)).code).toBe(137);
    const dir = path.join(deck.cardDir, "plans", "greeting");
    const ids = carried(JSON.parse(readFileSync(path.join(dir, "state.json"), "utf8")).pending);
    // A directory where the record is staged, so the finisher fails writing it, as on a disk error.
    mkdirSync(path.join(dir, ".state.json.writing"));
    const other = await writeRecord(await startPlan(deck, "other"), { state: "Cards", placeholder: false });

    const shown = await card(["--plan", other.slug], repo);
    expect(shown.stderr).toContain("on the plan `greeting` is recorded but did not finish, and finishing it failed");
    expect(shown.code).toBe(0);
    for (const id of ids) {
      expect(existsSync(path.join(deck.openDir, `${id}.md`))).toBe(true);
      expect(shown.stdout).not.toContain(id);
      for (const [args, stdin] of [
        [["--plan", other.slug, "join", id], ""],
        [["decline", id], "Not needed.\n"],
        [["promote", id], "A ticket.\n"],
      ] as const) {
        const proc = Bun.spawn([process.execPath, CARD, ...args], { cwd: repo, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
        const stderr = await new Response(proc.stderr).text();
        expect(await proc.exited).toBe(1);
        const refusal = stderr.trimEnd().split("\n").at(-1)!;
        expect(refusal).toStartWith(`card: ${id} `);
        expect(refusal).toContain("the plan `greeting`");
      }
      expect(readFileSync(path.join(deck.openDir, `${id}.md`), "utf8")).not.toContain("## Promotion");
    }
  });
}

test("a drop git refuses once recorded holds that plan alone: another plan and decline go on, and the drop finishes on the first card run once git can remove the worktree", async () => {
  const fixture = await afterRun("Stopped");
  const { repo, deck } = fixture;
  const tree = path.join(repo, ".worktrees", "greeting");
  await gitOrThrow(["worktree", "lock", tree], repo);
  const other = await writeRecord(await startPlan(deck, "other"), { state: "Cards", placeholder: false });
  const waitingId = await fileCard(deck, { labels: [], blockedBy: [], headline: "Nothing says goodbye", body: "Body.\n" });

  const dropping = await card(["--plan", "greeting", "drop"], repo);
  expect(dropping.code).toBe(1);
  expect(dropping.stderr).toContain("the drop of the plan `greeting` is recorded, but git would not remove its worktree");

  const elsewhere = await card(["--plan", other.slug], repo);
  expect(elsewhere.code).toBe(0);
  expect(elsewhere.stderr).toContain("`card drop` on the plan `greeting` is recorded but did not finish");
  const refused = await card(["--plan", "greeting"], repo);
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain("the plan `greeting` is held until its recorded `card drop` finishes: it opens no command meanwhile");
  const declining = Bun.spawn([process.execPath, CARD, "decline", waitingId], { cwd: repo, stdin: new Blob(["Not needed.\n"]), stdout: "pipe", stderr: "pipe" });
  expect(await declining.exited).toBe(0);
  expect((await snapshot(fixture)).cards).toContain("closed declined Nothing says goodbye, 1 close notes, 0 promotions");
  const listing = await card([], repo);
  expect(listing.code).toBe(0);
  expect(listing.stdout).toContain("greeting  Stopped, held until its recorded `card drop` finishes\n");
  expect(listing.stdout).toContain("A held plan is held until its recorded verb finishes: it opens no command meanwhile");
  expect(listing.stdout).not.toContain("card --plan greeting");
  const unnamed = await card(["drop"], repo);
  expect(unnamed.stderr).not.toContain("card --plan greeting drop");

  await gitOrThrow(["worktree", "unlock", tree], repo);
  expect((await card(["--plan", other.slug], repo)).code).toBe(0);
  const { plans, cards } = await snapshot(fixture);
  expect(plans).toEqual(["other"]);
  expect(cards).toContain("closed declined Add the greeting, 1 close notes, 0 promotions");
});

test("a hidden file or a hidden directory of someone else's in the plans directory is left alone, and every card run goes on", async () => {
  const { repo, deck } = await greeting();
  const plansDir = path.join(deck.cardDir, "plans");
  writeFileSync(path.join(plansDir, ".DS_Store"), "");
  mkdirSync(path.join(plansDir, ".notes"));
  writeFileSync(path.join(plansDir, ".notes", "kept.md"), "Kept.\n");

  expect((await card([], repo)).code).toBe(0);
  expect(existsSync(path.join(plansDir, ".DS_Store"))).toBe(true);
  expect(readFileSync(path.join(plansDir, ".notes", "kept.md"), "utf8")).toBe("Kept.\n");
});

/**
 * The plan Bounced at its first card's land step after the commit landed, the
 * worktree then removed by hand, so a drop's settling holds it again and
 * closes the first card done.
 */
async function landedBounced(): Promise<Fixture> {
  const { repo, deck, plan, file } = await greeting();
  const first = await file("Add the greeting");
  const final = await file("Check the plan");
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  const base = (await gitOrThrow(["rev-parse", "main"], repo)).trim();
  writeFileSync(path.join(tree, "hello.txt"), "hello\n");
  const commit = await land("Add the greeting", "Landed.", tree);
  const session = { harness: "pi" as const, id: crypto.randomUUID(), dir: tree };
  const cycle: Cycle = { card: first, base, role: "reviewer", step: "land", sessions: {}, rounds: 0, exchanges: 0, note: "Landed.", commit };
  const bounce = { role: "reviewer" as const, session, cause: "usage limit reached" };
  await writeRecord(plan, { state: "Bounced", placeholder: false, cards: [first, final], final, harness: "pi", run: await deadRun(), cycle, bounce });
  await gitOrThrow(["worktree", "remove", tree], repo);
  return { repo, deck, args: ["drop"] };
}

test("a drop in Bounced whose worktree the owner removed by hand still settles the card in flight, closing done a card whose commit landed", async () => {
  const fixture = await landedBounced();
  const dropping = await card(fixture.args, fixture.repo);
  expect(dropping.stderr).toBe("");
  expect(dropping.code).toBe(0);
  expect((await snapshot(fixture)).cards).toEqual([
    "closed declined Check the plan, 1 close notes, 0 promotions",
    "closed done Add the greeting, 1 close notes, 0 promotions",
  ]);
});

test(
  "a drop in Bounced whose settling closes the card in flight done, killed after each of its writes while it is recorded, is finished by bare card printing the owner block an uninterrupted drop prints, the card closed done not among those closed declined",
  async () => {
    const uninterrupted = await landedBounced();
    const run = await card(uninterrupted.args, uninterrupted.repo);
    expect(run.code).toBe(0);
    const expected = ownerBlockOf(run.stdout, uninterrupted);
    expect(expected).toContain("its worktree <repo>/.worktrees/greeting is removed, and its branch `plan/greeting` is kept");
    expect(expected).toContain("These cards of the plan are closed declined:\n\n<Check the plan>  Check the plan\n");
    expect(expected).not.toContain("Add the greeting");

    // Deaths before the record, or once the plan's directory is renamed away, leave no drop recorded to finish.
    let deaths = 0;
    for (let writes = 1; ; writes++) {
      const fixture = await landedBounced();
      const dying = await card(fixture.args, fixture.repo, writes);
      if (dying.code === 0) break;
      expect(dying.code).toBe(137);
      if (!dropRecorded(fixture)) continue;
      deaths++;
      const bare = await card([], fixture.repo);
      expect(bare.code).toBe(0);
      expect(ownerBlockOf(bare.stdout, fixture)).toBe(expected);
    }
    expect(deaths).toBeGreaterThan(1);
  },
  SLOW,
);

test("a drop recorded before a drop's report was recorded with it, killed once recorded, is finished by bare card printing the owner block an uninterrupted drop prints", async () => {
  const uninterrupted = await afterRun("Stopped");
  const run = await card(uninterrupted.args, uninterrupted.repo);
  expect(run.code).toBe(0);
  const expected = ownerBlockOf(run.stdout, uninterrupted);
  expect(expected).toContain("its worktree <repo>/.worktrees/greeting is removed, and its branch `plan/greeting` is kept");
  expect(expected).toContain("These cards of the plan are closed declined:\n\n<Add the greeting>  Add the greeting\n<Check the plan>  Check the plan\n");

  const fixture = await afterRun("Stopped");
  await diedRecorded(fixture);
  const state = path.join(fixture.deck.cardDir, "plans", "greeting", "state.json");
  const record = JSON.parse(readFileSync(state, "utf8"));
  // As the record of a drop read before it carried its report.
  record.pending = { verb: "drop", settles: record.pending.settles };
  writeFileSync(state, JSON.stringify(record));

  const bare = await card([], fixture.repo);
  expect(bare.stderr).not.toContain("finishing it failed");
  expect(bare.code).toBe(0);
  expect(ownerBlockOf(bare.stdout, fixture)).toBe(expected);
  expect((await snapshot(fixture)).plans).toEqual([]);
});

test("a run that died after its landing filed the reviewer's findings and before the commit was recorded is carried on by bare card filing none of them twice", async () => {
  const { repo, deck, plan, file } = await greeting();
  const first = await file("Add the greeting");
  const final = await file("Check the plan");
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  const base = (await gitOrThrow(["rev-parse", "main"], repo)).trim();
  writeFileSync(path.join(tree, "hello.txt"), "hello\n");
  await land("Add the greeting", "Landed.", tree);
  const cycle: Cycle = {
    card: first,
    base,
    role: "reviewer",
    step: "land",
    sessions: { reviewer: crypto.randomUUID() },
    rounds: 0,
    exchanges: 0,
    held: [GOODBYE],
    subject: "Add the greeting",
    note: "Landed.",
  };
  // As the landing leaves the plan once the commit is made and its findings filed.
  const landed = await fileHeld(deck, await writeRecord(plan, { state: "Running", placeholder: false, cards: [first, final], final, harness: "pi", run: await deadRun(), cycle }));
  expect(landed.findings).toHaveLength(1);

  // The carried-on run's reconciler stops it, so it writes nothing more once it bounces.
  const outer = process.env.PATH;
  try {
    const control = stand(["pi"]);
    queue(control, [{ answer: JSON.stringify({ outcome: "stop", cause: "intent", question: "Is a greeting wanted?" }) }]);
    const carried = await card([], repo);
    expect(carried.stderr).toBe("");
    expect(carried.code).toBe(0);
    const state = path.join(plan.dir, "state.json");
    for (const deadline = Date.now() + 20_000; JSON.parse(readFileSync(state, "utf8")).state !== "Bounced"; await Bun.sleep(50)) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the carried-on run to bounce");
    }
  } finally {
    process.env.PATH = outer;
  }

  const record = JSON.parse(readFileSync(path.join(plan.dir, "state.json"), "utf8"));
  expect(record.findings).toEqual(landed.findings);
  expect((await snapshot({ repo, deck, args: [] })).cards.filter((line) => line.includes(GOODBYE.headline))).toEqual([
    "open - Nothing says goodbye, 0 close notes, 0 promotions",
  ]);
}, 30_000);

// A finding an implementer gave with its account.
const FAREWELL = { headline: "Nothing says farewell", body: "The greeting has no farewell." };

/**
 * The plan Running with a dead run, as a run dies partway through filing an
 * implementer's finding: its id drawn and recorded in the cycle, and its card
 * not yet written, or written where `written` and not yet in the plan's
 * findings.
 */
async function diedFiling(written: boolean) {
  const { repo, deck, plan, file } = await greeting();
  const first = await file("Add the greeting");
  const final = await file("Check the plan");
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  writeFileSync(path.join(tree, "hello.txt"), "hello\n");
  const base = (await gitOrThrow(["rev-parse", "main"], repo)).trim();
  const [id] = (await drawIds(deck, 1)) as [string];
  const cycle: Cycle = {
    card: first,
    base,
    role: "implementer",
    step: "implement",
    sessions: { reconciler: crypto.randomUUID(), implementer: crypto.randomUUID() },
    rounds: 0,
    exchanges: 0,
    held: [{ ...FAREWELL, role: "implementer", id }],
  };
  if (written) {
    const body = `Filed by the implementer of ${first}, in the plan ${plan.slug}.\n\n${FAREWELL.body}`;
    await fileCardAs(deck, id, { labels: [], blockedBy: [], headline: FAREWELL.headline, body });
  }
  await writeRecord(plan, { state: "Running", placeholder: false, cards: [first, final], final, harness: "pi", run: await deadRun(), cycle });
  return { repo, deck, plan, first, id };
}

for (const written of [false, true]) {
  const death = written ? "after writing its card and before listing it" : "after recording its id and before writing its card";

  test(`a run that died filing an implementer's finding ${death} is carried on by bare card, which lists the finding once under its recorded id, one card carrying it`, async () => {
    const { repo, deck, plan, first, id } = await diedFiling(written);

    // The carried-on run's reconciler stops it, so it writes nothing more once it bounces.
    const outer = process.env.PATH;
    try {
      const control = stand(["pi"]);
      queue(control, [{ answer: JSON.stringify({ outcome: "stop", cause: "intent", question: "Is a greeting wanted?" }) }]);
      const carried = await card([], repo);
      expect(carried.stderr).toBe("");
      expect(carried.code).toBe(0);
      const state = path.join(plan.dir, "state.json");
      for (const deadline = Date.now() + 20_000; JSON.parse(readFileSync(state, "utf8")).state !== "Bounced"; await Bun.sleep(50)) {
        if (Date.now() > deadline) throw new Error("timed out waiting for the carried-on run to bounce");
      }
    } finally {
      process.env.PATH = outer;
    }

    const record = JSON.parse(readFileSync(path.join(plan.dir, "state.json"), "utf8"));
    expect(record.findings).toEqual([{ id, role: "implementer", card: first }]);
    expect((await snapshot({ repo, deck, args: [] })).cards.filter((line) => line.includes(FAREWELL.headline))).toEqual([
      "open - Nothing says farewell, 0 close notes, 0 promotions",
    ]);
  }, 30_000);

  test(`a run that died filing an implementer's finding ${death} is stopped by card stop, which lists the finding once under its recorded id, one card carrying it`, async () => {
    const { repo, deck, plan, first, id } = await diedFiling(written);

    const stopping = await card(["stop"], repo);
    expect(stopping.stderr).toBe("");
    expect(stopping.code).toBe(0);

    const record = JSON.parse(readFileSync(path.join(plan.dir, "state.json"), "utf8"));
    expect(record.state).toBe("Stopped");
    expect(record.findings).toEqual([{ id, role: "implementer", card: first }]);
    expect((await snapshot({ repo, deck, args: [] })).cards.filter((line) => line.includes(FAREWELL.headline))).toEqual([
      "open - Nothing says farewell, 0 close notes, 0 promotions",
    ]);
  });

  test(`a run that died filing an implementer's finding ${death} is dropped by card drop, which leaves the finding one waiting card under its recorded id`, async () => {
    const { repo, deck, first, id } = await diedFiling(written);

    const dropping = await card(["drop"], repo);
    expect(dropping.stderr).toBe("");
    expect(dropping.code).toBe(0);

    const { plans, cards } = await snapshot({ repo, deck, args: [] });
    expect(plans).toEqual([]);
    expect(cards.filter((line) => line.includes(FAREWELL.headline))).toEqual(["open - Nothing says farewell, 0 close notes, 0 promotions"]);
    expect(readFileSync(path.join(deck.openDir, `${id}.md`), "utf8")).toContain(`Filed by the implementer of ${first}, in the plan greeting.`);
  });
}

test("card done refuses a drafted card it could not write before it writes anything, so fixing the draft and running card done again files every card once", async () => {
  const fixture = await drafted();
  const cardsDir = path.join(fixture.deck.cardDir, "plans", "greeting", "cards");
  const second = path.join(cardsDir, "02-check-the-plan.md");
  writeFileSync(second, "---\nlabels: [[x]]\n---\n\n# Check the plan\n\nGuide.\n");
  const before = await snapshot(fixture);

  const refused = await card(["done"], fixture.repo);
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain("cannot be written");
  expect(await snapshot(fixture)).toEqual(before);

  writeFileSync(second, "# Check the plan\n\nGuide.\n");
  expect((await card(["done"], fixture.repo)).code).toBe(0);
  expect((await snapshot(fixture)).plan!.record).toMatchObject({ state: "Check", cards: ["Add the greeting", "Add a farewell", "Check the plan"], pending: false });
});

test("card amend in Stopped refuses before it writes anything when git will not give the plan back its worktree, and leaves no plan held", async () => {
  const fixture = await afterRun("Stopped");
  const { repo } = fixture;
  await gitOrThrow(["worktree", "remove", path.join(repo, ".worktrees", "greeting")], repo);
  // The plan's branch checked out in the main checkout, where git refuses it a worktree.
  await gitOrThrow(["checkout", "-q", "plan/greeting"], repo);
  const before = await snapshot(fixture);

  const refused = await card(["amend"], repo);
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain("is already used by worktree");
  expect(await snapshot(fixture)).toEqual(before);
  expect((await card([], repo)).code).toBe(0);
});

test("card drop in Stopped with its worktree gone and its branch checked out elsewhere drops the plan, needing no worktree, since it settles nothing", async () => {
  const fixture = await afterRun("Stopped");
  const { repo } = fixture;
  await gitOrThrow(["worktree", "remove", path.join(repo, ".worktrees", "greeting")], repo);
  await gitOrThrow(["checkout", "-q", "plan/greeting"], repo);

  const dropping = await card(["drop"], repo);
  expect(dropping.stderr).toBe("");
  expect(dropping.code).toBe(0);
  const { plans, cards } = await snapshot(fixture);
  expect(plans).toEqual([]);
  expect(cards).toEqual(["closed declined Add the greeting, 1 close notes, 0 promotions", "closed declined Check the plan, 1 close notes, 0 promotions"]);
});

/** The text between each pair of owner marks in a printout, in order. */
function ownerBlocks(stdout: string): string[] {
  return [...stdout.matchAll(/<for_owner>\n([\s\S]*?)<\/for_owner>\n/g)].map((match) => match[1]!);
}

/** Kills the fixture's verb right after its first write, its pending record, and checks the record holds it. */
async function diedRecorded({ repo, deck, args }: Fixture): Promise<void> {
  expect((await card(args, repo, 1)).code).toBe(137);
  expect(JSON.parse(readFileSync(path.join(deck.cardDir, "plans", "greeting", "state.json"), "utf8")).pending).not.toBeNull();
}

/** A second plan in progress, `other`, in the Cards stage. */
async function otherInCards(deck: Deck): Promise<void> {
  await writeRecord(await startPlan(deck, "other"), { state: "Cards", placeholder: false });
}

/** A second plan in progress, `other`, Running with its run on record, which reads Dead, so `card stop` would stop it. */
async function otherRunning(repo: string, deck: Deck): Promise<string> {
  const plan = await startPlan(deck, "other");
  await Bun.write(plan.document, "---\nbranch: plan/other\nstart-point: main\n---\n\n# Other\n\nAnother intent.\n");
  const first = await fileCard(deck, { labels: [], blockedBy: [], headline: "Do the other thing", body: "Body.\n" });
  await ensureBranch("plan/other", "main", repo);
  await holdWorktree(plan.slug, "plan/other", repo);
  const base = (await gitOrThrow(["rev-parse", "main"], repo)).trim();
  const cycle: Cycle = { card: first, base, role: "implementer", step: "implement", sessions: {}, rounds: 0, exchanges: 0 };
  await writeRecord(plan, { state: "Running", placeholder: false, cards: [first], final: first, harness: "pi", run: await deadRun(), cycle });
  return path.join(plan.dir, "state.json");
}

// Each verb that ends an authoring stage, its fixture, the reminder its
// owner block carries, and the heading of the next stage's prompt.
const ENDS_STAGE: [string, () => Promise<Fixture>, string, string][] = [
  ["card done in the Cards stage", drafted, "The Check stage runs in a fresh session, not this one", "# The Check stage"],
  [
    "card join at Ended",
    async () => {
      const fixture = await ended(true);
      return { ...fixture, args: ["join", fixture.finding] };
    },
    "The Cards stage runs in a fresh session, not this one",
    "# The Cards stage",
  ],
];

for (const [verb, setup, reminder, heading] of ENDS_STAGE) {
  for (const many of [false, true]) {
    test(`a recorded ${verb} that died is finished by bare card${many ? ", with a second plan in progress," : ""} which prints its reminder that the next stage runs in a fresh session, and stops there, printing no next stage's prompt`, async () => {
      const fixture = await setup();
      await diedRecorded(fixture);
      if (many) await otherInCards(fixture.deck);

      const bare = await card([], fixture.repo);
      expect(bare.code).toBe(0);
      const owner = ownerBlocks(bare.stdout).join("");
      expect(owner).toContain(reminder);
      expect(owner).toContain(`have it run \`${many ? "card --plan greeting" : "card"}\`.`);
      expect(bare.stdout).not.toContain(heading);
      expect(bare.stdout).not.toContain("did not run");
    });
  }
}

test("a recorded card done that died, finished by another verb on another plan, prints the done's owner block and says that verb did not run and must be run again, and that verb does not act", async () => {
  const fixture = await drafted();
  await diedRecorded(fixture);
  const other = await otherRunning(fixture.repo, fixture.deck);

  const stopping = await card(["--plan", "other", "stop"], fixture.repo);
  expect(stopping.code).toBe(0);
  const owner = ownerBlocks(stopping.stdout);
  expect(owner).toHaveLength(1);
  expect(owner[0]).toContain("the Cards stage is done, and the plan `greeting` is in the Check stage");
  expect(owner[0]).toContain("have it run `card --plan greeting`.");
  expect(stopping.stdout).toContain("`card --plan other stop` did not run");
  expect(stopping.stdout).toContain("Run `card --plan other stop` again.");
  expect(JSON.parse(readFileSync(other, "utf8")).state).toBe("Running");
});

/**
 * The first owner block of a printout, each card id in it put as its card's
 * headline and the fixture's repository as `<repo>`, since each fixture draws
 * ids and makes a repository of its own.
 */
function ownerBlockOf(stdout: string, { repo, deck }: Fixture): string {
  const headlines = new Map<string, string>();
  for (const dir of [deck.openDir, deck.closedDir]) {
    for (const name of readdirSync(dir).filter((each) => each.endsWith(".md"))) {
      headlines.set(name.slice(0, -3), parseCard(readFileSync(path.join(dir, name), "utf8")).headline);
    }
  }
  const block = ownerBlocks(stdout)[0];
  expect(block).toBeDefined();
  return block!.replace(/proj-[a-z]{6}/g, (id) => `<${headlines.get(id) ?? id}>`).replaceAll(repo, "<repo>");
}

// Each recorded verb that ends no authoring stage, with its fixture; for
// `amend`, its owner block is the Cards stage prompt's list of waiting cards.
const GOES_ON: [string, () => Promise<Fixture>][] = [
  ["card drop in Bounced", () => atLand("Bounced", "drop")],
  ["card amend in Bounced", () => atLand("Bounced", "amend")],
  ["card stop in Dead", () => atLand("Running", "stop")],
];

for (const [verb, setup] of GOES_ON) {
  test(`a recorded ${verb} that died is finished by bare card, which prints, ahead of anything else, the owner block an uninterrupted ${verb} prints`, async () => {
    const uninterrupted = await setup();
    const run = await card(uninterrupted.args, uninterrupted.repo);
    expect(run.code).toBe(0);
    const expected = ownerBlockOf(run.stdout, uninterrupted);

    const fixture = await setup();
    await diedRecorded(fixture);
    const bare = await card([], fixture.repo);
    expect(bare.code).toBe(0);
    expect(bare.stdout).toStartWith(`${relay}<for_owner>\n`);
    expect(ownerBlockOf(bare.stdout, fixture)).toBe(expected);
    expect(bare.stdout).not.toContain("did not run");
  });
}
