import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import documentStage from "../payload/document.md" with { type: "text" };
import settle from "../payload/settle.md" with { type: "text" };
import { answerInstruction } from "../src/answer.ts";
import { startRun } from "../src/check.ts";
import { type Cycle, RECONCILER, type Role, type Step } from "../src/cycle.ts";
import { createDeck, type Deck } from "../src/deck.ts";
import { branchExists, git, gitOrThrow, listWorktrees } from "../src/git.ts";
import { ensureBranch, holdWorktree, land } from "../src/landing.ts";
import { appendRecord, closeCard, fileCard, reopenCard } from "../src/operations.ts";
import { forOwner } from "../src/owner.ts";
import { fill, wrapPayload } from "../src/payload.ts";
import { listPlans, type Plan, type PlanRecord, startPlan, type State, waitingCards, writeRecord } from "../src/plan.ts";
import { calls, clearCardRoot, queue, type Reply, removeTempDirs, script, stand, tempDir, tempRepo } from "./helpers.ts";

const CARD = path.join(import.meta.dir, "..", "src", "card.ts");
const OUTER_PATH = process.env.PATH;
// Each test waits on a run in another process, through several role sessions.
const SLOW = 30_000;

beforeEach(clearCardRoot);
afterEach(() => {
  process.env.PATH = OUTER_PATH;
});
afterAll(removeTempDirs);

/** Runs `card` under this bun, with `input` on its stdin, so the test's PATH need hold nothing but the stand-ins and git. */
async function card(args: string[], cwd: string, input?: string) {
  const env = { ...process.env };
  delete env.CARD_ROOT;
  const stdin = input === undefined ? "ignore" : new Blob([input]);
  const proc = Bun.spawn([process.execPath, CARD, ...args], { cwd, env, stdin, stdout: "pipe", stderr: "pipe" });
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
const proceed = (run?: string): Reply => ({ answer: JSON.stringify({ outcome: "proceed", amended: "Nothing needed changing." }), run });
const done = (run?: string): Reply => ({ answer: JSON.stringify({ outcome: "done", account: "Did the work." }), run });
const approved = (subject: string): Reply => ({
  answer: JSON.stringify({ outcome: "approved", subject, close_note: "Landed it." }),
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

/** The close of a report in `state`: the commands open there under `command`, bare `card` first, in the table's order. */
function openList(state: State, command = "card"): string {
  const lines = [command, ...OPEN[state].map((verb) => `${command} ${verb}`)].map((line) => `  ${line}\n`).join("");
  return `\nThe commands open while the plan is in ${state}:\n\n${lines}`;
}

/** What bare `card` reports for the owner in Bounced, with the card `inCheck` filed first. */
function bouncedReport(id: string, role: string, cause: string, resume: string, question?: string, feedback?: string): string {
  const asks = question === undefined ? "" : `The question it asks:\n\n${question}\n\n`;
  const revision = feedback === undefined ? "" : `The revision it last asked for:\n\n${feedback}\n\n`;
  return `The plan \`greeting\`'s run bounced at this card, where the ${role} stopped it:\n\n${id}  Add the greeting\n\nThe cause recorded for it:\n\n${cause}\n\n${asks}${revision}To resume the ${role}'s session at a terminal, run this from the plan's worktree:\n\n  ${resume}\n${openList("Bounced")}`;
}

const NO_FINDINGS = "The run filed no findings.\n";

/**
 * What bare `card` prints in Ended for `inCheck`'s plan, its final card closed
 * under `note` and the run's findings listed as `findings`: the report for the
 * owner, then the settling prompt, its commands starting `command`.
 */
function ended(plan: Plan, final: string, tree: string, note: string, findings = NO_FINDINGS, command = "card"): string {
  const report =
    `The plan \`greeting\`'s run has ended, with every card closed.\n\nIts branch is \`plan/greeting\`, checked out in the worktree ${tree}.\n\n` +
    `${findings}\nOnce every finding is settled, this ends the plan, removing the worktree and keeping the branch:\n\n  ${command} finish\n\n` +
    `The final card, ${final}  Check the plan, closed with this note, which is the guide to the plan's work:\n\n${note}`;
  return forOwner(report) + wrapPayload(command, fill(settle, { CARD: command, PLAN_DOCUMENT: plan.document }));
}

/** A finding as bare `card` lists it in Ended: unsettled, with the commands that settle it, or settled as `settled` says. */
function listed(id: string, headline: string, settled?: string): string {
  if (settled !== undefined) return `${id}  ${headline}\n  filed by the reviewer, ${settled}\n`;
  return `${id}  ${headline}\n  filed by the reviewer\n  card join ${id}\n  card later ${id}\n  card decline ${id}\n  card promote ${id}\n`;
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
    const running = `The plan \`greeting\`'s run is at this card, with the implementer:\n\n${first}  Add the greeting\n\n0 of the plan's 2 cards have closed.\n${openList("Running")}`;
    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(running), stderr: "" });

    release(control, "first");
    await until("the plan to end", () => record(plan.dir).state === "Ended");
    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan"]);
    expect(await gitOrThrow(["show", "plan/greeting~1:hello.txt"], repo)).toBe("hello\n");
    for (const id of [first, final]) expect(readFileSync(path.join(deck.closedDir, `${id}.md`), "utf8")).toContain("closed: done");
    expect(readFileSync(path.join(plan.dir, "run.log"), "utf8")).toContain("ended");
    expect(await card([], repo)).toEqual({ code: 0, stdout: ended(plan, final, tree, "Landed it.\n"), stderr: "" });
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
  "a reviewer approving with two findings leaves two waiting cards that no run picks up, and the run goes on to the next card and ends",
  async () => {
    const { repo, deck, plan, first, final, base } = await inCheck();
    const control = stand(["pi"]);
    const findings = [
      { headline: "The README still names greet.sh", body: "README.md shows `greet.sh`." },
      { headline: "Nothing says how the code is licensed", body: "The tree holds no license file." },
    ];
    const approvedWith = { answer: JSON.stringify({ outcome: "approved", subject: "Add the greeting", close_note: "Landed it.", findings }) };
    queue(control, [proceed()], [done()], [approvedWith], [proceed()], [done()], [approved("Check the plan")]);

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan"]);
    const state = record(plan.dir);
    expect(state.cards).toEqual([first, final]);
    expect(state.findings.map(({ role, card }) => ({ role, card }))).toEqual([
      { role: "reviewer", card: first },
      { role: "reviewer", card: first },
    ]);
    const filed = state.findings.map(({ id }) => readFileSync(path.join(deck.openDir, `${id}.md`), "utf8"));
    expect(filed).toEqual(
      findings.map(({ headline, body }) => `# ${headline}\n\nFiled by the reviewer of ${first}, in the plan greeting.\n\n${body}\n`),
    );
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
    const report = bouncedReport(first, "implementer", bounce!.cause, `cd '${bounce!.session.dir}' && pi --session-id ${bounce!.session.id}`);
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
    queue(control, [{ answer: JSON.stringify({ outcome: "stop", cause: "order", question }) }], [done()]);

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");

    const { bounce, cycle } = record(plan.dir);
    const cause = "the card depends on work no earlier card has landed, a problem of order for authoring to fix";
    expect(bounce).toEqual({ role: "reconciler", session: bounce!.session, cause, question });
    expect(bounce!.session.id).toBe(cycle!.sessions.reconciler!);
    expect(cycle).toEqual({ card: first, base, role: "reconciler", step: "reconcile", sessions: { reconciler: bounce!.session.id }, rounds: 0, exchanges: 0 });
    expect(existsSync(path.join(control, "queue", "2", "answers"))).toBe(true);
    expect(await subjects(repo, base)).toEqual([]);
    expect(existsSync(path.join(deck.openDir, `${first}.md`))).toBe(true);
    const report = bouncedReport(first, "reconciler", cause, `cd '${bounce!.session.dir}' && pi --session-id ${bounce!.session.id}`, question);
    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });
    expect(readFileSync(path.join(plan.dir, "run.log"), "utf8")).toContain(`It asks the owner: ${question}`);
  },
  SLOW,
);

test(
  "a reviewer asking for a revision past the cap bounces the plan with its last feedback in the report and the reviewer as the session to resume",
  async () => {
    const { repo, deck, plan, first, base } = await inCheck();
    const control = stand(["pi"]);
    const revision = (round: number): Reply => ({ answer: JSON.stringify({ outcome: "revision", feedback: `Round ${round}: not yet.` }) });
    queue(control, [proceed()], [done(), done(), done(), done()], [revision(1)], [revision(2)], [revision(3)], [revision(4)]);

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");

    const { bounce, cycle } = record(plan.dir);
    const cause = "the reviewer still asked for a revision after 3 revision rounds, the most a card gets";
    expect(bounce).toEqual({ role: "reviewer", session: bounce!.session, cause, feedback: "Round 4: not yet." });
    expect(bounce!.session.id).toBe(cycle!.sessions.reviewer!);
    expect(calls(control, cycle!.sessions.implementer!)).toHaveLength(4);
    expect(await subjects(repo, base)).toEqual([]);
    expect(existsSync(path.join(deck.openDir, `${first}.md`))).toBe(true);
    const resume = `cd '${bounce!.session.dir}' && pi --session-id ${bounce!.session.id}`;
    const report = bouncedReport(first, "reviewer", cause, resume, undefined, "Round 4: not yet.");
    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });
  },
  SLOW,
);

test(
  "a close note still citing a card id after its returns bounces the plan with the reviewer as the session to resume, and commits nothing",
  async () => {
    const { repo, deck, plan, first, base } = await inCheck();
    const control = stand(["pi"]);
    const citing: Reply = { answer: JSON.stringify({ outcome: "approved", subject: "Add the greeting", close_note: "Follows proj-dagobe." }) };
    queue(control, [proceed()], [done()], [citing, citing, citing]);

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");

    const { bounce, cycle } = record(plan.dir);
    expect(bounce?.role).toBe("reviewer");
    expect(bounce!.session.id).toBe(cycle!.sessions.reviewer!);
    expect(bounce?.cause).toStartWith("the subject and close note still cited a card id after 2 returns: answer.close_note cites proj-dagobe");
    expect(cycle!.step).toBe("review");
    expect(calls(control, cycle!.sessions.reviewer!)).toHaveLength(3);
    expect(await subjects(repo, base)).toEqual([]);
    expect(existsSync(path.join(deck.openDir, `${first}.md`))).toBe(true);
  },
  SLOW,
);

test(
  "an implementer and a reconciler that have not agreed after the cap bounce the plan with the reconciler as the session to resume",
  async () => {
    const { repo, deck, plan, first, base } = await inCheck();
    const control = stand(["pi"]);
    const blocked: Reply = { answer: JSON.stringify({ outcome: "blocked", finding: "The card names no file to write." }) };
    const reply: Reply = { answer: JSON.stringify({ outcome: "reply", reply: "It names hello.txt." }) };
    const question = "We still disagree on whether the card names a file; does it?";
    const disagreed: Reply = { answer: JSON.stringify({ outcome: "stop", cause: "disagreement", question }) };
    queue(control, [proceed(), reply, reply, reply, disagreed], [blocked, blocked, blocked, blocked]);

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");

    const { bounce, cycle } = record(plan.dir);
    const cause = "the reconciler and the implementer had not agreed after 3 exchanges, the most a card gets";
    expect(bounce).toEqual({ role: "reconciler", session: bounce!.session, cause, question });
    expect(bounce!.session.id).toBe(cycle!.sessions.reconciler!);
    expect(cycle!.step).toBe("converse");
    expect(calls(control, cycle!.sessions.reconciler!)).toHaveLength(5);
    expect(calls(control, cycle!.sessions.implementer!)).toHaveLength(4);
    expect(await subjects(repo, base)).toEqual([]);
    expect(existsSync(path.join(deck.openDir, `${first}.md`))).toBe(true);
    const report = bouncedReport(first, "reconciler", cause, `cd '${bounce!.session.dir}' && pi --session-id ${bounce!.session.id}`, question);
    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });
  },
  SLOW,
);

test(
  "a final card's implementer finding a gap, which its reconciler stops on, bounces the plan with the gap in the report and the card's record, and the final card stays open",
  async () => {
    const { repo, deck, plan, final, base } = await inCheck();
    const control = stand(["pi"]);
    const gap = "The plan document's criterion that `hello.txt` holds `hello` does not hold: the branch holds no `hello.txt`.";
    const blocked: Reply = { answer: JSON.stringify({ outcome: "blocked", finding: gap }) };
    const question = "No card of the plan writes `hello.txt`; should authoring add one ahead of the final card?";
    const stop: Reply = { answer: JSON.stringify({ outcome: "stop", cause: "gap", question }) };
    queue(control, [proceed()], [done()], [approved("Add the greeting")], [proceed(), stop], [blocked]);

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");

    const { bounce, cycle } = record(plan.dir);
    const cause =
      "the final card found an acceptance criterion of the plan document that does not hold on the plan's branch, a gap in the plan for authoring to close with cards ahead of the final card";
    expect(bounce).toEqual({ role: "reconciler", session: bounce!.session, cause, question, gap });
    expect(cycle!.card).toBe(final);
    expect(bounce!.session.id).toBe(cycle!.sessions.reconciler!);
    expect(await subjects(repo, base)).toEqual(["Add the greeting"]);
    expect(existsSync(path.join(deck.openDir, `${final}.md`))).toBe(true);
    expect(readFileSync(path.join(deck.openDir, `${final}.md`), "utf8")).toBe(`# Check the plan\n\nBody.\n\n## Gap\n\n${gap}\n`);
    const resume = `cd '${bounce!.session.dir}' && pi --session-id ${bounce!.session.id}`;
    const report =
      `The plan \`greeting\`'s run bounced at this card, where the reconciler stopped it:\n\n${final}  Check the plan\n\n` +
      `The cause recorded for it:\n\n${cause}\n\nThe gap the final card found:\n\n${gap}\n\nThe question it asks:\n\n${question}\n\n` +
      `To resume the reconciler's session at a terminal, run this from the plan's worktree:\n\n  ${resume}\n${openList("Bounced")}`;
    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });
  },
  SLOW,
);

test(
  "a final card stopped by a gap, rerun after card amend, keeps its gap, which the rerun's reconciler reads, and drops the stopped cycle's account and review feedback",
  async () => {
    const { repo, deck, plan, final, base } = await inCheck();
    const control = stand(["pi"]);
    const gap = "The plan document's criterion that `hello.txt` holds `hello` does not hold: the branch holds no `hello.txt`.";
    const account: Reply = { answer: JSON.stringify({ outcome: "done", account: "The stopped cycle's account." }) };
    const revision: Reply = { answer: JSON.stringify({ outcome: "revision", feedback: "The stopped cycle's feedback." }) };
    const blocked: Reply = { answer: JSON.stringify({ outcome: "blocked", finding: gap }) };
    const stop: Reply = { answer: JSON.stringify({ outcome: "stop", cause: "gap", question: "Should authoring add a card that writes `hello.txt`?" }) };
    queue(control, [proceed()], [done()], [approved("Add the greeting")], [proceed(), stop], [account, blocked], [revision]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");
    const stopped = readFileSync(path.join(deck.openDir, `${final}.md`), "utf8");
    expect(stopped).toContain("The stopped cycle's account.");
    expect(stopped).toContain("The stopped cycle's feedback.");

    expect((await card(["amend"], repo)).code).toBe(0);
    await Bun.write(path.join(plan.cardsDir, "01-write-hello.md"), "# Write hello\n\nBody.\n");
    const taking = await card(["done"], repo);
    expect(taking.stderr).toBe("");
    queue(control, [proceed()], [done()], [approved("Write hello")], [proceed()], [done()], [approved("Check the plan")]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the run to end or bounce", () => record(plan.dir).state !== "Running");
    expect(record(plan.dir).state).toBe("Ended");

    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Write hello", "Check the plan"]);
    const kept = `# Check the plan\n\nBody.\n\n## Gap\n\n${gap}\n`;
    const reconciling = calls(control, record(plan.dir).cycle!.sessions.reconciler!)[0]!.stdin;
    expect(reconciling).toContain(`<card>\n${kept}</card>`);
    expect(readFileSync(path.join(deck.closedDir, `${final}.md`), "utf8")).toBe(
      `---\nclosed: done\n---\n\n${kept}\n## Account\n\nDid the work.\n\n## Close note\n\nLanded it.\n`,
    );
  },
  SLOW,
);

test(
  "the final card's reviewer, handed the plan document beside the card, approves with the owner's guide as its close note, which bare card prints at Ended",
  async () => {
    const { repo, plan, final } = await inCheck();
    const control = stand(["pi"]);
    const guide = "The greeting plan is done: run `cat hello.txt` in the worktree and see hello.\n\nOnly the owner can judge whether hello is the greeting wanted.";
    const guiding: Reply = { answer: JSON.stringify({ outcome: "approved", subject: "Check the plan", close_note: guide }) };
    queue(control, [proceed()], [done()], [approved("Add the greeting")], [proceed()], [done()], [guiding]);

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    const { cycle } = record(plan.dir);
    expect(cycle!.card).toBe(final);
    const reviewer = calls(control, cycle!.sessions.reviewer!)[0]!.stdin;
    expect(reviewer).toStartWith("# Reviewing the final card\n");
    expect(reviewer).toContain(`\n${DOCUMENT_BODY}\n</plan_document>\n`);
    const tree = path.join(repo, ".worktrees", "greeting");
    expect(await card([], repo)).toEqual({ code: 0, stdout: ended(plan, final, tree, `${guide}\n`), stderr: "" });
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

for (const state of ["Running", "Dead"] as const) {
  test(`card approve refuses while another plan's run is ${state}, naming that plan, before anything launches`, async () => {
    const { repo, deck, plan } = await inCheck();
    const other = await startPlan(deck, "other");
    await writeRecord(other, { state: "Running", harness: "pi", run: { pid: state === "Running" ? process.pid : await deadPid(), boot: BOOT } });
    const control = stand(["pi"]);

    const result = await card(["--plan", "greeting", "approve"], repo);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toBe(
      `card: \`card --plan greeting approve\` is refused while another plan's run is Running or Dead, and the plan \`other\`'s run is ${state}\n`,
    );
    await nothingLaunched(repo, plan.dir, control);
    expect((await listPlans(deck)).map(({ slug, state }) => `${slug} ${state}`)).toEqual(["greeting Check", `other ${state}`]);
  });
}

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
      const cycle: Cycle = { card: first, base, role: "reviewer", step: "land", sessions, rounds: 0, exchanges: 0, subject: "Add the greeting", note: NOTE };
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

test(
  "a run killed after a card's account is appended reruns the card, carried on by bare card, from the card as it stood before the killed cycle, so neither the rerun's reconciler nor its implementer reads that account, and the closed card holds one",
  async () => {
    const { repo, deck, plan, first } = await inCheck();
    const control = stand(["pi"]);
    const discarded = "The killed cycle's account, of work the rerun's worktree does not hold.";
    queue(
      control,
      [proceed()],
      [{ answer: JSON.stringify({ outcome: "done", account: discarded }), run: "printf 'hello\\n' > hello.txt" }],
      [{ run: hold(control, "reviewer") }],
      [proceed()],
      [done("printf 'hello\\n' > hello.txt")],
      [approved("Add the greeting")],
      [proceed()],
      [done()],
      [approved("Check the plan")],
    );

    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the first card's reviewer to start", () => existsSync(path.join(control, "reviewer.started")));
    expect(readFileSync(path.join(deck.openDir, `${first}.md`), "utf8")).toContain(discarded);
    process.kill(-record(plan.dir).run!.pid, "SIGKILL");
    for (const deadline = Date.now() + 5_000; (await stateOf(deck)) !== "Dead"; await Bun.sleep(50)) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the run to read as Dead");
    }

    const carrying = await card([], repo);
    expect(carrying.stderr).toBe("");
    expect(carrying.code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    const reconcilers = reconcilersOf(control, "Add the greeting");
    const implementers = readdirSync(control)
      .filter((id) => existsSync(path.join(control, id, "calls")))
      .map((id) => calls(control, id))
      .filter(([launched]) => launched!.stdin.startsWith("# Implementing one card\n") && launched!.stdin.includes("\n# Add the greeting\n"));
    expect([reconcilers.length, implementers.length]).toEqual([2, 2]);
    for (const [launched] of [...reconcilers, ...implementers]) expect(launched!.stdin).not.toContain(discarded);
    const closed = readFileSync(path.join(deck.closedDir, `${first}.md`), "utf8");
    expect(closed.match(/^## Account$/gm)).toHaveLength(1);
    expect(closed).not.toContain(discarded);
  },
  SLOW,
);

/**
 * Shell, as a role's work, that starts a process in a session of its own, as
 * both harnesses start every command a role runs, from a subshell that exits
 * at once, so the process is orphaned before anything ends the run. It writes
 * into the worktree for thirty seconds; once it has started, `$escaped` holds
 * its pid.
 */
function escaping(control: string): string {
  const file = path.join(control, "escaped");
  const writer = 'echo $$ > "$0.writing"; mv "$0.writing" "$0"; i=0; while [ $i -lt 600 ]; do date > stray.txt; sleep 0.05; i=$((i + 1)); done';
  return `(setsid sh -c '${writer}' '${file}' &); while [ ! -e '${file}' ]; do sleep 0.01; done; escaped=$(cat '${file}'); `;
}

/** Whether `pid` names a process still running: a zombie has ended, and only waits to be reaped. */
function running(pid: number): boolean {
  try {
    return !readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /s, "").startsWith("Z");
  } catch {
    return false;
  }
}

test(
  "bare card in Dead ends the role a run killed alone left running, the role's child, and a process the role started in a session of its own, before the next role launches",
  async () => {
    const { repo, deck, plan, first, final } = await inCheck();
    const control = stand(["pi"]);
    const pids = path.join(control, "pids");
    const after = path.join(control, "after");
    // The stand-in is the role; the sleep is a child of the shell it runs as the session's work.
    const sleeping = `${escaping(control)}sleep 30 & echo $PPID $! $escaped > '${pids}'; ${hold(control, "first")}`;
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
    expect(left.map(running)).toEqual([true, true, true]);

    expect((await card([], repo)).code).toBe(0);
    expect(left.map(running)).toEqual([false, false, false]);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    expect(readFileSync(after, "utf8")).toBe("");
    expect(record(plan.dir).landed.map(({ card }) => card)).toEqual([first, final]);
  },
  SLOW,
);

test(
  "card amend after a bounce returns with no process left running that a role whose session ended normally started in a session of its own, and the worktree clean",
  async () => {
    const { repo, plan } = await inCheck();
    const control = stand(["pi"]);
    queue(control, [proceed()], [done(escaping(control))], [{ stderr: "usage limit reached", exit: 1 }]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");
    const escaped = Number(readFileSync(path.join(control, "escaped"), "utf8"));

    expect((await card(["amend"], repo)).code).toBe(0);
    expect(running(escaped)).toBe(false);
    // Long enough for a writer still running to rewrite the file it writes.
    await Bun.sleep(200);
    const tree = path.join(repo, ".worktrees", "greeting");
    expect(await gitOrThrow(["status", "--porcelain", "--untracked-files=all"], tree)).toBe("");
  },
  SLOW,
);

/**
 * Shell, as a role's work, that starts two processes in sessions of their
 * own, as `escaping` does, and waits until both have written their pids, to
 * `<control>/trapping` and `<control>/ignoring`: the first, sent SIGTERM,
 * writes `<control>/cleaned` and exits, as a server shutting down cleanly
 * would, and the second ignores SIGTERM. Each runs thirty seconds at most.
 */
function outlasting(control: string): string {
  const loop = 'echo $$ > "$0.writing"; mv "$0.writing" "$0"; i=0; while [ $i -lt 600 ]; do sleep 0.05; i=$((i + 1)); done';
  const [trapping, ignoring, cleaned] = ["trapping", "ignoring", "cleaned"].map((name) => path.join(control, name));
  return `(setsid sh -c 'trap "touch ${cleaned}; exit 0" TERM; ${loop}' '${trapping}' &); (setsid sh -c 'trap "" TERM; ${loop}' '${ignoring}' &); while [ ! -e '${trapping}' ] || [ ! -e '${ignoring}' ]; do sleep 0.01; done; `;
}

/** The pids `outlasting` wrote. */
function outlasted(control: string): number[] {
  return ["trapping", "ignoring"].map((name) => Number(readFileSync(path.join(control, name), "utf8")));
}

test(
  "card amend after a bounce returns with what a role left running sent SIGTERM when its turn ended, so a process that traps it cleaned up, and SIGKILL for one that ignores it",
  async () => {
    const { repo, plan } = await inCheck();
    const control = stand(["pi"]);
    queue(control, [proceed()], [done(outlasting(control))], [{ stderr: "usage limit reached", exit: 1 }]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");

    expect((await card(["amend"], repo)).code).toBe(0);
    expect(existsSync(path.join(control, "cleaned"))).toBe(true);
    expect(outlasted(control).map(running)).toEqual([false, false]);
  },
  SLOW,
);

test(
  "card stop in Running returns with what the role left running sent SIGTERM, so a process that traps it cleaned up, and SIGKILL for one that ignores it",
  async () => {
    const { repo, plan } = await inCheck();
    const control = stand(["pi"]);
    queue(control, [proceed()], [done(`${outlasting(control)}${hold(control, "first")}`)]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the first role to start", () => existsSync(path.join(control, "first.started")));
    expect(outlasted(control).map(running)).toEqual([true, true]);

    expect((await card(["stop"], repo)).code).toBe(0);
    expect(existsSync(path.join(control, "cleaned"))).toBe(true);
    expect(outlasted(control).map(running)).toEqual([false, false]);
    expect(record(plan.dir).state).toBe("Stopped");
  },
  SLOW,
);

test(
  "card finish after the run ends returns with no process left running that the last role, whose session ended normally, started in a session of its own, and the worktree removed",
  async () => {
    const { repo, plan } = await inCheck();
    const control = stand(["pi"]);
    const writing = { ...approved("Check the plan"), run: escaping(control) };
    queue(control, [proceed()], [done()], [approved("Add the greeting")], [proceed()], [done()], [writing]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");
    const escaped = Number(readFileSync(path.join(control, "escaped"), "utf8"));
    // Long enough for a writer still running to rewrite the file it writes.
    await Bun.sleep(200);

    const finishing = await card(["finish"], repo);
    expect(finishing.stderr).toBe("");
    expect(finishing.code).toBe(0);
    expect(running(escaped)).toBe(false);
    expect(existsSync(path.join(repo, ".worktrees", "greeting"))).toBe(false);
  },
  SLOW,
);

test(
  "an error a card's cycle throws that is no role's failure bounces the plan with the error as its cause, naming the recorded step's session, and ends the run, so bare card reports the bounce rather than carrying the run on",
  async () => {
    const { repo, plan, first } = await inCheck();
    // A file git cannot read makes staging it throw while the card lands, with no role running.
    const control = stand(["pi"]);
    queue(control, [proceed()], [done("printf 'hello\\n' > hello.txt && chmod 000 hello.txt")], [approved("Add the greeting")]);

    expect((await card(["approve"], repo)).code).toBe(0);
    const { pid } = record(plan.dir).run!;
    await until("the run to end", () => !running(pid));

    const { state, cycle, bounce } = record(plan.dir);
    expect(state).toBe("Bounced");
    expect(bounce!.cause).toContain("Permission denied");
    const tree = path.join(repo, ".worktrees", "greeting");
    expect(bounce).toEqual({ role: "reviewer", session: { harness: "pi", id: cycle!.sessions.reviewer!, dir: tree }, cause: bounce!.cause });
    const report = bouncedReport(first, "reviewer", bounce!.cause, `cd '${tree}' && pi --session-id ${bounce!.session.id}`);
    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });
    expect(record(plan.dir).state).toBe("Bounced");
  },
  SLOW,
);

test("an error thrown before a card's cycle is recorded stops the plan, with no session to name, and ends the run, so bare card reports it stopped rather than carrying the run on", async () => {
  const { repo, plan } = await inCheck();
  const control = stand(["pi"]);
  // Not a git worktree, so the cycle's first read of HEAD throws.
  const log = await startRun(plan, "pi", tempDir(), repo);
  const { pid } = record(plan.dir).run!;
  await until("the run to end", () => !running(pid));

  expect(record(plan.dir)).toMatchObject({ state: "Stopped", cycle: null, bounce: null });
  expect(readFileSync(log, "utf8")).toContain("not a git repository");
  const report = `The plan \`greeting\`'s run is stopped between cards, and the next card not closed runs from a fresh reconciler when the run is resumed.\n${openList("Stopped")}`;
  expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });
  expect(readdirSync(control)).toEqual([]);
});

test("bare card --plan in Stopped, with another plan in progress, ends its report with the commands open there under its --plan", async () => {
  const { repo, deck, plan } = await inCheck();
  await writeRecord(plan, { state: "Stopped" });
  await startPlan(deck, "other");

  const report = `The plan \`greeting\`'s run is stopped between cards, and the next card not closed runs from a fresh reconciler when the run is resumed.\n${openList("Stopped", "card --plan greeting")}`;
  expect(await card(["--plan", "greeting"], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });
});

test("bare card in Running reports the card in flight with its role, the cards closed with their headlines, and the commands open there", async () => {
  const { repo, deck, plan, first, final, base } = await inCheck();
  await closeCard(deck, first, "done", "Landed.");
  const cycle: Cycle = { card: final, base, role: "reviewer", step: "review", sessions: {}, rounds: 0, exchanges: 0 };
  await writeRecord(plan, { state: "Running", harness: "pi", run: { pid: process.pid, boot: BOOT }, cycle, landed: [{ card: first, commit: base }] });

  const report = `The plan \`greeting\`'s run is at this card, with the reviewer:\n\n${final}  Check the plan\n\n1 of the plan's 2 cards have closed:\n\n${first}  Add the greeting\n${openList("Running")}`;
  expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });
});

// Recorded text the owner reads, which the reports carry byte for byte: lines
// of markdown, trailing spaces and a heading below the record's own.
const RECORDED = "First line.  \n\n### Trying it\n\n```sh\nbun run greet --loud\n```\n\n- one\n  - **two**\n";

for (const [harness, resume] of [
  ["claude", (id: string) => `claude --resume ${id}`],
  ["pi", (id: string) => `pi --session-id ${id}`],
] as const) {
  test(`bare card in Bounced on ${harness} reports the role and its cause byte for byte, and the command that resumes its session from the worktree`, async () => {
    const { repo, plan, first, base } = await inCheck();
    const session = { harness, id: crypto.randomUUID(), dir: path.join(repo, ".worktrees", "greeting") };
    const cycle: Cycle = { card: first, base, role: "reviewer", step: "review", sessions: { reviewer: session.id }, rounds: 0, exchanges: 0 };
    await writeRecord(plan, { state: "Bounced", harness, cycle, bounce: { role: "reviewer", session, cause: RECORDED } });

    const result = await card([], repo);
    expect(result.stdout).toBe(forOwner(bouncedReport(first, "reviewer", RECORDED, `cd '${session.dir}' && ${resume(session.id)}`)));
    expect(result.stdout).toContain(`  cd '${session.dir}' && ${resume(session.id)}\n`);
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
  expect(result).toEqual({ code: 0, stdout: ended(plan, final, tree, RECORDED), stderr: "" });
  expect(result.stdout).toContain(`\n\n${RECORDED}</for_owner>\n`);
});

test(
  "a run filing two findings ends with both listed for the owner, each with its role and commands; card finish refuses naming both, and once one is left for later and the other declined, removes the worktree, keeps the branch and ends the plan",
  async () => {
    const { repo, deck, plan, final } = await inCheck();
    const control = stand(["pi"]);
    const findings = [
      { headline: "The README still names greet.sh", body: "README.md shows `greet.sh`." },
      { headline: "Nothing says how the code is licensed", body: "The tree holds no license file." },
    ];
    const approvedWith = { answer: JSON.stringify({ outcome: "approved", subject: "Add the greeting", close_note: "Landed it.", findings }) };
    queue(control, [proceed()], [done()], [approvedWith], [proceed()], [done()], [approved("Check the plan")]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    const [readme, license] = record(plan.dir).findings.map(({ id }) => id) as [string, string];
    const [readmeHeadline, licenseHeadline] = findings.map(({ headline }) => headline) as [string, string];
    const tree = path.join(repo, ".worktrees", "greeting");
    const filed = "The run filed these findings, each a waiting card until the owner settles it:\n\n";
    const unsettled = `${filed}${listed(readme, readmeHeadline)}\n${listed(license, licenseHeadline)}`;
    expect(await card([], repo)).toEqual({ code: 0, stdout: ended(plan, final, tree, "Landed it.\n", unsettled), stderr: "" });

    const refused = await card(["finish"], repo);
    expect(refused).toEqual({
      code: 1,
      stdout: "",
      stderr: `card: \`card finish\` is refused while a finding is unsettled, and these are:\n  ${readme}  ${readmeHeadline}\n  ${license}  ${licenseHeadline}\n`,
    });
    expect(existsSync(tree)).toBe(true);

    expect((await card(["later", readme], repo)).code).toBe(0);
    const declining = await card(["decline", license], repo, "No license until the owner picks one.\n");
    expect(declining).toEqual({ code: 0, stdout: `${license} is closed declined: ${licenseHeadline}\n`, stderr: "" });
    expect(readFileSync(path.join(deck.closedDir, `${license}.md`), "utf8")).toEndWith("## Close note\n\nNo license until the owner picks one.\n");
    const settled = `${filed}${listed(readme, readmeHeadline, "left for later")}\n${listed(license, licenseHeadline, "closed declined")}`;
    expect(await card([], repo)).toEqual({ code: 0, stdout: ended(plan, final, tree, "Landed it.\n", settled), stderr: "" });

    const finishing = await card(["finish"], repo);
    expect(finishing).toEqual({
      code: 0,
      stdout: forOwner(`The plan \`greeting\` is finished: its worktree ${tree} is removed, and its branch \`plan/greeting\` is kept, for the owner to land.\n`),
      stderr: "",
    });
    expect(existsSync(tree)).toBe(false);
    expect((await listWorktrees(repo)).map(({ root }) => root)).toEqual([repo]);
    expect(await branchExists("plan/greeting", repo)).toBe(true);
    expect(await listPlans(deck)).toEqual([]);

    // The finding left for later is waiting still, for the next plan.
    const next = await card([], repo);
    expect(next.code).toBe(0);
    expect(next.stdout).toContain(`${readme}  ${readmeHeadline}\n`);
    expect(next.stdout).toContain("# The Document stage");
    expect((await listPlans(deck)).map(({ state }) => state)).toEqual(["Document"]);
  },
  SLOW,
);

// A ticket for two findings, as a session drafts one: headed sections, a
// line ending in spaces and no final newline, which the owner sees as written.
const DRAFT = "The greeting's docs and license\n\n## What is wrong\n\nThe README names `greet.sh`,  \nand nothing says how the code is licensed.\n\n## What to do\n\nRename it, and pick a license.";
// The draft as a card's record holds it, its headings beneath `## Promotion`.
const STORED_DRAFT = DRAFT.replaceAll("## ", "### ");

test("card promote at Ended prints a clean draft for two findings for the owner and marks both awaiting a key, which settles them for card finish; bare card lists both with the --key form until card promote --key closes both promoted", async () => {
  const { repo, deck, plan, first, final } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  await closeCard(deck, first, "done", "Landed.");
  await closeCard(deck, final, "done", "Guide.\n");
  const finding = (headline: string) => ({ labels: [], blockedBy: [], headline, body: "Found.\n" });
  const [readmeHeadline, licenseHeadline] = ["The README still names greet.sh", "Nothing says how the code is licensed"];
  const readme = await fileCard(deck, finding(readmeHeadline));
  const license = await fileCard(deck, finding(licenseHeadline));
  await writeRecord(plan, {
    state: "Ended",
    harness: "pi",
    findings: [readme, license].map((id) => ({ id, role: "reviewer" as const, card: first })),
  });

  const promoting = await card(["promote", readme, license], repo, DRAFT);
  expect(promoting.stderr).toBe("");
  expect(promoting.code).toBe(0);
  expect(promoting.stdout).toStartWith(forOwner(DRAFT));
  expect(promoting.stdout).toContain(`<for_owner>\n${DRAFT}\n</for_owner>\n`);
  for (const id of [readme, license]) {
    expect(readFileSync(path.join(deck.openDir, `${id}.md`), "utf8")).toEndWith(`Found.\n\n## Promotion\n\n${STORED_DRAFT}\n`);
  }

  const awaiting = (id: string, headline: string) =>
    `${id}  ${headline}\n  filed by the reviewer, drafted for promotion, awaiting its key\n  card promote ${id} --key <KEY>\n`;
  const filed = `The run filed these findings, each a waiting card until the owner settles it:\n\n${awaiting(readme, readmeHeadline)}\n${awaiting(license, licenseHeadline)}`;
  expect(await card([], repo)).toEqual({ code: 0, stdout: ended(plan, final, tree, "Guide.\n", filed), stderr: "" });

  const finishing = await card(["finish"], repo);
  expect(finishing.stderr).toBe("");
  expect(finishing.code).toBe(0);
  expect(await listPlans(deck)).toEqual([]);

  const next = await card([], repo);
  expect(next.code).toBe(0);
  expect(next.stdout).toContain(`${readme}  ${readmeHeadline}\n  card promote ${readme} --key <KEY>\n`);
  expect(next.stdout).toContain(`${license}  ${licenseHeadline}\n  card promote ${license} --key <KEY>\n`);
  expect(next.stdout).not.toContain(`card decline ${readme}`);

  const keyed = await card(["promote", readme, license, "--key", "GREET-42"], repo);
  expect(keyed).toEqual({
    code: 0,
    stdout: `${readme} is closed promoted, as GREET-42: ${readmeHeadline}\n${license} is closed promoted, as GREET-42: ${licenseHeadline}\n`,
    stderr: "",
  });
  for (const id of [readme, license]) {
    const closed = readFileSync(path.join(deck.closedDir, `${id}.md`), "utf8");
    expect(closed).toContain("closed: promoted");
    expect(closed).toEndWith(`## Promotion\n\n${STORED_DRAFT}\n\n## Close note\n\nPromoted to GREET-42.\n`);
  }
  expect(await waitingCards(deck)).toEqual([]);
});

test("card promote takes a draft opening `# Title`, prints it as drafted for the owner, and stores it in the card with `### Title`, its other headings beneath it", async () => {
  const { repo, deck, plan, first, final } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  await holdWorktree(plan.slug, "plan/greeting", repo);
  await closeCard(deck, first, "done", "Landed.");
  await closeCard(deck, final, "done", "Guide.");
  const finding = await fileCard(deck, { labels: [], blockedBy: [], headline: "Nothing says goodbye", body: "Found.\n" });
  await writeRecord(plan, { state: "Ended", harness: "pi", findings: [{ id: finding, role: "reviewer", card: first }] });

  const promoting = await card(["promote", finding], repo, `# Title\n\n${DRAFT}`);
  expect(promoting.stderr).toBe("");
  expect(promoting.code).toBe(0);
  expect(promoting.stdout).toStartWith(forOwner(`# Title\n\n${DRAFT}`));
  expect(readFileSync(path.join(deck.openDir, `${finding}.md`), "utf8")).toEndWith(`Found.\n\n## Promotion\n\n### Title\n\n${DRAFT.replaceAll("## ", "#### ")}\n`);
});

test("a finding another plan joins is settled at Ended, listed with the plan that took it and no command, and card finish ends the plan", async () => {
  const { repo, deck, plan, first, final } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  await closeCard(deck, first, "done", "Landed.");
  await closeCard(deck, final, "done", "Guide.\n");
  const headline = "The README still names greet.sh";
  const readme = await fileCard(deck, { labels: [], blockedBy: [], headline, body: "Found.\n" });
  await writeRecord(plan, { state: "Ended", harness: "pi", findings: [{ id: readme, role: "reviewer", card: first }] });
  const other = await writeRecord(await startPlan(deck, "other"), { state: "Cards", placeholder: false });

  expect((await card(["--plan", "other", "join", readme], repo)).code).toBe(0);
  const filed = `The run filed these findings, each a waiting card until the owner settles it:\n\n${listed(readme, headline, "joined the plan `other`")}`;
  const settled = ended(plan, final, tree, "Guide.\n", filed, "card --plan greeting");
  expect(await card(["--plan", "greeting"], repo)).toEqual({ code: 0, stdout: settled, stderr: "" });

  // Taken in by the other plan's Cards stage, it is one of that plan's cards, and settled all the same.
  await Bun.write(path.join(other.cardsDir, "01-check-other.md"), "# Check the other plan\n\nBody.\n");
  expect((await card(["--plan", "other", "done"], repo)).code).toBe(0);
  expect(record(other.dir).cards).toContain(readme);
  expect(await card(["--plan", "greeting"], repo)).toEqual({ code: 0, stdout: settled, stderr: "" });

  const finishing = await card(["--plan", "greeting", "finish"], repo);
  expect(finishing.stderr).toBe("");
  expect(finishing.code).toBe(0);
  expect(existsSync(tree)).toBe(false);
  expect((await listPlans(deck)).map(({ slug }) => slug)).toEqual(["other"]);
});

test(
  "card decline during a run refuses one of the plan's cards, and closes a waiting card declined without touching the run's record or its course",
  async () => {
    const { repo, deck, plan, first, final } = await inCheck();
    const waiting = await fileCard(deck, { labels: [], blockedBy: [], headline: "A thought put down earlier", body: "Body.\n" });
    const control = stand(["pi"]);
    queue(control, [proceed()], [done(hold(control, "first"))], [approved("Add the greeting")], [proceed()], [done()], [approved("Check the plan")]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the first role to start", () => existsSync(path.join(control, "first.started")));
    const before = readFileSync(path.join(plan.dir, "state.json"), "utf8");

    const refused = await card(["decline", first], repo, "Not wanted.\n");
    expect(refused).toEqual({ code: 1, stdout: "", stderr: `card: ${first} is one of the plan \`greeting\`'s cards, so it is not waiting\n` });
    expect(existsSync(path.join(deck.openDir, `${first}.md`))).toBe(true);

    const declining = await card(["decline", waiting], repo, "Not wanted.\n");
    expect(declining).toEqual({ code: 0, stdout: `${waiting} is closed declined: A thought put down earlier\n`, stderr: "" });
    expect(readFileSync(path.join(deck.closedDir, `${waiting}.md`), "utf8")).toContain("closed: declined");
    expect(readFileSync(path.join(plan.dir, "state.json"), "utf8")).toBe(before);

    release(control, "first");
    await until("the plan to end", () => record(plan.dir).state === "Ended");
    expect(record(plan.dir).landed.map(({ card }) => card)).toEqual([first, final]);
  },
  SLOW,
);

test("card finish refuses while the worktree holds work git would lose, and leaves the worktree and the plan as they were", async () => {
  const { repo, deck, plan, first, final } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  await closeCard(deck, first, "done", "Landed.");
  await closeCard(deck, final, "done", "Guide.");
  await writeRecord(plan, { state: "Ended", harness: "pi" });
  writeFileSync(path.join(tree, "tried.txt"), "the owner's trial\n");

  const result = await card(["finish"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toStartWith("card: the plan is not finished, since git would not remove its worktree:");
  expect(result.stderr).toContain("untracked");
  expect(readFileSync(path.join(tree, "tried.txt"), "utf8")).toBe("the owner's trial\n");
  expect((await listPlans(deck)).map(({ state }) => state)).toEqual(["Ended"]);
});

test("card drop refuses while the worktree holds work git would lose, and leaves the worktree, the plan and its cards as they were", async () => {
  const { repo, deck, plan, first, final } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  await closeCard(deck, first, "done", "Landed.");
  await closeCard(deck, final, "done", "Guide.");
  await writeRecord(plan, { state: "Ended", harness: "pi", run: { pid: await deadPid(), boot: BOOT } });
  writeFileSync(path.join(tree, "tried.txt"), "the owner's trial\n");
  const cards = () => [deck.openDir, deck.closedDir].map((dir) => readdirSync(dir).map((name) => readFileSync(path.join(dir, name), "utf8")));
  const before = cards();

  const result = await card(["drop"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toStartWith("card: the plan is not dropped, since git would not remove its worktree:");
  expect(result.stderr).toContain("untracked");
  expect(readFileSync(path.join(tree, "tried.txt"), "utf8")).toBe("the owner's trial\n");
  expect((await listPlans(deck)).map(({ state }) => state)).toEqual(["Ended"]);
  expect(cards()).toEqual(before);
});

test("card drop in Stopped refuses while the worktree holds work git would lose, and leaves the worktree, the plan and its open cards as they were", async () => {
  const { repo, deck, plan } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  // Stopped is not settled, so the owner's file reaches the removal with the plan's cards open.
  await writeRecord(plan, { state: "Stopped", harness: "pi", run: { pid: await deadPid(), boot: BOOT } });
  writeFileSync(path.join(tree, "tried.txt"), "the owner's trial\n");
  const cards = () => [deck.openDir, deck.closedDir].map((dir) => readdirSync(dir).map((name) => readFileSync(path.join(dir, name), "utf8")));
  const before = cards();

  const result = await card(["drop"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toStartWith("card: the plan is not dropped, since git would not remove its worktree:");
  expect(result.stderr).toContain("untracked");
  expect(readFileSync(path.join(tree, "tried.txt"), "utf8")).toBe("the owner's trial\n");
  expect((await listPlans(deck)).map(({ state }) => state)).toEqual(["Stopped"]);
  expect(cards()).toEqual(before);
});

const ASKED = "Which file did you expect the greeting in?";
const RESPONSE = "In hello.txt, which the card names.\n\n## Why\n\nThe card says so.  \n";

for (const [harness, argv, stdout] of [
  ["claude", (id: string) => ["claude", "-p", "--output-format", "json", "--permission-mode", "bypassPermissions", "--resume", id], JSON.stringify({ result: RESPONSE })],
  ["pi", (id: string) => ["pi", "-p", "--session-id", id], RESPONSE],
] as const) {
  test(`card ask on ${harness} resumes the recorded session from the worktree with the question, prints its response for the owner, and changes no state and no file`, async () => {
    const { repo, deck, plan, first, base } = await inCheck();
    await ensureBranch("plan/greeting", "main", repo);
    const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
    // The stopped role's work, left in the worktree.
    writeFileSync(path.join(tree, "hello.txt"), "half\n");
    const session = { harness, id: crypto.randomUUID(), dir: tree };
    const cycle: Cycle = { card: first, base, role: "reconciler", step: "reconcile", sessions: { reconciler: session.id }, rounds: 0, exchanges: 0 };
    const bounce = { role: "reconciler" as const, session, cause: "the card's intent itself is wrong", question: "Is it?" };
    await writeRecord(plan, { state: "Bounced", harness, cycle, bounce });
    const control = stand([harness]);
    script(control, session.id, { stdout });
    const unchanged = async () => [
      readFileSync(path.join(plan.dir, "state.json"), "utf8"),
      readFileSync(path.join(deck.openDir, `${first}.md`), "utf8"),
      await gitOrThrow(["rev-parse", "HEAD"], tree),
      await gitOrThrow(["status", "--porcelain", "--untracked-files=all"], tree),
    ];
    const before = await unchanged();

    const result = await card(["ask"], repo, `${ASKED}\n`);
    expect(result).toEqual({ code: 0, stdout: forOwner(`The reconciler's response:\n\n${RESPONSE}`), stderr: "" });
    const [only, ...more] = calls(control, session.id);
    expect(more).toEqual([]);
    expect(only!.argv).toEqual([...argv(session.id)]);
    expect(only!.cwd).toBe(tree);
    expect(only!.stdin).toContain(`\n${ASKED}\n`);
    // A question-only resume reads no answer, so it states no schema.
    expect(only!.stdin).not.toContain("JSON Schema");
    expect(await unchanged()).toEqual(before);
    expect(record(plan.dir).state).toBe("Bounced");
  });
}

test("card ask returns with no process left running that the role started in a session of its own while it answered", async () => {
  const { repo, plan, first, base } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  const session = { harness: "pi" as const, id: crypto.randomUUID(), dir: tree };
  const cycle: Cycle = { card: first, base, role: "reconciler", step: "reconcile", sessions: { reconciler: session.id }, rounds: 0, exchanges: 0 };
  const bounce = { role: "reconciler" as const, session, cause: "the card's intent itself is wrong", question: "Is it?" };
  await writeRecord(plan, { state: "Bounced", harness: "pi", cycle, bounce });
  const control = stand(["pi"]);
  // Off the harness's output, which a writer holding it would keep `card ask` reading until the writer ended.
  script(control, session.id, { stdout: RESPONSE, run: `(${escaping(control)}) > /dev/null 2>&1` });

  expect((await card(["ask"], repo, `${ASKED}\n`)).code).toBe(0);
  expect(running(Number(readFileSync(path.join(control, "escaped"), "utf8")))).toBe(false);
});

test("card ask in Running refuses, and resumes no session", async () => {
  const { repo, plan, first, base } = await inCheck();
  const control = stand(["pi"]);
  const cycle: Cycle = { card: first, base, role: "implementer", step: "implement", sessions: { implementer: crypto.randomUUID() }, rounds: 0, exchanges: 0 };
  await writeRecord(plan, { state: "Running", harness: "pi", run: { pid: process.pid, boot: BOOT }, cycle });

  const result = await card(["ask"], repo, ASKED);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toStartWith("card: `card ask` is not open while the plan `greeting` is in Running");
  expect(readdirSync(control)).toEqual([]);
});

const OWNER_ANSWER = "Build greet() in this card: it belongs here.";

test(
  "card resume returns while the resumed reconciler runs, resumes its session with the owner's answer and its step's schema, and its proceed carries the run on to Ended",
  async () => {
    const { repo, plan, base } = await inCheck();
    const control = stand(["pi"]);
    const question = "The card calls `greet()`, which nothing defines; should this card build it?";
    const stop: Reply = { answer: JSON.stringify({ outcome: "stop", cause: "order", question }) };
    queue(
      control,
      [stop, proceed(hold(control, "resumed"))],
      [done("printf 'hello\\n' > hello.txt")],
      [approved("Add the greeting")],
      [proceed()],
      [done()],
      [approved("Check the plan")],
    );
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");
    const { bounce } = record(plan.dir);

    const resuming = await card(["resume"], repo, `${OWNER_ANSWER}\n`);
    expect(resuming.stderr).toBe("");
    expect(resuming.code).toBe(0);
    const tree = path.join(repo, ".worktrees", "greeting");
    const log = path.join(plan.dir, "run.log");
    expect(resuming.stdout).toBe(forOwner(`The plan \`greeting\`'s run is resuming the reconciler's session on pi, in ${tree}; its log is ${log}.\n`));

    await until("the resumed reconciler to start", () => existsSync(path.join(control, "resumed.started")));
    expect(record(plan.dir).state).toBe("Running");
    expect(record(plan.dir).bounce).toBeNull();
    release(control, "resumed");
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    const [, resumed, ...more] = calls(control, bounce!.session.id);
    expect(more).toEqual([]);
    expect(resumed!.argv).toEqual(["pi", "-p", "--session-id", bounce!.session.id]);
    expect(resumed!.cwd).toBe(tree);
    expect(resumed!.stdin).toContain(`\n${OWNER_ANSWER}\n`);
    expect(resumed!.stdin).toEndWith(answerInstruction(RECONCILER, path.join(plan.dir, "answer.json")));
    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan"]);
  },
  SLOW,
);

test(
  "card resume with nothing on stdin, after a role failed, resumes that role's session for its final answer, and the run carries on to Ended",
  async () => {
    const { repo, plan, base } = await inCheck();
    const control = stand(["pi"]);
    queue(
      control,
      [proceed()],
      [{ stderr: "usage limit reached\n", exit: 1 }, done("printf 'hello\\n' > hello.txt")],
      [approved("Add the greeting")],
      [proceed()],
      [done()],
      [approved("Check the plan")],
    );
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");
    const { bounce } = record(plan.dir);
    expect(bounce!.role).toBe("implementer");

    const resuming = await card(["resume"], repo);
    expect(resuming.stderr).toBe("");
    expect(resuming.code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    const [, resumed, ...more] = calls(control, bounce!.session.id);
    expect(more).toEqual([]);
    expect(resumed!.argv).toEqual(["pi", "-p", "--session-id", bounce!.session.id]);
    expect(resumed!.stdin).toContain("usage limit reached");
    expect(resumed!.stdin).toContain("\n(none)\n");
    expect(resumed!.stdin).toContain('"enum":["done","blocked"]');
    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan"]);
    expect(await gitOrThrow(["show", "plan/greeting~1:hello.txt"], repo)).toBe("hello\n");
  },
  SLOW,
);

test(
  "card resume after the revision rounds ran out resumes the reviewer the report named, and the count starts again, so its next revision is built and reviewed",
  async () => {
    const { repo, plan, base } = await inCheck();
    const control = stand(["pi"]);
    const revision = (round: number): Reply => ({ answer: JSON.stringify({ outcome: "revision", feedback: `Round ${round}: not yet.` }) });
    queue(
      control,
      [proceed()],
      [done(), done(), done(), done(), done()],
      [revision(1)],
      [revision(2)],
      [revision(3)],
      [revision(4), revision(5)],
      [approved("Add the greeting")],
      [proceed()],
      [done()],
      [approved("Check the plan")],
    );
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");
    const { bounce, cycle } = record(plan.dir);
    expect(bounce!.session.id).toBe(cycle!.sessions.reviewer!);

    expect((await card(["resume"], repo, OWNER_ANSWER)).code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    const resumed = calls(control, bounce!.session.id);
    expect(resumed).toHaveLength(2);
    expect(resumed[1]!.stdin).toContain(`\n${OWNER_ANSWER}\n`);
    expect(resumed[1]!.stdin).toContain('"enum":["approved","fixed","revision"]');
    expect(calls(control, cycle!.sessions.implementer!)).toHaveLength(5);
    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan"]);
  },
  SLOW,
);

test(
  "card resume after the exchanges ran out resumes the reconciler the report named, offering it the exchange again, and its reply carries the run on",
  async () => {
    const { repo, plan, base } = await inCheck();
    const control = stand(["pi"]);
    const blocked: Reply = { answer: JSON.stringify({ outcome: "blocked", finding: "The card names no file to write." }) };
    const reply: Reply = { answer: JSON.stringify({ outcome: "reply", reply: "It names hello.txt." }) };
    const disagreed: Reply = { answer: JSON.stringify({ outcome: "stop", cause: "disagreement", question: "Does the card name a file?" }) };
    queue(
      control,
      [proceed(), reply, reply, reply, disagreed, reply],
      [blocked, blocked, blocked, blocked, done("printf 'hello\\n' > hello.txt")],
      [approved("Add the greeting")],
      [proceed()],
      [done()],
      [approved("Check the plan")],
    );
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");
    const { bounce, cycle } = record(plan.dir);
    expect(bounce!.session.id).toBe(cycle!.sessions.reconciler!);

    expect((await card(["resume"], repo, OWNER_ANSWER)).code).toBe(0);
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    const resumed = calls(control, bounce!.session.id);
    expect(resumed).toHaveLength(6);
    expect(resumed[5]!.stdin).toContain(`\n${OWNER_ANSWER}\n`);
    expect(resumed[5]!.stdin).toContain('"enum":["amended","reply","stop"]');
    expect(calls(control, cycle!.sessions.implementer!)).toHaveLength(5);
    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan"]);
  },
  SLOW,
);

test(
  "card resume retrying a role that failed carries the counts on as recorded, so a revision past the cap after the retry bounces the plan",
  async () => {
    const { repo, plan, base } = await inCheck();
    const control = stand(["pi"]);
    const revision = (round: number): Reply => ({ answer: JSON.stringify({ outcome: "revision", feedback: `Round ${round}: not yet.` }) });
    // The implementer fails while revising for the third round.
    const failed: Reply = { stderr: "usage limit reached\n", exit: 1 };
    queue(control, [proceed()], [done(), done(), done(), failed, done()], [revision(1)], [revision(2)], [revision(3)], [revision(4)]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");
    expect(record(plan.dir).bounce!.role).toBe("implementer");

    expect((await card(["resume"], repo)).code).toBe(0);
    await until("the plan to bounce again", () => record(plan.dir).state === "Bounced");

    const { bounce, cycle } = record(plan.dir);
    const cause = "the reviewer still asked for a revision after 3 revision rounds, the most a card gets";
    expect(bounce).toEqual({ role: "reviewer", session: bounce!.session, cause, feedback: "Round 4: not yet." });
    expect(calls(control, cycle!.sessions.implementer!)).toHaveLength(5);
    expect(await subjects(repo, base)).toEqual([]);
  },
  SLOW,
);

test(
  "card resume after a hook refused the commit past its returns resumes the reviewer at the land step for its landing answer, and the card lands as one commit",
  async () => {
    const { repo, plan, base } = await inCheck();
    const hook = path.join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'the hook refuses' >&2\nexit 1\n", { mode: 0o755 });
    const control = stand(["pi"]);
    const fixed: Reply = { answer: JSON.stringify({ outcome: "fixed", subject: "Add the greeting", close_note: "Landed it." }) };
    queue(
      control,
      [proceed()],
      [done("printf 'hello\\n' > hello.txt")],
      [approved("Add the greeting"), fixed, fixed, fixed],
      [proceed()],
      [done()],
      [approved("Check the plan")],
    );
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the run to end", () => !running(record(plan.dir).run!.pid));
    const { state, bounce, cycle } = record(plan.dir);
    expect(state).toBe("Bounced");
    expect(cycle).toMatchObject({ role: "reviewer", step: "land" });
    expect(bounce!.session.id).toBe(cycle!.sessions.reviewer!);
    expect(bounce!.cause).toContain("the hook refuses");

    rmSync(hook);
    expect((await card(["resume"], repo, OWNER_ANSWER)).code).toBe(0);
    await until("the run to end", () => !running(record(plan.dir).run!.pid));

    expect(record(plan.dir)).toMatchObject({ state: "Ended", bounce: null });
    const resumed = calls(control, bounce!.session.id);
    expect(resumed).toHaveLength(4);
    expect(resumed[3]!.argv).toEqual(["pi", "-p", "--session-id", bounce!.session.id]);
    expect(resumed[3]!.stdin).toContain(`\n${OWNER_ANSWER}\n`);
    expect(resumed[3]!.stdin).toContain('"enum":["approved","fixed"]');
    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan"]);
  },
  SLOW,
);

// Every step a cycle can record, with the role that answers it, so a step
// added without a role to resume fails the type check, and one added without
// a resume path fails the test below.
const STEP_ROLES: Record<Step, Role> = {
  reconcile: "reconciler",
  converse: "reconciler",
  implement: "implementer",
  review: "reviewer",
  land: "reviewer",
};

for (const [step, role] of Object.entries(STEP_ROLES) as [Step, Role][]) {
  test(
    `card resume of a cycle bounced at the ${step} step resumes the ${role}'s recorded session`,
    async () => {
      const { repo, plan, first, base } = await inCheck();
      const control = stand(["pi"]);
      await ensureBranch("plan/greeting", "main", repo);
      const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
      const session = { harness: "pi" as const, id: crypto.randomUUID(), dir: tree };
      // The resumed session fails, which bounces the plan again with its failure as the cause.
      script(control, session.id, { stderr: "usage limit reached\n", exit: 1 });
      const cycle: Cycle = { card: first, base, role, step, sessions: { [role]: session.id }, rounds: 0, exchanges: 0 };
      const bounce = { role, session, cause: "usage limit reached" };
      await writeRecord(plan, { state: "Bounced", harness: "pi", run: { pid: await deadPid(), boot: BOOT }, cycle, bounce });

      expect((await card(["resume"], repo)).code).toBe(0);
      await until("the run to end", () => !running(record(plan.dir).run!.pid));

      expect(record(plan.dir)).toMatchObject({ state: "Bounced", bounce: { role, session, cause: "pi exited with status 1: usage limit reached" } });
      const resumed = calls(control, session.id);
      expect(resumed.map(({ argv }) => argv)).toEqual([["pi", "-p", "--session-id", session.id]]);
    },
    SLOW,
  );
}

/** What bare `card` and `card stop` report for the owner in Stopped, with the card `inCheck` filed first. */
function stoppedReport(id: string): string {
  return `The plan \`greeting\`'s run is stopped at this card, which reruns from a fresh reconciler when the run is resumed:\n\n${id}  Add the greeting\n${openList("Stopped")}`;
}

/**
 * Shell, as a role's work, that commits part of it, leaves the rest
 * uncommitted, starts a process in a session of its own, as `escaping` does,
 * and starts a child that sleeps, writing the role's pid, the child's and the
 * escaped process's to `pids`.
 */
function sleeping(control: string, pids: string): string {
  return `printf 'half\\n' > half.txt; git add half.txt; git commit -q -m half; printf 'more\\n' > more.txt; ${escaping(control)}sleep 30 & echo $PPID $! $escaped > '${pids}'; ${hold(control, "first")}`;
}

test(
  "card stop in Running returns with the run, the role, the role's child and a process the role started in a session of its own gone, the worktree clean, the card open and the plan Stopped; bare card names the card, and card resume reruns it from a fresh reconciler",
  async () => {
    const { repo, deck, plan, first, final, base } = await inCheck();
    const control = stand(["pi"]);
    const pids = path.join(control, "pids");
    const seen = path.join(control, "seen");
    queue(
      control,
      [proceed()],
      [done(sleeping(control, pids))],
      [proceed(`{ git rev-parse HEAD; git status --porcelain; } > '${seen}'`)],
      [done("printf 'hello\\n' > hello.txt")],
      [approved("Add the greeting")],
      [proceed()],
      [done()],
      [approved("Check the plan")],
    );
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the first role to start", () => existsSync(path.join(control, "first.started")) && existsSync(pids));
    const processes = [record(plan.dir).run!.pid, ...readFileSync(pids, "utf8").trim().split(" ").map(Number)];
    expect(processes.map(running)).toEqual([true, true, true, true]);

    const stopping = await card(["stop"], repo);
    expect(stopping).toEqual({ code: 0, stdout: forOwner(stoppedReport(first)), stderr: "" });
    expect(processes.map(running)).toEqual([false, false, false, false]);
    const tree = path.join(repo, ".worktrees", "greeting");
    expect((await gitOrThrow(["rev-parse", "HEAD"], tree)).trim()).toBe(base);
    expect(await gitOrThrow(["status", "--porcelain", "--untracked-files=all"], tree)).toBe("");
    expect(existsSync(path.join(deck.openDir, `${first}.md`))).toBe(true);
    expect(record(plan.dir).state).toBe("Stopped");

    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(stoppedReport(first)), stderr: "" });
    const asking = await card(["ask"], repo, ASKED);
    expect(asking.code).not.toBe(0);
    expect(asking.stderr).toStartWith("card: `card ask` is not open while the plan `greeting` is in Stopped");
    // No session waits after a stop, so an answer has no one to reach.
    const answering = await card(["resume"], repo, OWNER_ANSWER);
    expect(answering.code).not.toBe(0);
    expect(record(plan.dir).state).toBe("Stopped");

    const resuming = await card(["resume"], repo);
    const log = path.join(plan.dir, "run.log");
    expect(resuming).toEqual({ code: 0, stdout: forOwner(`The plan \`greeting\`'s run is carried on, on pi, in ${tree}; its log is ${log}.\n`), stderr: "" });
    await until("the plan to end", () => record(plan.dir).state === "Ended");

    expect(readFileSync(seen, "utf8")).toBe(`${base}\n`);
    expect(record(plan.dir).landed.map(({ card }) => card)).toEqual([first, final]);
    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan"]);
    // The stopped cycle's reconciler, and a fresh one after the resume, each launched once on the card and never resumed.
    const reconcilers = readdirSync(control)
      .filter((id) => existsSync(path.join(control, id, "calls")))
      .map((id) => calls(control, id))
      .filter(([launched]) => launched!.stdin.startsWith("# Reconciling one card\n") && launched!.stdin.includes("<card>\n# Add the greeting\n"));
    expect(reconcilers.map((made) => made.length)).toEqual([1, 1]);
  },
  SLOW,
);

test(
  "card stop in Dead ends the role the dead run left running, the role's child, and a process the role started in a session of its own, and leaves the worktree clean, the card open and the plan Stopped",
  async () => {
    const { repo, deck, plan, first, base } = await inCheck();
    const control = stand(["pi"]);
    const pids = path.join(control, "pids");
    queue(control, [proceed()], [done(sleeping(control, pids))]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the first role to start", () => existsSync(path.join(control, "first.started")) && existsSync(pids));
    process.kill(record(plan.dir).run!.pid, "SIGKILL");
    for (const deadline = Date.now() + 5_000; (await stateOf(deck)) !== "Dead"; await Bun.sleep(50)) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the run to read as Dead");
    }
    const left = readFileSync(pids, "utf8").trim().split(" ").map(Number);
    expect(left.map(running)).toEqual([true, true, true]);

    const stopping = await card(["stop"], repo);
    expect(stopping).toEqual({ code: 0, stdout: forOwner(stoppedReport(first)), stderr: "" });
    expect(left.map(running)).toEqual([false, false, false]);
    const tree = path.join(repo, ".worktrees", "greeting");
    expect((await gitOrThrow(["rev-parse", "HEAD"], tree)).trim()).toBe(base);
    expect(await gitOrThrow(["status", "--porcelain", "--untracked-files=all"], tree)).toBe("");
    expect(existsSync(path.join(deck.openDir, `${first}.md`))).toBe(true);
    expect(record(plan.dir).state).toBe("Stopped");
    expect(await stateOf(deck)).toBe("Stopped");
  },
  SLOW,
);

test(
  "card drop in Running ends the run, its role, the role's child and a process the role started in a session of its own, removes the worktree, keeps the branch at its tip, closes every card of the plan not done declined under one note, leaves the done card and the run's finding as they were, and ends the plan",
  async () => {
    const { repo, deck, plan, first, final } = await inCheck();
    const middle = await fileCard(deck, { labels: [], blockedBy: [], headline: "Hold the greeting", body: "Body.\n" });
    await writeRecord(plan, { cards: [first, middle, final] });
    const control = stand(["pi"]);
    const pids = path.join(control, "pids");
    const findings = [{ headline: "Nothing says goodbye", body: "The greeting has no farewell." }];
    const approvedWith = { answer: JSON.stringify({ outcome: "approved", subject: "Add the greeting", close_note: "Landed it.", findings }) };
    queue(control, [proceed()], [done("printf 'hello\\n' > hello.txt")], [approvedWith], [proceed()], [done(sleeping(control, pids))]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the middle card's implementer to start", () => existsSync(path.join(control, "first.started")) && existsSync(pids));
    const { run, landed, findings: filed } = record(plan.dir);
    const processes = [run!.pid, ...readFileSync(pids, "utf8").trim().split(" ").map(Number)];
    expect(processes.map(running)).toEqual([true, true, true, true]);
    const landedCard = readFileSync(path.join(deck.closedDir, `${first}.md`), "utf8");

    const tree = path.join(repo, ".worktrees", "greeting");
    const dropping = await card(["drop"], repo);
    expect(dropping).toEqual({
      code: 0,
      stdout: forOwner(
        `The plan \`greeting\` is dropped: its worktree ${tree} is removed, and its branch \`plan/greeting\` is kept.\n\n` +
          `These cards of the plan are closed declined:\n\n${middle}  Hold the greeting\n${final}  Check the plan\n`,
      ),
      stderr: "",
    });
    expect(processes.map(running)).toEqual([false, false, false, false]);
    expect(existsSync(tree)).toBe(false);
    expect((await listWorktrees(repo)).map(({ root }) => root)).toEqual([repo]);
    // At the first card's commit: the in-flight card's commit of half its work goes with the rest of that work.
    expect((await gitOrThrow(["rev-parse", "plan/greeting"], repo)).trim()).toBe(landed[0]!.commit);
    const note = "## Close note\n\nDropped with the plan `greeting`, which the owner gave up.\n";
    for (const id of [middle, final]) {
      const closed = readFileSync(path.join(deck.closedDir, `${id}.md`), "utf8");
      expect(closed).toContain("closed: declined\n");
      expect(closed).toEndWith(note);
    }
    expect(readFileSync(path.join(deck.closedDir, `${first}.md`), "utf8")).toBe(landedCard);
    expect((await waitingCards(deck)).map(({ id }) => id)).toEqual(filed.map(({ id }) => id));
    expect(await listPlans(deck)).toEqual([]);
    expect(existsSync(plan.dir)).toBe(false);
  },
  SLOW,
);

test("card drop in Bounced discards the bounced card's work, removes the worktree, keeps the branch, and closes the plan's cards declined", async () => {
  const { repo, deck, plan, first, final, base } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  // The bounced role's work, left in the worktree uncommitted.
  writeFileSync(path.join(tree, "hello.txt"), "half\n");
  const session = { harness: "pi" as const, id: crypto.randomUUID(), dir: tree };
  const cycle: Cycle = { card: first, base, role: "implementer", step: "implement", sessions: { implementer: session.id }, rounds: 0, exchanges: 0 };
  const bounce = { role: "implementer" as const, session, cause: "usage limit reached" };
  await writeRecord(plan, { state: "Bounced", harness: "pi", run: { pid: await deadPid(), boot: BOOT }, cycle, bounce });

  const dropping = await card(["drop"], repo);
  expect(dropping).toEqual({
    code: 0,
    stdout: forOwner(
      `The plan \`greeting\` is dropped: its worktree ${tree} is removed, and its branch \`plan/greeting\` is kept.\n\n` +
        `These cards of the plan are closed declined:\n\n${first}  Add the greeting\n${final}  Check the plan\n`,
    ),
    stderr: "",
  });
  expect(existsSync(tree)).toBe(false);
  expect((await listWorktrees(repo)).map(({ root }) => root)).toEqual([repo]);
  expect((await gitOrThrow(["rev-parse", "plan/greeting"], repo)).trim()).toBe(base);
  expect(readFileSync(path.join(deck.closedDir, `${first}.md`), "utf8")).toContain("closed: declined\n");
  expect(await listPlans(deck)).toEqual([]);
});

/** The calls of every session whose launch was a reconciler on the card headed `headline`, one list per session. */
function reconcilersOf(control: string, headline: string): ReturnType<typeof calls>[] {
  return readdirSync(control)
    .filter((id) => existsSync(path.join(control, id, "calls")))
    .map((id) => calls(control, id))
    .filter(([launched]) => launched!.stdin.startsWith("# Reconciling one card\n") && launched!.stdin.includes(`<card>\n# ${headline}\n`));
}

test(
  "card amend after a bounce at the second of three cards discards the bounced work and prints the Cards prompt; a card taken in ahead of it runs first, then the amended card from a fresh reconciler, on the harness the run recorded",
  async () => {
    const repo = await tempRepo();
    const deck = await createDeck(repo, "proj");
    const finding = (headline: string) => ({ labels: [], blockedBy: [], headline, body: "Body.\n" });
    const first = await fileCard(deck, finding("Add the greeting"));
    const second = await fileCard(deck, finding("Use the greeting"));
    const final = await fileCard(deck, finding("Check the plan"));
    const plan = await writeRecord(await startPlan(deck, "greeting"), { state: "Check", placeholder: false, cards: [first, second, final], final });
    await Bun.write(plan.document, `---\nbranch: plan/greeting\nstart-point: main\n---\n\n# Greet\n\n${DOCUMENT_BODY}\n`);
    const base = (await gitOrThrow(["rev-parse", "main"], repo)).trim();
    // Both on PATH, so a second approval choosing afresh would pick claude.
    const control = stand(["claude", "pi"]);
    const question = "The card uses `greet()`, which no card builds; which card should?";
    const stop: Reply = { answer: JSON.stringify({ outcome: "stop", cause: "order", question }), run: "printf 'stray\\n' > stray.txt" };
    queue(control, [proceed()], [done("printf 'hello\\n' > hello.txt")], [approved("Add the greeting")], [stop]);
    expect((await card(["approve", "--harness", "pi"], repo)).code).toBe(0);
    await until("the plan to bounce", () => record(plan.dir).state === "Bounced");
    const { bounce } = record(plan.dir);
    expect(bounce!.session.id).toBe(record(plan.dir).cycle!.sessions.reconciler!);

    const amending = await card(["amend"], repo);
    expect(amending.stderr).toBe("");
    expect(amending.code).toBe(0);
    expect(amending.stdout).toContain("# The Cards stage");
    expect(amending.stdout).toContain(
      [
        `${first}  Add the greeting  (landed)`,
        `  ${path.join(deck.closedDir, `${first}.md`)}`,
        `${second}  Use the greeting`,
        `  ${path.join(deck.openDir, `${second}.md`)}`,
        `${final}  Check the plan  (final card)`,
      ].join("\n"),
    );
    expect(record(plan.dir).state).toBe("Cards");
    expect(record(plan.dir).bounce).toBeNull();
    const tree = path.join(repo, ".worktrees", "greeting");
    const landed = (await gitOrThrow(["rev-parse", "plan/greeting"], repo)).trim();
    expect((await gitOrThrow(["rev-parse", "HEAD"], tree)).trim()).toBe(landed);
    expect(await gitOrThrow(["status", "--porcelain", "--untracked-files=all"], tree)).toBe("");

    // The authoring session's amendments: a new card, and the stopped card's file changed in place.
    await Bun.write(path.join(plan.cardsDir, "01-build-greet.md"), "# Build greet\n\nBody.\n");
    const amended = "# Use the greeting\n\nBody, amended: call `greet()`, which the card ahead builds.\n";
    writeFileSync(path.join(deck.openDir, `${second}.md`), amended);
    const taking = await card(["done"], repo);
    expect(taking.stderr).toBe("");
    const cards = record(plan.dir).cards;
    expect(cards).toHaveLength(4);
    expect([cards[0], cards[2], cards[3]]).toEqual([first, second, final]);

    queue(
      control,
      [proceed()],
      [done()],
      [approved("Build greet")],
      [proceed()],
      [done()],
      [approved("Use the greeting")],
      [proceed()],
      [done()],
      [approved("Check the plan")],
    );
    const approving = await card(["approve"], repo);
    expect(approving.stderr).toBe("");
    expect(approving.stdout).toContain("running on pi");
    await until("the run to end or bounce", () => record(plan.dir).state !== "Running");
    expect(record(plan.dir).state).toBe("Ended");
    expect(record(plan.dir).harness).toBe("pi");

    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Build greet", "Use the greeting", "Check the plan"]);
    expect(record(plan.dir).landed.map(({ card }) => card)).toEqual(cards);
    // The first card's one reconciler is the first run's, and nothing of it ran again.
    expect(reconcilersOf(control, "Add the greeting").map((made) => made.length)).toEqual([1]);
    // The bounced reconciler was left behind, and a fresh one read the amended card.
    expect(calls(control, bounce!.session.id)).toHaveLength(1);
    const seconds = reconcilersOf(control, "Use the greeting");
    expect(seconds.map((made) => made.length)).toEqual([1, 1]);
    expect(seconds.filter(([launched]) => launched!.stdin.includes(amended.trimEnd()))).toHaveLength(1);
  },
  SLOW,
);

test("card amend in Running refuses, and changes nothing", async () => {
  const { repo, plan, first, base } = await inCheck();
  const cycle: Cycle = { card: first, base, role: "implementer", step: "implement", sessions: { implementer: crypto.randomUUID() }, rounds: 0, exchanges: 0 };
  await writeRecord(plan, { state: "Running", harness: "pi", run: { pid: process.pid, boot: BOOT }, cycle });
  const before = readFileSync(path.join(plan.dir, "state.json"), "utf8");

  const result = await card(["amend"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toStartWith("card: `card amend` is not open while the plan `greeting` is in Running");
  expect(readFileSync(path.join(plan.dir, "state.json"), "utf8")).toBe(before);
});

// The final card's close note on the plan's first end, which the run after a join hands back to it.
const GUIDE = "The guide, as the final card first closed with it.";

/**
 * Runs `inCheck`'s plan to its end, the first card's reviewer filing one
 * finding and the final card closing under GUIDE, and returns the finding.
 */
async function endWithFinding(repo: string, plan: Plan, control: string): Promise<string> {
  const findings = [{ headline: "Nothing says goodbye", body: "The greeting has no farewell." }];
  const approvedWith = { answer: JSON.stringify({ outcome: "approved", subject: "Add the greeting", close_note: "Landed it.", findings }) };
  const guided = { answer: JSON.stringify({ outcome: "approved", subject: "Check the plan", close_note: GUIDE }) };
  queue(control, [proceed()], [done()], [approvedWith], [proceed()], [done()], [guided]);
  expect((await card(["approve"], repo)).code).toBe(0);
  await until("the plan to end", () => record(plan.dir).state === "Ended");
  return record(plan.dir).findings[0]!.id;
}

/** Joins `finding` at the plan's end, rewrites it as the Cards stage's session would, and takes it in. */
async function joinAndTakeIn(repo: string, deck: Deck, plan: Plan, finding: string): Promise<void> {
  expect((await card(["join", finding], repo)).code).toBe(0);
  writeFileSync(path.join(deck.openDir, `${finding}.md`), "# Add a farewell\n\nPrint goodbye after the greeting.\n");
  const taking = await card(["done"], repo);
  expect(taking.stderr).toBe("");
  expect(taking.code).toBe(0);
}

test("card join at Ended reopens the final card in place, keeping its record, and takes the plan back to Cards, whose prompt names the finding's file", async () => {
  const { repo, deck, plan, first, final } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  await holdWorktree(plan.slug, "plan/greeting", repo);
  await closeCard(deck, first, "done", "Landed.");
  await closeCard(deck, final, "done", "Guide.");
  const finding = await fileCard(deck, { labels: [], blockedBy: [], headline: "Nothing says goodbye", body: "Found.\n" });
  await writeRecord(plan, { state: "Ended", harness: "pi", findings: [{ id: finding, role: "reviewer", card: first }] });

  const joining = await card(["join", finding], repo);
  expect(joining.stderr).toBe("");
  expect(joining.code).toBe(0);

  expect(existsSync(path.join(deck.closedDir, `${final}.md`))).toBe(false);
  const reopened = readFileSync(path.join(deck.openDir, `${final}.md`), "utf8");
  expect(reopened).not.toMatch(/^closed:/m);
  expect(reopened).toEndWith("## Close note\n\nGuide.\n");
  const state = record(plan.dir);
  expect(state.state).toBe("Cards");
  expect(state.joins).toEqual([finding]);

  const prompt = await card([], repo);
  expect(prompt.stderr).toBe("");
  expect(prompt.stdout).toContain("# The Cards stage");
  expect(prompt.stdout).toContain(`${finding}  Nothing says goodbye\n  ${path.join(deck.openDir, `${finding}.md`)}\n`);
  expect(prompt.stdout).toContain(`${final}  Check the plan  (final card)\n`);
});

test("card join at Ended refuses a finding awaiting its key, naming the --key form, and leaves the final card closed and the plan in Ended", async () => {
  const { repo, deck, plan, first, final } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  await holdWorktree(plan.slug, "plan/greeting", repo);
  await closeCard(deck, first, "done", "Landed.");
  await closeCard(deck, final, "done", "Guide.");
  const finding = await fileCard(deck, { labels: [], blockedBy: [], headline: "Nothing says goodbye", body: "Found.\n" });
  await writeRecord(plan, { state: "Ended", harness: "pi", findings: [{ id: finding, role: "reviewer", card: first }] });
  expect((await card(["promote", finding], repo, DRAFT)).code).toBe(0);
  const before = readFileSync(path.join(plan.dir, "state.json"), "utf8");

  const joining = await card(["join", finding], repo);
  expect(joining).toEqual({
    code: 1,
    stdout: "",
    stderr: `card: ${finding} is drafted for promotion, awaiting its key, which \`card promote ${finding} --key <KEY>\` records\n`,
  });
  expect(existsSync(path.join(deck.closedDir, `${final}.md`))).toBe(true);
  expect(existsSync(path.join(deck.openDir, `${final}.md`))).toBe(false);
  expect(readFileSync(path.join(plan.dir, "state.json"), "utf8")).toBe(before);
  expect(record(plan.dir).state).toBe("Ended");
});

/**
 * A plan in Ended with one finding, as a `card join` of it leaves the deck
 * when it dies after recording itself and reopening the final card, before
 * its record moves the plan to Cards: the final card reopened, and where
 * `both`, whole in `closed/` as well, as a reopen that died before its
 * unlink leaves it.
 */
async function diedJoining(both: boolean) {
  const { repo, deck, plan, first, final } = await inCheck();
  await ensureBranch("plan/greeting", "main", repo);
  await holdWorktree(plan.slug, "plan/greeting", repo);
  await closeCard(deck, first, "done", "Landed.");
  await closeCard(deck, final, "done", "Guide.");
  const finding = await fileCard(deck, { labels: [], blockedBy: [], headline: "Nothing says goodbye", body: "Found.\n" });
  const findings = [{ id: finding, role: "reviewer" as const, card: first }];
  await writeRecord(plan, { state: "Ended", harness: "pi", findings, pending: { verb: "join", id: finding } });
  const closed = readFileSync(path.join(deck.closedDir, `${final}.md`), "utf8");
  await reopenCard(deck, final);
  if (both) writeFileSync(path.join(deck.closedDir, `${final}.md`), closed);
  return { repo, deck, plan, final, finding };
}

/** What every invocation after the join died says before it goes on. */
const JOIN_FINISHED = "card: `card join` on the plan `greeting` is recorded but did not finish, and is finished now, before anything else runs\n";

/** That the final card is in `open/` alone, reopened with its record kept, as the join leaves it. */
function reopenedOnce(deck: Deck, final: string): void {
  expect(existsSync(path.join(deck.closedDir, `${final}.md`))).toBe(false);
  const reopened = readFileSync(path.join(deck.openDir, `${final}.md`), "utf8");
  expect(reopened).not.toMatch(/^closed:/m);
  expect(reopened).toEndWith("## Close note\n\nGuide.\n");
}

for (const [left, both] of [
  ["reopened", false],
  ["whole in both open/ and closed/", true],
] as const) {
  test(`bare card at Ended, after a join died with the final card ${left}, finishes the join, leaving the final card open once and the plan in Cards with the finding joined, and prints the Cards prompt`, async () => {
    const { repo, deck, plan, final, finding } = await diedJoining(both);

    const bare = await card([], repo);
    expect(bare.stderr).toBe(JOIN_FINISHED);
    expect(bare.code).toBe(0);
    expect(bare.stdout).toContain("# The Cards stage");
    expect(bare.stdout).toContain(`${finding}  Nothing says goodbye\n  ${path.join(deck.openDir, `${finding}.md`)}\n`);
    reopenedOnce(deck, final);
    const state = record(plan.dir);
    expect([state.state, state.joins, state.pending]).toEqual(["Cards", [finding], null]);
  });

  test(`card later, after a join died with the final card ${left}, finishes the join first, then withdraws it in the Cards stage, leaving the final card open once; card finish is not open there`, async () => {
    const { repo, deck, plan, final, finding } = await diedJoining(both);

    const later = await card(["later", finding], repo);
    expect(later.stderr).toBe(JOIN_FINISHED);
    expect(later.code).toBe(0);
    reopenedOnce(deck, final);
    const state = record(plan.dir);
    expect([state.state, state.joins, state.later]).toEqual(["Cards", [], [finding]]);
    expect((await card(["finish"], repo)).code).toBe(1);
    expect(record(plan.dir).state).toBe("Cards");
  });

  test(`card drop, after a join died with the final card ${left}, finishes the join first, then closes the final card and the joined finding declined once each and ends the plan`, async () => {
    const { repo, deck, final, finding } = await diedJoining(both);

    const dropping = await card(["drop"], repo);
    expect(dropping).toEqual({
      code: 0,
      stdout: forOwner(`The plan \`greeting\` is dropped.\n\nThese cards of the plan are closed declined:\n\n${final}  Check the plan\n${finding}  Nothing says goodbye\n`),
      stderr: JOIN_FINISHED,
    });
    expect(await listPlans(deck)).toEqual([]);
    for (const id of [final, finding]) {
      expect(existsSync(path.join(deck.openDir, `${id}.md`))).toBe(false);
      const text = readFileSync(path.join(deck.closedDir, `${id}.md`), "utf8");
      expect(text.match(/^closed: declined$/gm)).toHaveLength(1);
      expect(text).toEndWith("## Close note\n\nDropped with the plan `greeting`, which the owner gave up.\n");
    }
  });

  test(`card join, retried after a join died with the final card ${left}, finishes the join first and then joins nothing twice, leaving the final card open once`, async () => {
    const { repo, deck, plan, final, finding } = await diedJoining(both);

    const joining = await card(["join", finding], repo);
    expect(joining.stderr).toBe(JOIN_FINISHED);
    expect(joining.code).toBe(0);
    reopenedOnce(deck, final);
    const state = record(plan.dir);
    expect([state.state, state.joins, state.pending]).toEqual(["Cards", [finding], null]);
  });
}

test(
  "after a join at Ended, card done and card approve run the joined card from its reconciler, then the final card again, whose reconciler reads its earlier close note; the plan ends with the final card closed done once, holding both close notes, and one commit per card run",
  async () => {
    const { repo, deck, plan, first, final, base } = await inCheck();
    const control = stand(["pi"]);
    const finding = await endWithFinding(repo, plan, control);
    await joinAndTakeIn(repo, deck, plan, finding);
    expect(record(plan.dir).cards).toEqual([first, finding, final]);

    queue(control, [proceed()], [done()], [approved("Add a farewell")], [proceed()], [done()], [approved("Check the plan")]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the run to end or bounce", () => record(plan.dir).state !== "Running");
    expect(record(plan.dir).state).toBe("Ended");

    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan", "Add a farewell", "Check the plan"]);
    expect(record(plan.dir).landed.map(({ card }) => card)).toEqual([first, final, finding, final]);
    expect(reconcilersOf(control, "Add a farewell").map((made) => made.length)).toEqual([1]);
    // The last cycle recorded is the final card's second, and its reconciler read the record the first left.
    const reconciling = calls(control, record(plan.dir).cycle!.sessions.reconciler!)[0]!.stdin;
    expect(reconciling).toContain(`<card>\n# Check the plan\n`);
    expect(reconciling).toContain(`## Close note\n\n${GUIDE}\n`);

    expect(existsSync(path.join(deck.openDir, `${final}.md`))).toBe(false);
    const closed = readFileSync(path.join(deck.closedDir, `${final}.md`), "utf8");
    expect(closed.match(/^closed: .*$/gm)).toEqual(["closed: done"]);
    expect(closed.match(/^## Close note$/gm)).toHaveLength(2);
    expect(closed).toEndWith("## Close note\n\nLanded it.\n");
  },
  SLOW,
);

test(
  "bare card in a run after a join at Ended, at the joined card, counts and lists as closed only the cards closed done, not the reopened final card",
  async () => {
    const { repo, deck, plan, first } = await inCheck();
    const control = stand(["pi"]);
    const finding = await endWithFinding(repo, plan, control);
    await joinAndTakeIn(repo, deck, plan, finding);

    queue(control, [proceed()], [done(hold(control, "farewell"))], [approved("Add a farewell")], [proceed()], [done()], [approved("Check the plan")]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the joined card's implementer to start", () => existsSync(path.join(control, "farewell.started")));

    const report = `The plan \`greeting\`'s run is at this card, with the implementer:\n\n${finding}  Add a farewell\n\n1 of the plan's 3 cards have closed:\n\n${first}  Add the greeting\n${openList("Running")}`;
    expect(await card([], repo)).toEqual({ code: 0, stdout: forOwner(report), stderr: "" });

    release(control, "farewell");
    await until("the run to end or bounce", () => record(plan.dir).state !== "Running");
    expect(record(plan.dir).state).toBe("Ended");
  },
  SLOW,
);

test(
  "a run after a join at Ended, killed during the joined card and carried on by bare card, runs the joined card and then the final card again",
  async () => {
    const { repo, deck, plan, first, final, base } = await inCheck();
    const control = stand(["pi"]);
    const finding = await endWithFinding(repo, plan, control);
    await joinAndTakeIn(repo, deck, plan, finding);

    queue(control, [proceed()], [done(hold(control, "farewell"))]);
    expect((await card(["approve"], repo)).code).toBe(0);
    await until("the joined card's implementer to start", () => existsSync(path.join(control, "farewell.started")));
    process.kill(-record(plan.dir).run!.pid, "SIGKILL");
    for (const deadline = Date.now() + 5_000; (await stateOf(deck)) !== "Dead"; await Bun.sleep(50)) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the run to read as Dead");
    }

    queue(control, [proceed()], [done()], [approved("Add a farewell")], [proceed()], [done()], [approved("Check the plan")]);
    const carrying = await card([], repo);
    expect(carrying.stderr).toBe("");
    expect(carrying.code).toBe(0);
    await until("the run to end or bounce", () => record(plan.dir).state !== "Running");
    expect(record(plan.dir).state).toBe("Ended");

    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan", "Add a farewell", "Check the plan"]);
    expect(record(plan.dir).landed.map(({ card }) => card)).toEqual([first, final, finding, final]);
    expect(reconcilersOf(control, "Check the plan")).toHaveLength(2);
    const closed = readFileSync(path.join(deck.closedDir, `${final}.md`), "utf8");
    expect(closed.match(/^## Close note$/gm)).toHaveLength(2);
  },
  SLOW,
);

test(
  "a run killed after the reopened final card's commit, before its close, is carried on by bare card, closing the final card from its record with no third commit",
  async () => {
    const { repo, deck, plan, first, final, base } = await inCheck();
    await ensureBranch("plan/greeting", "main", repo);
    const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
    const greeting = await land("Add the greeting", "Landed.", tree);
    await closeCard(deck, first, "done", "Landed.");
    const checked = await land("Check the plan", GUIDE, tree);
    await closeCard(deck, final, "done", GUIDE);
    // Reopened, as a join at the plan's end leaves it, and landed again before the run died.
    await reopenCard(deck, final);
    const again = await land("Check the plan", NOTE, tree);
    const sessions = { reviewer: crypto.randomUUID() };
    const cycle: Cycle = { card: final, base: checked, role: "reviewer", step: "land", sessions, rounds: 0, exchanges: 0, subject: "Check the plan", note: NOTE, commit: again };
    const landed = [{ card: first, commit: greeting }, { card: final, commit: checked }];
    await writeRecord(plan, { state: "Running", harness: "pi", run: { pid: await deadPid(), boot: BOOT }, cycle, landed });
    stand(["pi"]);

    const carrying = await card([], repo);
    expect(carrying.stderr).toBe("");
    expect(carrying.code).toBe(0);
    await until("the run to end or bounce", () => record(plan.dir).state !== "Running");
    expect(record(plan.dir).state).toBe("Ended");

    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan", "Check the plan"]);
    expect(record(plan.dir).landed).toEqual([...landed, { card: final, commit: again }]);
    const closed = readFileSync(path.join(deck.closedDir, `${final}.md`), "utf8");
    expect(closed.match(/^closed: .*$/gm)).toEqual(["closed: done"]);
    expect(closed).toEndWith(`## Close note\n\n${NOTE}\n`);
  },
  SLOW,
);

test(
  "a reopened final card whose run died mid-cycle reruns, carried on by bare card, keeping the account, review feedback and close note of its landed cycle and dropping the dead cycle's",
  async () => {
    const { repo, deck, plan, first, final, base } = await inCheck();
    await ensureBranch("plan/greeting", "main", repo);
    const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
    const greeting = await land("Add the greeting", "Landed.", tree);
    await closeCard(deck, first, "done", "Landed.");
    await appendRecord(deck, final, "Account", "The landed cycle's account.");
    await appendRecord(deck, final, "Review feedback", "The landed cycle's feedback.");
    await appendRecord(deck, final, "Account", "The landed cycle's revision.");
    const checked = await land("Check the plan", GUIDE, tree);
    await closeCard(deck, final, "done", GUIDE);
    // Reopened, as a join at the plan's end leaves it, and run again until the run died at a revision round.
    await reopenCard(deck, final);
    await appendRecord(deck, final, "Account", "The dead cycle's account.");
    await appendRecord(deck, final, "Review feedback", "The dead cycle's feedback.");
    const sessions = { reconciler: crypto.randomUUID(), implementer: crypto.randomUUID() };
    const cycle: Cycle = { card: final, base: checked, role: "implementer", step: "implement", sessions, rounds: 1, exchanges: 0 };
    const landed = [{ card: first, commit: greeting }, { card: final, commit: checked }];
    await writeRecord(plan, { state: "Running", harness: "pi", run: { pid: await deadPid(), boot: BOOT }, cycle, landed });
    const control = stand(["pi"]);
    queue(control, [proceed()], [done()], [approved("Check the plan")]);

    const carrying = await card([], repo);
    expect(carrying.stderr).toBe("");
    expect(carrying.code).toBe(0);
    await until("the run to end or bounce", () => record(plan.dir).state !== "Running");
    expect(record(plan.dir).state).toBe("Ended");

    expect(await subjects(repo, base)).toEqual(["Add the greeting", "Check the plan", "Check the plan"]);
    expect(readFileSync(path.join(deck.closedDir, `${final}.md`), "utf8")).toBe(
      "---\nclosed: done\n---\n\n# Check the plan\n\nBody.\n\n" +
        "## Account\n\nThe landed cycle's account.\n\n## Review feedback\n\nThe landed cycle's feedback.\n\n" +
        `## Account\n\nThe landed cycle's revision.\n\n## Close note\n\n${GUIDE}\n\n` +
        "## Account\n\nDid the work.\n\n## Close note\n\nLanded it.\n",
    );
  },
  SLOW,
);

/**
 * The table under "The plan's states and the verb surface": the verbs open in
 * each state, as the refusals print them. `decline` and `promote` are in no
 * row, being open in every state for a waiting card; `drop` is in every row.
 */
const OPEN: Record<State, string[]> = {
  Document: ["done", "drop"],
  Cards: ["join <id>", "later <id>", "done", "drop"],
  Check: ["approve", "amend", "drop"],
  Running: ["stop", "drop"],
  Bounced: ["ask", "resume", "amend", "drop"],
  Stopped: ["resume", "amend", "drop"],
  Dead: ["stop", "drop"],
  Ended: ["later <id>", "join <id>", "finish", "drop"],
};
const VERBS = ["done", "approve", "amend", "stop", "ask", "resume", "join", "later", "decline", "promote", "finish", "drop"];

/**
 * The states whose bare `card` prints a prompt for the session, which names
 * its own commands. Every other state's bare `card` reports on the run, and
 * that report ends with the commands open once it is printed.
 */
const PROMPTED: State[] = ["Document", "Cards", "Check", "Ended"];

/** The commands open in `state` under `command`, bare `card` among them, sorted, since the table sets no order. */
function opened(command: string, state: State): string[] {
  return [command, ...OPEN[state].map((verb) => `${command} ${verb}`)].sort();
}

/**
 * Asserts that every verb the table leaves closed in `state` refuses, naming
 * the plan's state and printing the commands open in it, that `decline` and
 * `promote` reach the waiting card, as only an open verb does, and that none
 * of it changed the plan's state file.
 */
async function closedIn(repo: string, dir: string, state: State, waiting: string): Promise<void> {
  const before = readFileSync(path.join(dir, "state.json"), "utf8");
  for (const verb of VERBS.filter((verb) => !["decline", "promote"].includes(verb))) {
    if (OPEN[state].some((open) => open.split(" ")[0] === verb)) continue;
    const result = await card([verb], repo);
    expect(result.code).not.toBe(0);
    const [first, ...lines] = result.stderr.trimEnd().split("\n");
    expect(first).toBe(`card: \`card ${verb}\` is not open while the plan \`${path.basename(dir)}\` is in ${state}, where these commands are open:`);
    expect(lines.map((line) => line.trim()).sort()).toEqual(opened("card", state));
  }
  // With nothing on stdin each refuses only once it has the waiting card in hand.
  expect((await card(["decline", waiting], repo)).stderr).toBe(`card: \`card decline ${waiting}\` needs the owner's reason on stdin, which becomes its close note\n`);
  expect((await card(["promote", waiting], repo)).stderr).toBe(`card: \`card promote ${waiting}\` needs the session's draft on stdin, which is printed for the owner to post\n`);
  expect(readFileSync(path.join(dir, "state.json"), "utf8")).toBe(before);
}

test(
  "one plan walked through every state of the table, through the executable: bare card does what each row says, every report of the run ends with the commands open once it is printed, and every verb not open there refuses, naming the state and the commands open in it",
  async () => {
    const repo = await tempRepo();
    const deck = await createDeck(repo, "proj");
    // Bare `card` in each state of the run, with the state the plan is in once it has printed.
    const reports = new Map<State, { stdout: string; after: State }>();
    const report = async (state: State) => {
      const result = await card([], repo);
      reports.set(state, { stdout: result.stdout, after: (await stateOf(deck)) as State });
      return result;
    };
    const waiting = await fileCard(deck, { labels: [], blockedBy: [], headline: "A thought put down earlier", body: "Body.\n" });
    const control = stand(["pi"]);
    const question = "The card calls `greet()`, which nothing defines; should this card build it?";
    const guide = "The greeting plan is done: run `cat hello.txt` in the worktree and see hello.";
    queue(
      control,
      [{ answer: JSON.stringify({ outcome: "stop", cause: "order", question }), run: hold(control, "running") }, proceed()],
      [done(hold(control, "stopping"))],
      [proceed()],
      [done(hold(control, "dying"))],
      [proceed(hold(control, "carried"))],
      [done("printf 'hello\\n' > hello.txt")],
      [approved("Add the greeting")],
      [proceed()],
      [done()],
      [{ answer: JSON.stringify({ outcome: "approved", subject: "Check the plan", close_note: guide }) }],
    );

    // Starting: the waiting card with decline and promote, then the Document stage's prompt.
    const starting = await card([], repo);
    expect(starting.code).toBe(0);
    expect(starting.stdout).toContain(`  card decline ${waiting}\n  card promote ${waiting}\n`);
    const [draft] = await listPlans(deck);
    const documentPrompt = wrapPayload("card", fill(documentStage, { CARD: "card", PLAN_DOCUMENT: draft!.document }));
    expect(starting.stdout).toEndWith(documentPrompt);

    // Document.
    expect(await card([], repo)).toEqual({ code: 0, stdout: documentPrompt, stderr: "" });
    await closedIn(repo, draft!.dir, "Document", waiting);
    await Bun.write(draft!.document, `---\nbranch: plan/greeting\nstart-point: main\n---\n\n# Greeting\n\n${DOCUMENT_BODY}\n`);
    expect((await card(["done"], repo)).code).toBe(0);

    // Cards.
    const [plan] = await listPlans(deck);
    expect(plan!.slug).toBe("greeting");
    const drafting = await card([], repo);
    expect(drafting.stdout).toContain("# The Cards stage");
    expect(drafting.stdout).toContain(deck.deckDir);
    expect(drafting.stdout).toContain(`${waiting}  A thought put down earlier\n  card join ${waiting}\n  card later ${waiting}\n`);
    await closedIn(repo, plan!.dir, "Cards", waiting);
    await Bun.write(path.join(plan!.cardsDir, "01-add-the-greeting.md"), "# Add the greeting\n\nBody.\n");
    await Bun.write(path.join(plan!.cardsDir, "02-check-the-plan.md"), "# Check the plan\n\nBody.\n");
    expect((await card(["done"], repo)).code).toBe(0);

    // Check.
    const [first, final] = record(plan!.dir).cards as [string, string];
    const checking = await card([], repo);
    expect(checking.stdout).toContain("# The Check stage");
    expect(checking.stdout).toContain(`${first}  Add the greeting\n`);
    expect(checking.stdout).toContain(`${final}  Check the plan  (final card)\n`);
    await closedIn(repo, plan!.dir, "Check", waiting);
    expect((await card(["approve"], repo)).code).toBe(0);

    // Running, the reconciler held.
    await until("the first reconciler to start", () => existsSync(path.join(control, "running.started")));
    const running = `The plan \`greeting\`'s run is at this card, with the reconciler:\n\n${first}  Add the greeting\n\n0 of the plan's 2 cards have closed.\n${openList("Running")}`;
    expect(await report("Running")).toEqual({ code: 0, stdout: forOwner(running), stderr: "" });
    await closedIn(repo, plan!.dir, "Running", waiting);
    release(control, "running");

    // Bounced, by the reconciler's stop.
    await until("the plan to bounce", () => record(plan!.dir).state === "Bounced");
    const tree = path.join(repo, ".worktrees", "greeting");
    const { bounce } = record(plan!.dir);
    const bouncing = bouncedReport(first, "reconciler", bounce!.cause, `cd '${tree}' && pi --session-id ${bounce!.session.id}`, question);
    expect(await report("Bounced")).toEqual({ code: 0, stdout: forOwner(bouncing), stderr: "" });
    await closedIn(repo, plan!.dir, "Bounced", waiting);
    expect((await card(["resume"], repo, `${OWNER_ANSWER}\n`)).code).toBe(0);

    // Stopped, by `card stop` while the implementer works.
    await until("the implementer to start", () => existsSync(path.join(control, "stopping.started")));
    expect(await card(["stop"], repo)).toEqual({ code: 0, stdout: forOwner(stoppedReport(first)), stderr: "" });
    expect(await report("Stopped")).toEqual({ code: 0, stdout: forOwner(stoppedReport(first)), stderr: "" });
    await closedIn(repo, plan!.dir, "Stopped", waiting);
    expect((await card(["resume"], repo)).code).toBe(0);

    // Dead, the run killed with its role while the next implementer works.
    await until("the rerun's implementer to start", () => existsSync(path.join(control, "dying.started")));
    process.kill(-record(plan!.dir).run!.pid, "SIGKILL");
    for (const deadline = Date.now() + 5_000; (await stateOf(deck)) !== "Dead"; await Bun.sleep(50)) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the run to read as Dead");
    }
    await closedIn(repo, plan!.dir, "Dead", waiting);
    const log = path.join(plan!.dir, "run.log");
    // Carried on, the plan is Running, so the commands are Running's.
    const carried = `The plan \`greeting\`'s run had died; it is carried on, on pi, in ${tree}; its log is ${log}.\n${openList("Running")}`;
    expect(await report("Dead")).toEqual({ code: 0, stdout: forOwner(carried), stderr: "" });
    await until("the carried-on reconciler to start", () => existsSync(path.join(control, "carried.started")));
    expect(await stateOf(deck)).toBe("Running");
    release(control, "carried");

    // Ended.
    await until("the plan to end", () => record(plan!.dir).state === "Ended");
    expect(await card([], repo)).toEqual({ code: 0, stdout: ended(plan!, final, tree, `${guide}\n`), stderr: "" });
    await closedIn(repo, plan!.dir, "Ended", waiting);

    // Every state of the run was walked, and its report ends, inside the owner marks, with the commands open once it printed.
    for (const state of (Object.keys(OPEN) as State[]).filter((state) => !PROMPTED.includes(state))) {
      const walked = reports.get(state);
      expect(walked).toBeDefined();
      expect(walked!.stdout).toEndWith(`${openList(walked!.after)}</for_owner>\n`);
    }

    // Over: the worktree gone, the branch kept, and no plan left in progress.
    const finishing = await card(["finish"], repo);
    expect(finishing).toEqual({
      code: 0,
      stdout: forOwner(`The plan \`greeting\` is finished: its worktree ${tree} is removed, and its branch \`plan/greeting\` is kept, for the owner to land.\n`),
      stderr: "",
    });
    expect(await listPlans(deck)).toEqual([]);
    expect(existsSync(tree)).toBe(false);
    expect(await branchExists("plan/greeting", repo)).toBe(true);
    expect((await waitingCards(deck)).map(({ id }) => id)).toEqual([waiting]);
  },
  4 * SLOW,
);

test("a second plan started with --plan while the first is in Check: bare card lists both with their states for the owner, then every command with its --plan right after the word card", async () => {
  const { repo, deck } = await inCheck();
  const starting = await card(["--plan", "second"], repo);
  expect(starting.code).toBe(0);
  expect(starting.stdout).toContain("run `card --plan second done`");
  expect((await listPlans(deck)).map(({ slug, state }) => `${slug} ${state}`)).toEqual(["greeting Check", "second Document"]);

  const listing = await card([], repo);
  expect(listing.code).toBe(0);
  const marked = forOwner("More than one plan is in progress:\n\ngreeting  Check\nsecond  Document\n");
  expect(listing.stdout.startsWith(marked)).toBe(true);
  const [head, ...blocks] = listing.stdout.slice(marked.length).split("\n\n");
  expect(head).toBe("\nThe commands open in each plan, every one naming its plan:");
  const commands = blocks.map((block) => block.trimEnd().split("\n").map((line) => line.trim()).sort());
  expect(commands).toEqual([opened("card --plan greeting", "Check"), opened("card --plan second", "Document")]);

  // A verb not open in the plan it names is refused with that plan's commands, under its --plan.
  const refused = await card(["--plan", "greeting", "done"], repo);
  expect(refused.code).not.toBe(0);
  const [first, ...lines] = refused.stderr.trimEnd().split("\n");
  expect(first).toBe("card: `card --plan greeting done` is not open while the plan `greeting` is in Check, where these commands are open:");
  expect(lines.map((line) => line.trim()).sort()).toEqual(opened("card --plan greeting", "Check"));
});
