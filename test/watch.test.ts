import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Cycle, EXCHANGES, REVISION_ROUNDS } from "../src/cycle.ts";
import { createDeck, type Deck } from "../src/deck.ts";
import { closeCard, fileCard } from "../src/operations.ts";
import { listPlans, marked, type Plan, type PlanRecord, RUN_MARK, runMark, startPlan, STATES, writeRecord } from "../src/plan.ts";
import { figures } from "../src/watch.ts";
import { clearCardRoot, removeTempDirs, stand, tempRepo } from "./helpers.ts";

const CARD = path.join(import.meta.dir, "..", "src", "card.ts");
const OUTER_PATH = process.env.PATH;
const BOOT = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
const CLEAR = "\x1b[H\x1b[J";
const MINUTE = 60_000;

beforeEach(() => {
  clearCardRoot();
  process.env.PATH = OUTER_PATH;
});
afterAll(removeTempDirs);

/** The pid of a process that has exited. */
async function deadPid(): Promise<number> {
  const proc = Bun.spawn([process.execPath, "-e", ""]);
  await proc.exited;
  return proc.pid;
}

/** Runs `card` to its exit, with nothing on stdin. */
async function card(args: string[], cwd: string) {
  const env = { ...process.env };
  delete env.CARD_ROOT;
  const proc = Bun.spawn([process.execPath, CARD, ...args], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

/**
 * Runs `card watch` until it has drawn `frames` frames, then kills it, and
 * returns the last frame; throws if it exits first or draws too few in time.
 */
async function watchFor(cwd: string, frames = 3): Promise<string> {
  const env: Record<string, string | undefined> = { ...process.env, CARD_WATCH_EVERY: "50" };
  delete env.CARD_ROOT;
  const proc = Bun.spawn([process.execPath, CARD, "watch"], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let out = "";
  const deadline = Date.now() + 10_000;
  try {
    while (out.split(CLEAR).length - 1 < frames + 1) {
      if (Date.now() > deadline) throw new Error(`timed out after ${out.split(CLEAR).length - 1} frames`);
      const { value, done } = await reader.read();
      if (done) throw new Error(`card watch exited: ${await new Response(proc.stderr).text()}`);
      out += decoder.decode(value);
    }
  } finally {
    proc.kill("SIGKILL");
    await proc.exited;
  }
  const drawn = out.split(CLEAR);
  return drawn[drawn.length - 2]!;
}

/** Every file and directory under `dir`, each with its bytes, a directory with none. */
function tree(dir: string): Map<string, string | null> {
  const found = new Map<string, string | null>();
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const at = path.join(entry.parentPath, entry.name);
    found.set(path.relative(dir, at), entry.isDirectory() ? null : readFileSync(at, "latin1"));
  }
  return found;
}

const finding = (headline: string) => ({ labels: [], blockedBy: [], headline, body: "Body.\n" });

/** A repository with a `proj` deck and a plan `greeting` of three cards, the last its final card, recorded as `changes` say. */
async function planned(changes: (ids: string[]) => Partial<PlanRecord> = () => ({})) {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  const ids = [await fileCard(deck, finding("Add the greeting")), await fileCard(deck, finding("Add the farewell")), await fileCard(deck, finding("Check the plan"))];
  const plan = await writeRecord(await startPlan(deck, "greeting"), { state: "Check", placeholder: false, cards: ids, final: ids[2]!, ...changes(ids) });
  return { repo, deck, plan, ids };
}

/** A cycle of the card `card` at the implementer, with `changes` over it. */
function cycleOf(card: string, changes: Partial<Cycle> = {}): Cycle {
  return { card, base: "0".repeat(40), role: "implementer", step: "implement", sessions: {}, rounds: 0, exchanges: 0, ...changes };
}

/** Asserts that `card watch` draws its frames and leaves the card directory as it found it, returning the last frame. */
async function unchanged(repo: string, deck: Deck): Promise<string> {
  const before = tree(deck.cardDir);
  const drawn = await watchFor(repo);
  expect(tree(deck.cardDir)).toEqual(before);
  return drawn;
}

test("card watch changes nothing under the card directory with no plan, and says so", async () => {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  expect(await unchanged(repo, deck)).toBe("No plan is in progress.\n");
});

test("card watch picks up a plan started while it watches", async () => {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  const env: Record<string, string | undefined> = { ...process.env, CARD_WATCH_EVERY: "50" };
  delete env.CARD_ROOT;
  const proc = Bun.spawn([process.execPath, CARD, "watch"], { cwd: repo, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let out = "";
  const until = async (text: string) => {
    while (!out.includes(text)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`card watch exited: ${await new Response(proc.stderr).text()}`);
      out += decoder.decode(value);
    }
  };
  try {
    await until("No plan is in progress.");
    await startPlan(deck, "greeting");
    await until("greeting  Document");
  } finally {
    proc.kill("SIGKILL");
    await proc.exited;
  }
});

test("card watch changes nothing under the card directory with a plan in Running, and shows its card", async () => {
  const { repo, deck, ids } = await planned((ids) => ({
    state: "Running",
    harness: "pi",
    run: { pid: process.pid, boot: BOOT },
    cycle: cycleOf(ids[0]!, { started: Date.now() }),
  }));
  const drawn = await unchanged(repo, deck);
  expect(drawn).toContain("greeting  Running\n");
  expect(drawn).toContain(`${ids[0]}  Add the greeting\n`);
  expect(drawn).toContain("  0/3 cards closed, ");
  expect(drawn).toContain("no estimate yet");
  expect(drawn).toContain(`implementer, revisions 0/${REVISION_ROUNDS}, exchanges 0/${EXCHANGES}, `);
});

test("card watch changes nothing under the card directory with a plan whose run has died, shows it Dead, and starts no run", async () => {
  const control = stand(["pi"]);
  const run = { pid: await deadPid(), boot: BOOT };
  const { repo, deck, plan, ids } = await planned((ids) => ({ state: "Running", harness: "pi", run, cycle: cycleOf(ids[0]!) }));
  const drawn = await unchanged(repo, deck);
  expect(drawn).toContain("greeting  Dead\n");
  expect(drawn).toContain("the run is dead; bare `card` carries it on");
  expect((await listPlans(deck))[0]!.run).toEqual(run);
  expect(await marked(`${RUN_MARK}=${runMark(run)}`)).toEqual([]);
  // The stand-in records every launch in its control directory.
  expect(readdirSync(control)).toEqual([]);
  expect(existsSync(path.join(plan.dir, "run.log"))).toBe(false);
});

test("card watch changes nothing under the card directory with a plan holding a pending verb", async () => {
  const run = { pid: await deadPid(), boot: BOOT };
  const { repo, deck } = await planned(() => ({ state: "Running", harness: "pi", run, pending: { verb: "stop" } }));
  expect(await unchanged(repo, deck)).toContain("greeting  Dead\n");
});

test("card watch changes nothing under the card directory with a plan removal's leftover in the plans directory", async () => {
  const { repo, deck } = await planned();
  const leftover = path.join(deck.cardDir, "plans", ".old.removing");
  mkdirSync(path.join(leftover, "cards"), { recursive: true });
  writeFileSync(path.join(leftover, "state.json"), "{}\n");
  expect(await unchanged(repo, deck)).toContain("greeting  Check\n");
  expect(existsSync(leftover)).toBe(true);
});

test("card watch refuses in a git repository with no deck, and creates no card directory", async () => {
  const repo = await tempRepo();
  expect(await card(["watch"], repo)).toEqual({ code: 1, stdout: "", stderr: "card: no deck here\n" });
  expect(existsSync(path.join(repo, ".git", "card"))).toBe(false);
});

test("card watch refuses --plan, since it shows every plan; bare card's lists of open commands never offer it", async () => {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  expect(await card(["--plan", "greeting", "watch"], repo)).toEqual({
    code: 1,
    stdout: "",
    stderr: "card: `card watch` shows every plan, so it takes no --plan\n",
  });
  // With more than one plan in progress, bare `card` prints every plan's open commands and acts on none.
  for (const state of STATES) {
    const plan = await startPlan(deck, state.toLowerCase());
    const run = state === "Running" ? { pid: process.pid, boot: BOOT } : { pid: await deadPid(), boot: BOOT };
    await writeRecord(plan, { state: state === "Dead" ? "Running" : state, harness: "pi", run });
  }
  const listed = await card([], repo);
  expect(listed.stderr).toBe("");
  for (const state of STATES) expect(listed.stdout).toContain(`  card --plan ${state.toLowerCase()} drop\n`);
  expect(listed.stdout).not.toContain("watch");
});

/** `plan` as `listPlans` would read it, its state set outright. */
function as(plan: Plan, changes: Partial<PlanRecord>): Plan {
  return { ...plan, ...changes };
}

test("the figures count the plan's cards closed done out of its cards in every state, as members counts them", async () => {
  const { deck, plan, ids } = await planned();
  const extra = await fileCard(deck, finding("A card the run will not take"));
  await closeCard(deck, ids[0]!, "done", "Landed.\n");
  await closeCard(deck, extra, "moot", "Moot.\n");
  for (const state of STATES) {
    const shown = await figures(deck, as(plan, { state, cards: [...plan.cards, extra] }), Date.now());
    expect({ state: shown.state, closed: shown.closed, cards: shown.cards }).toEqual({ state, closed: 1, cards: 3 });
  }
});

test("the figures give no estimate with no landed card's time, and otherwise the landed mean times the cards not yet closed", async () => {
  const { deck, plan, ids } = await planned();
  expect((await figures(deck, plan, Date.now())).estimate).toBeNull();

  await closeCard(deck, ids[0]!, "done", "Landed.\n");
  // A card landed by a run that predates the times gives none.
  const untimed = as(plan, { state: "Running", landed: [{ card: ids[0]!, commit: "a" }] });
  expect((await figures(deck, untimed, Date.now())).estimate).toBeNull();

  await closeCard(deck, ids[1]!, "done", "Landed.\n");
  const landed = [
    { card: ids[0]!, commit: "a", active: 2 * MINUTE },
    { card: ids[1]!, commit: "b", active: 4 * MINUTE },
  ];
  const shown = await figures(deck, as(plan, { state: "Running", landed }), Date.now());
  // The mean is three minutes, and the final card is the one card not yet closed.
  expect(shown.estimate).toBe(3 * MINUTE);
  expect(shown.elapsed).toBe(6 * MINUTE);
});

test("the figures flag the current card past twice the landed mean, at the last revision round and at the last exchange, and not short of them", async () => {
  const { deck, plan, ids } = await planned();
  await closeCard(deck, ids[0]!, "done", "Landed.\n");
  const landed = [{ card: ids[0]!, commit: "a", active: 2 * MINUTE }];
  const flags = async (changes: Partial<Cycle>) =>
    (await figures(deck, as(plan, { state: "Running", landed, cycle: cycleOf(ids[1]!, changes) }), Date.now())).current!.flags;

  expect(await flags({ active: { implementer: 4 * MINUTE + 1 } })).toEqual(["long"]);
  expect(await flags({ active: { implementer: 4 * MINUTE } })).toEqual([]);
  expect(await flags({ rounds: REVISION_ROUNDS })).toEqual(["rounds"]);
  expect(await flags({ rounds: REVISION_ROUNDS - 1 })).toEqual([]);
  expect(await flags({ exchanges: EXCHANGES })).toEqual(["exchanges"]);
  expect(await flags({ exchanges: EXCHANGES - 1 })).toEqual([]);
  expect(await flags({})).toEqual([]);
});

test("the figures add an in-flight start in Running only, and nothing for a cycle whose commit is set", async () => {
  const { deck, plan, ids } = await planned();
  await closeCard(deck, ids[0]!, "done", "Landed.\n");
  const now = Date.now();
  const landed = [{ card: ids[0]!, commit: "a", active: 2 * MINUTE }];
  const cycle = cycleOf(ids[1]!, { active: { reconciler: MINUTE }, started: now - 5 * MINUTE });
  const at = async (changes: Partial<PlanRecord>) => figures(deck, as(plan, { landed, cycle, ...changes }), now);

  const running = await at({ state: "Running" });
  expect(running.current!.active).toBe(6 * MINUTE);
  expect(running.elapsed).toBe(8 * MINUTE);
  for (const state of ["Dead", "Stopped"] as const) {
    const shown = await at({ state });
    expect(shown.current!.active).toBe(MINUTE);
    expect(shown.elapsed).toBe(3 * MINUTE);
  }
  const landing = await at({ state: "Running", cycle: { ...cycle, commit: "b" } });
  expect(landing.current).toBeNull();
  expect(landing.elapsed).toBe(2 * MINUTE);
});
