import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCard } from "../src/cardfile.ts";
import type { Cycle } from "../src/cycle.ts";
import { createDeck, type Deck } from "../src/deck.ts";
import { gitOrThrow } from "../src/git.ts";
import { ensureBranch, holdWorktree, land } from "../src/landing.ts";
import { closeCard, fileCard } from "../src/operations.ts";
import { startPlan, writeRecord } from "../src/plan.ts";
import { clearCardRoot, removeTempDirs, tempRepo } from "./helpers.ts";

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

type Fixture = { repo: string; deck: Deck; args: string[] };

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

/** The plan Bounced at its first card, the bounced implementer's work left uncommitted in the worktree. */
async function bounced(verb: string): Promise<Fixture> {
  const { repo, deck, plan, file } = await greeting();
  const first = await file("Add the greeting");
  const final = await file("Check the plan");
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  writeFileSync(path.join(tree, "hello.txt"), "half\n");
  const base = (await gitOrThrow(["rev-parse", "main"], repo)).trim();
  const session = { harness: "pi" as const, id: crypto.randomUUID(), dir: tree };
  const cycle: Cycle = { card: first, base, role: "implementer", step: "implement", sessions: { implementer: session.id }, rounds: 0, exchanges: 0 };
  const bounce = { role: "implementer" as const, session, cause: "usage limit reached" };
  await writeRecord(plan, { state: "Bounced", placeholder: false, cards: [first, final], final, harness: "pi", run: await deadRun(), cycle, bounce });
  return { repo, deck, args: [verb] };
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
  ["card drop in Bounced", () => bounced("drop"), true],
  ["card drop in Dead", () => afterRun("Running"), true],
  ["card drop in Stopped", () => afterRun("Stopped"), true],
  ["card amend in Bounced", () => bounced("amend"), true],
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
        const bare = await card([], looked.repo);
        expect(bare.code).toBe(0);
        if (planVerb) expect([before, after]).toContainEqual(await snapshot(looked));

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
  expect(refused.stderr).toContain("the plan `greeting` is held until its recorded `card drop` finishes");
  const declining = Bun.spawn([process.execPath, CARD, "decline", waitingId], { cwd: repo, stdin: new Blob(["Not needed.\n"]), stdout: "pipe", stderr: "pipe" });
  expect(await declining.exited).toBe(0);
  expect((await snapshot(fixture)).cards).toContain("closed declined Nothing says goodbye, 1 close notes, 0 promotions");
  const listing = await card([], repo);
  expect(listing.code).toBe(0);
  expect(listing.stdout).toContain("greeting  Stopped, held until its recorded `card drop` finishes\n");
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

test("a drop in Bounced whose worktree the owner removed by hand still settles the card in flight, closing done a card whose commit landed", async () => {
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

  const dropping = await card(["drop"], repo);
  expect(dropping.stderr).toBe("");
  expect(dropping.code).toBe(0);
  expect((await snapshot({ repo, deck, args: [] })).cards).toEqual([
    "closed declined Check the plan, 1 close notes, 0 promotions",
    "closed done Add the greeting, 1 close notes, 0 promotions",
  ]);
});

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
