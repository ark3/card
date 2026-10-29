import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Cycle } from "../src/cycle.ts";
import { createDeck, type Deck } from "../src/deck.ts";
import { git, gitOrThrow } from "../src/git.ts";
import { ensureBranch, holdWorktree, land } from "../src/landing.ts";
import { appendRecord, closeCard, fileCard } from "../src/operations.ts";
import { forOwner } from "../src/owner.ts";
import { listPlans, type PlanRecord, startPlan, writeRecord } from "../src/plan.ts";
import { calls, clearCardRoot, queue, type Reply, removeTempDirs, stand, tempRepo } from "./helpers.ts";

const CARD = path.join(import.meta.dir, "..", "src", "card.ts");
const OUTER_PATH = process.env.PATH;
// Each test waits on a run in another process, through several role sessions.
const SLOW = 30_000;

beforeEach(clearCardRoot);
afterEach(() => {
  process.env.PATH = OUTER_PATH;
});
afterAll(removeTempDirs);

/** Runs `card` under this bun, so the test's PATH need hold nothing but the stand-ins and git. */
async function card(args: string[], cwd: string) {
  const env = { ...process.env };
  delete env.CARD_ROOT;
  const proc = Bun.spawn([process.execPath, CARD, ...args], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

/** A repository with a `proj` deck and a plan in Check holding two cards, the second its final card. */
async function inCheck(startPoint = "main") {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  const finding = (headline: string) => ({ labels: [], blockedBy: [], headline, body: "Body.\n" });
  const first = await fileCard(deck, finding("Add the greeting"));
  const final = await fileCard(deck, finding("Check the plan"));
  const plan = await writeRecord(await startPlan(deck, "greeting"), {
    state: "Check",
    placeholder: false,
    cards: [first, final],
    final,
  });
  await Bun.write(plan.document, `---\nbranch: plan/greeting\nstart-point: ${startPoint}\n---\n\n# Greet\n\n${DOCUMENT_BODY}\n`);
  const base = (await gitOrThrow(["rev-parse", "main"], repo)).trim();
  return { repo, deck, plan, first, final, base };
}

// Text only the plan document's body holds, which only the reconciler reads.
const DOCUMENT_BODY = "The plan's intent, which only the reconciler reads.";
const proceed = (run?: string): Reply => ({ stdout: JSON.stringify({ outcome: "proceed", amended: "Nothing needed changing." }), run });
const done = (run?: string): Reply => ({ stdout: JSON.stringify({ outcome: "done", account: "Did the work." }), run });
const approved = (subject: string): Reply => ({
  stdout: JSON.stringify({ outcome: "approved", subject, close_note: "Landed it." }),
});

/** Shell that marks the role `name` started, then holds it until the test releases it, for ten seconds at most. */
function hold(control: string, name: string): string {
  const released = path.join(control, `${name}.released`);
  return `touch '${path.join(control, `${name}.started`)}'; i=0; while [ ! -e '${released}' ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i + 1)); done`;
}

function release(control: string, name: string): void {
  writeFileSync(path.join(control, `${name}.released`), "");
}

function record(dir: string): PlanRecord {
  return JSON.parse(readFileSync(path.join(dir, "state.json"), "utf8"));
}

async function until(what: string, check: () => boolean): Promise<void> {
  for (const deadline = Date.now() + SLOW - 5_000; !check(); await Bun.sleep(50)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
  }
}

/** What bare `card` reports for the owner in Bounced, with the card `inCheck` filed first. */
function bouncedReport(id: string, role: string, cause: string, resume: string, question?: string): string {
  const asks = question === undefined ? "" : `The question it asks:\n\n${question}\n\n`;
  return `The plan \`greeting\`'s run bounced at this card, where the ${role} stopped it:\n\n${id}  Add the greeting\n\nThe cause recorded for it:\n\n${cause}\n\n${asks}To resume the ${role}'s session at a terminal, run this from the plan's worktree:\n\n  ${resume}\n`;
}

/** What bare `card` reports for the owner in Ended, with `inCheck`'s final card closed under `note`. */
function endedReport(final: string, tree: string, note: string): string {
  return `The plan \`greeting\`'s run has ended, with every card closed.\n\nIts branch is \`plan/greeting\`, checked out in the worktree ${tree}.\n\nThe final card, ${final}  Check the plan, closed with this note, which is the guide to the plan's work:\n\n${note}`;
}

/** The subjects of the commits the plan's branch holds beyond `base`, oldest first. */
async function subjects(repo: string, base: string): Promise<string[]> {
  return (await gitOrThrow(["log", "--reverse", "--format=%s", `${base}..plan/greeting`], repo)).split("\n").filter(Boolean);
}

test(
  "card approve returns while the first role still runs, and the run lands one commit per card, in order, and ends",
  async () => {
    const { repo, deck, plan, first, final, base } = await inCheck();
    const control = stand(["pi"]);
    queue(
      control,
      [proceed()],
      [done(`${hold(control, "first")}; printf 'hello\\n' > hello.txt`)],
      [approved("Add the greeting")],
      [proceed()],
      [done()],
      [approved("Check the plan")],
    );

    const approving = await card(["approve"], repo);
    expect(approving.stderr).toBe("");
    expect(approving.code).toBe(0);
    const tree = path.join(repo, ".worktrees", "greeting");
    const log = path.join(plan.dir, "run.log");
    expect(approving.stdout).toBe(
      forOwner(`The plan \`greeting\` is running on pi, since pi is on PATH and claude is not, in ${tree}; its log is ${log}.\n`),
    );

    await until("the first role to start", () => existsSync(path.join(control, "first.started")));
    expect(record(plan.dir).state).toBe("Running");
    expect(record(plan.dir).harness).toBe("pi");
    expect(await subjects(repo, base)).toEqual([]);
    const running = `The plan \`greeting\`'s run is at this card, with the implementer:\n\n${first}  Add the greeting\n\n0 of the plan's 2 cards have closed.\n`;
    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(running), stderr: "" });

    release(control, "first");
    await until("the plan to end", () => record(plan.dir).state === "Ended");
    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan"]);
    expect(await gitOrThrow(["show", "plan/greeting~1:hello.txt"], repo)).toBe("hello\n");
    for (const id of [first, final]) expect(readFileSync(path.join(deck.closedDir, `${id}.md`), "utf8")).toContain("closed: done");
    expect(readFileSync(path.join(plan.dir, "run.log"), "utf8")).toContain("ended");
    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(endedReport(final, tree, "Landed it.\n")), stderr: "" });
  },
  SLOW,
);

test(
  "the state records the first card closed before the second card's reconciler launches, and the run's pid and boot id",
  async () => {
    const { repo, plan, first, final, base } = await inCheck();
    const control = stand(["pi"]);
    const snapshot = path.join(control, "at-second-launch.json");
    queue(
      control,
      [proceed()],
      [done()],
      [approved("Add the greeting")],
      [proceed(`cp '${path.join(plan.dir, "state.json")}' '${snapshot}'`)],
      [done()],
      [approved("Check the plan")],
    );

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    const [landed] = (await gitOrThrow(["rev-list", `${base}..plan/greeting~1`], repo)).split("\n");
    const at: PlanRecord = JSON.parse(readFileSync(snapshot, "utf8"));
    expect(at.landed).toEqual([{ card: first, commit: landed! }]);
    expect(at.cycle?.card).toBe(final);
    expect(at.cycle?.step).toBe("reconcile");
    expect(at.run?.pid).toBeNumber();
    expect(at.run?.boot).toBe(readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim());
    expect(record(plan.dir).run).toEqual(at.run);
  },
  SLOW,
);

test(
  "a role, and a child process the role starts, run in the run's process group",
  async () => {
    const { repo, plan } = await inCheck();
    const control = stand(["pi"]);
    // The stand-in is the role, and the shell running this is its child.
    const groups = `ps -o pgid= -p $PPID > '${path.join(control, "role")}'; ps -o pgid= -p $$ > '${path.join(control, "child")}'`;
    queue(control, [proceed()], [done(groups)], [approved("Add the greeting")], [proceed()], [done()], [approved("Check the plan")]);

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    const pid = record(plan.dir).run!.pid;
    expect(Number(readFileSync(path.join(control, "role"), "utf8"))).toBe(pid);
    expect(Number(readFileSync(path.join(control, "child"), "utf8"))).toBe(pid);
  },
  SLOW,
);

test(
  "a role that fails bounces the plan with the cause and the session, and lands nothing",
  async () => {
    const { repo, deck, plan, first, base } = await inCheck();
    const control = stand(["pi"]);
    queue(control, [proceed()], [{ stderr: "usage limit reached\n", exit: 1 }]);

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");

    const { bounce, cycle } = record(plan.dir);
    expect(bounce?.role).toBe("implementer");
    expect(bounce?.session).toEqual({ harness: "pi", id: cycle!.sessions.implementer!, dir: path.join(repo, ".worktrees", "greeting") });
    expect(bounce?.cause).toContain("usage limit reached");
    expect(await subjects(repo, base)).toEqual([]);
    expect(existsSync(path.join(deck.openDir, `${first}.md`))).toBe(true);
    const report = bouncedReport(first, "implementer", bounce!.cause, `cd ${bounce!.session.dir} && pi --session-id ${bounce!.session.id}`);
    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });
  },
  SLOW,
);

test(
  "a reconciler that stops bounces the plan with its cause and question in the report, and launches no implementer",
  async () => {
    const { repo, deck, plan, first, base } = await inCheck();
    const control = stand(["pi"]);
    const question = "The card calls `greet()`, which nothing in the worktree defines; which card should build it?";
    // The implementer's answers, which no session may take.
    queue(control, [{ stdout: JSON.stringify({ outcome: "stop", cause: "order", question }) }], [done()]);

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");

    const { bounce, cycle } = record(plan.dir);
    const cause = "the card depends on work no earlier card has landed, a problem of order for authoring to fix";
    expect(bounce).toEqual({ role: "reconciler", session: bounce!.session, cause, question });
    expect(bounce!.session.id).toBe(cycle!.sessions.reconciler!);
    expect(cycle).toEqual({ card: first, base, role: "reconciler", step: "reconcile", sessions: { reconciler: bounce!.session.id } });
    expect(existsSync(path.join(control, "queue", "2", "answers"))).toBe(true);
    expect(await subjects(repo, base)).toEqual([]);
    expect(existsSync(path.join(deck.openDir, `${first}.md`))).toBe(true);
    const report = bouncedReport(first, "reconciler", cause, `cd ${bounce!.session.dir} && pi --session-id ${bounce!.session.id}`, question);
    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });
    expect(readFileSync(path.join(plan.dir, "run.log"), "utf8")).toContain(`It asks the owner: ${question}`);
  },
  SLOW,
);

/** Asserts that nothing of a run started: the plan in Check, no branch, no worktree, no log, and no role called. */
async function nothingLaunched(repo: string, dir: string, control: string): Promise<void> {
  expect(record(dir).state).toBe("Check");
  expect((await git(["rev-parse", "--verify", "--quiet", "refs/heads/plan/greeting"], repo)).ok).toBe(false);
  expect(existsSync(path.join(repo, ".worktrees"))).toBe(false);
  expect(existsSync(path.join(dir, "run.log"))).toBe(false);
  expect(readdirSync(control)).toEqual([]);
}

test("card approve --harness naming a harness absent from PATH refuses before anything launches", async () => {
  const { repo, plan } = await inCheck();
  const control = stand(["pi"]);

  const result = await card(["approve", "--harness", "claude"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toBe("card: --harness names claude, but claude is not on PATH\n");
  await nothingLaunched(repo, plan.dir, control);
});

test("card approve with a start point git cannot resolve refuses before anything launches", async () => {
  const { repo, plan } = await inCheck("nosuch");
  const control = stand(["pi"]);

  const result = await card(["approve"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("`nosuch`");
  await nothingLaunched(repo, plan.dir, control);
});

const BOOT = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();

/** The pid of a process that has exited. */
async function deadPid(): Promise<number> {
  const proc = Bun.spawn([process.execPath, "-e", ""]);
  await proc.exited;
  return proc.pid;
}

async function stateOf(deck: Deck): Promise<string> {
  return (await listPlans(deck))[0]!.state;
}

test("a Running plan reads as Dead when its run's pid is gone, or its boot id is another boot's, and its state file still says Running", async () => {
  const { deck, plan } = await inCheck();
  await writeRecord(plan, { state: "Running", harness: "pi", run: { pid: process.pid, boot: BOOT } });
  expect(await stateOf(deck)).toBe("Running");

  await writeRecord(plan, { state: "Running", harness: "pi", run: { pid: await deadPid(), boot: BOOT } });
  expect(await stateOf(deck)).toBe("Dead");
  expect(record(plan.dir).state).toBe("Running");

  // The pid is live, but it names this process on another boot's count.
  await writeRecord(plan, { state: "Running", harness: "pi", run: { pid: process.pid, boot: "another boot" } });
  expect(await stateOf(deck)).toBe("Dead");
  expect(record(plan.dir).state).toBe("Running");
});

// Long enough that the commit's body refills it, so a close note taken from the
// commit rather than the record would differ.
const NOTE = "Adds hello.txt holding hello, and this line runs long enough that the commit message refills it at seventy-two columns.\n\nVerified by reading it back.";

/**
 * Where the run died while landing the first card, after the reviewer
 * approved it: no role runs from there to the state write, so each row is
 * built as the run leaves it rather than timed with a kill.
 */
const ROWS = [
  "after the commit, before its record",
  "after the record, before the close",
  "between the close's rename and its unlink",
  "after the close, before the state write",
  "after the state write, before the next card",
] as const;

for (const row of ROWS) {
  test(
    `a run killed ${row} is carried on by bare card, with one commit for the card and the card closed once`,
    async () => {
      const { repo, deck, plan, first, final, base } = await inCheck();
      await ensureBranch("plan/greeting", "main", repo);
      const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
      await appendRecord(deck, first, "Account", "Did the work.");
      writeFileSync(path.join(tree, "hello.txt"), "hello\n");
      const commit = await land("Add the greeting", NOTE, tree);
      const sessions = { implementer: crypto.randomUUID(), reviewer: crypto.randomUUID() };
      const cycle: Cycle = { card: first, base, role: "reviewer", step: "land", sessions, subject: "Add the greeting", note: NOTE };
      const recorded = row !== ROWS[0];
      if (recorded) cycle.commit = commit;
      const open = path.join(deck.openDir, `${first}.md`);
      const text = readFileSync(open, "utf8");
      if (row === ROWS[2] || row === ROWS[3] || row === ROWS[4]) await closeCard(deck, first, "done", NOTE);
      if (row === ROWS[2]) writeFileSync(open, text);
      const landed = row === ROWS[4] ? [{ card: first, commit }] : [];
      await writeRecord(plan, { state: "Running", harness: "pi", run: { pid: await deadPid(), boot: BOOT }, cycle, landed });

      const control = stand(["pi"]);
      const rerun = recorded ? [] : [[proceed()], [done("printf 'hello\\n' > hello.txt")], [approved("Add the greeting")]];
      queue(control, ...rerun, [proceed()], [done()], [approved("Check the plan")]);
      expect(await stateOf(deck)).toBe("Dead");

      const carrying = await card([], repo);
      expect(carrying.stderr).toBe("");
      expect(carrying.code).toBe(0);
      await until("the plan to end", () => record(plan.dir).state === "Ended");

      expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan"]);
      const ended = record(plan.dir).landed;
      expect(ended.map(({ card }) => card)).toEqual([first, final]);
      expect(existsSync(open)).toBe(false);
      const closed = readFileSync(path.join(deck.closedDir, `${first}.md`), "utf8");
      expect(closed.match(/^closed: /gm)).toHaveLength(1);
      expect(closed.match(/^## Close note$/gm)).toHaveLength(1);
      if (recorded) {
        expect(ended[0]!.commit).toBe(commit);
        expect(closed).toEndWith(`## Close note\n\n${NOTE}\n`);
      } else {
        // The commit no record named went with the card's work, and the rerun landed its own.
        expect(ended[0]!.commit).not.toBe(commit);
        expect((await git(["merge-base", "--is-ancestor", commit, "plan/greeting"], repo)).ok).toBe(false);
      }
    },
    SLOW,
  );
}

test(
  "a run killed mid-card reruns that card from a fresh reconciler on a clean worktree, and runs no closed card again",
  async () => {
    const { repo, deck, plan, first, final, base } = await inCheck();
    const control = stand(["pi"]);
    const seen = path.join(control, "seen");
    // The final card's implementer commits part of its work and leaves the rest uncommitted before the run dies.
    const partway = `printf 'half\\n' > half.txt; git add half.txt; git commit -q -m half; printf 'more\\n' > more.txt; ${hold(control, "final")}`;
    queue(
      control,
      [proceed()],
      [done("printf 'hello\\n' > hello.txt")],
      [approved("Add the greeting")],
      [proceed()],
      [done(partway)],
      [proceed(`{ git rev-parse HEAD; git status --porcelain; } > '${seen}'`)],
      [done()],
      [approved("Check the plan")],
    );

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the final card's implementer to start", () => existsSync(path.join(control, "final.started")));
    process.kill(-record(plan.dir).run!.pid, "SIGKILL");
    for (const deadline = Date.now() + 5_000; (await stateOf(deck)) !== "Dead"; await Bun.sleep(50)) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the run to read as Dead");
    }

    const carrying = await card([], repo);
    expect(carrying.stderr).toBe("");
    expect(carrying.code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    const landed = record(plan.dir).landed;
    expect(landed.map(({ card }) => card)).toEqual([first, final]);
    expect(readFileSync(seen, "utf8")).toBe(`${landed[0]!.commit}\n`);
    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan"]);
    expect(await gitOrThrow(["show", "--name-only", "--format=", "plan/greeting"], repo)).toBe("");
    const closed = readFileSync(path.join(deck.closedDir, `${first}.md`), "utf8");
    expect(closed.match(/^## Account$/gm)).toHaveLength(1);
    // The rerun's cycle is the last one recorded, and its reconciler was handed the in-flight card and the plan document.
    const reconciling = calls(control, record(plan.dir).cycle!.sessions.reconciler!)[0]!.stdin;
    expect(reconciling).toStartWith("# Reconciling one card\n");
    expect(reconciling).toContain(`<card>\n# Check the plan\n`);
    expect(reconciling).toContain(DOCUMENT_BODY);
  },
  SLOW,
);

/** Whether `pid` names a process still running: a zombie has ended, and only waits to be reaped. */
function running(pid: number): boolean {
  try {
    return !readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /s, "").startsWith("Z");
  } catch {
    return false;
  }
}

test(
  "bare card in Dead ends the role a run killed alone left running, and the role's child, before the next role launches",
  async () => {
    const { repo, deck, plan, first, final } = await inCheck();
    const control = stand(["pi"]);
    const pids = path.join(control, "pids");
    const after = path.join(control, "after");
    // The stand-in is the role; the sleep is a child of the shell it runs as the session's work.
    const sleeping = `sleep 30 & echo $PPID $! > '${pids}'; ${hold(control, "first")}`;
    const check = `for pid in $(cat '${pids}'); do if ps -o stat= -p $pid | grep -qv Z; then echo $pid; fi; done > '${after}'`;
    queue(
      control,
      [proceed()],
      [done(sleeping)],
      [proceed(check)],
      [done()],
      [approved("Add the greeting")],
      [proceed()],
      [done()],
      [approved("Check the plan")],
    );

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the first role to start", () => existsSync(path.join(control, "first.started")) && existsSync(pids));
    process.kill(record(plan.dir).run!.pid, "SIGKILL");
    for (const deadline = Date.now() + 5_000; (await stateOf(deck)) !== "Dead"; await Bun.sleep(50)) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the run to read as Dead");
    }
    const left = readFileSync(pids, "utf8").trim().split(" ").map(Number);
    expect(left.map(running)).toEqual([true, true]);

    expect((await card([], repo)).code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    expect(readFileSync(after, "utf8")).toBe("");
    expect(left.map(running)).toEqual([false, false]);
    expect(record(plan.dir).landed.map(({ card }) => card)).toEqual([first, final]);
  },
  SLOW,
);

test("bare card in Running reports the card in flight with its role, and the cards closed with their headlines", async () => {
  const { repo, deck, plan, first, final, base } = await inCheck();
  await closeCard(deck, first, "done", "Landed.");
  const cycle: Cycle = { card: final, base, role: "reviewer", step: "review", sessions: {} };
  await writeRecord(plan, { state: "Running", harness: "pi", run: { pid: process.pid, boot: BOOT }, cycle, landed: [{ card: first, commit: base }] });

  const report = `The plan \`greeting\`'s run is at this card, with the reviewer:\n\n${final}  Check the plan\n\n1 of the plan's 2 cards have closed:\n\n${first}  Add the greeting\n`;
  expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });
});

// Recorded text the owner reads, which the reports carry byte for byte: lines
// of markdown, trailing spaces and a heading below the record's own.
const RECORDED = "First line.  \n\n## Trying it\n\n```sh\nbun run greet --loud\n```\n\n- one\n  - **two**\n";

for (const [harness, resume] of [
  ["claude", (id: string) => `claude --resume ${id}`],
  ["pi", (id: string) => `pi --session-id ${id}`],
] as const) {
  test(`bare card in Bounced on ${harness} reports the role and its cause byte for byte, and the command that resumes its session from the worktree`, async () => {
    const { repo, plan, first, base } = await inCheck();
    const session = { harness, id: crypto.randomUUID(), dir: path.join(repo, ".worktrees", "greeting") };
    const cycle: Cycle = { card: first, base, role: "reviewer", step: "review", sessions: { reviewer: session.id } };
    await writeRecord(plan, { state: "Bounced", harness, cycle, bounce: { role: "reviewer", session, cause: RECORDED } });

    const result = await card([], repo);
    expect(result.stdout).toBe(forOwner(bouncedReport(first, "reviewer", RECORDED, `cd ${session.dir} && ${resume(session.id)}`)));
    expect(result.stdout).toContain(`  cd ${session.dir} && ${resume(session.id)}\n`);
  });
}

test("bare card in Ended reports the branch, the worktree and the final card's close note byte for byte", async () => {
  const { repo, deck, plan, first, final } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  await closeCard(deck, first, "done", "Landed.");
  await closeCard(deck, final, "done", RECORDED);
  await writeRecord(plan, { state: "Ended", harness: "pi" });

  const result = await card([], repo);
  expect(result).toEqual({ code: 0, stdout: forOwner(endedReport(final, tree, RECORDED)), stderr: "" });
  expect(result.stdout).toEndWith(`\n\n${RECORDED}</for_owner>\n`);
});
