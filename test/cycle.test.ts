import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { EXCHANGES, ID_RETURNS, RECONCILER, REVISION_ROUNDS, runCard } from "../src/cycle.ts";
import { createDeck, type Deck } from "../src/deck.ts";
import { gitOrThrow, headSha } from "../src/git.ts";
import { ensureBranch, holdWorktree } from "../src/landing.ts";
import { fileCard } from "../src/operations.ts";
import { bootId, listPlans, type Plan, startPlan, waitingCards, writeRecord } from "../src/plan.ts";
import { answerInstruction } from "../src/answer.ts";
import { calls, type Reply, removeTempDirs, script, stand, tempDir, tempRepo } from "./helpers.ts";

const OUTER_PATH = process.env.PATH;

// The ids the cycle draws for its sessions, handed out in order, so the
// stand-in can be scripted for each before the cycle runs: the reconciler's,
// the implementer's and the reviewer's, then a fresh reviewer's for each
// revision round, up to the cap.
let ids: string[] = [];
// What the cycle writes to the run's log.
let logged: string[] = [];
beforeEach(() => {
  ids = Array.from({ length: 6 }, () => crypto.randomUUID());
  const queue = [...ids];
  spyOn(crypto, "randomUUID").mockImplementation(() => queue.shift() as ReturnType<typeof crypto.randomUUID>);
  logged = [];
  spyOn(console, "log").mockImplementation((line: string) => logged.push(line));
});
afterEach(() => {
  mock.restore();
  process.env.PATH = OUTER_PATH;
});
afterAll(removeTempDirs);

const CONVENTION = 'the subject starts with the ticket key, as in "ABC-123 Add the export button"';
// Text only the plan document's body holds, which neither role may see.
const DOCUMENT_BODY = "The plan's intent, which only the reconciler reads.";
const CONTRACT = "Write `hello.txt` holding `hello`.\n\nDone when `hello.txt` holds `hello`.\n";
const ACCOUNT = "Wrote hello.txt with printf.\n\nNothing else needed changing.";
const SUBJECT = "ABC-123 Add the greeting";
const NOTE = "Adds hello.txt holding hello.\n\nVerified by reading the file back.";

/** A HEAD, index and status for the main checkout, which the cycle may not change. */
async function mainState(repo: string): Promise<string[]> {
  return Promise.all(
    [["symbolic-ref", "HEAD"], ["rev-parse", "HEAD"], ["ls-files", "--stage"], ["status", "--porcelain"]].map((args) =>
      gitOrThrow(args, repo),
    ),
  );
}

/**
 * A repository with a `proj` deck, a plan running one card, its document
 * carrying `frontmatter`, and the plan's branch held in its worktree; the main
 * checkout's state is taken after.
 */
async function running(frontmatter = `commit-convention: ${CONVENTION}\n`) {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  const id = await fileCard(deck, { labels: [], blockedBy: [], headline: "Add the greeting", body: CONTRACT });
  const plan = await writeRecord(await startPlan(deck, "greeting"), {
    state: "Running",
    placeholder: false,
    cards: [id],
    final: id,
    run: { pid: process.pid, boot: await bootId() },
  });
  await Bun.write(
    plan.document,
    `---\nbranch: plan/greeting\nstart-point: main\n${frontmatter}---\n\n# Greet\n\n${DOCUMENT_BODY}\n`,
  );
  await ensureBranch("plan/greeting", "main", repo);
  const tree = await holdWorktree(plan.slug, "plan/greeting", repo);
  return { repo, deck, plan, id, tree, base: await headSha(tree), before: await mainState(repo) };
}

const answer = (fields: Record<string, string>, run?: string): Reply => ({ stdout: JSON.stringify(fields), run });
const AMENDED = "Nothing needed changing.";
const proceed = (run?: string) => answer({ outcome: "proceed", amended: AMENDED }, run);
const QUESTION = "The card calls `greet()`, which nothing in the worktree defines; which card should build it?";
const stop = (run?: string) => answer({ outcome: "stop", cause: "order", question: QUESTION }, run);
const done = (run?: string) => answer({ outcome: "done", account: ACCOUNT }, run);
const approved = (run?: string) => answer({ outcome: "approved", subject: SUBJECT, close_note: NOTE }, run);
const FEEDBACK = "The card asks for hello.txt holding `hello`, and it holds `helo`.\n\nSpell the greeting as the card does.";
const revision = (feedback = FEEDBACK, run?: string) => answer({ outcome: "revision", feedback }, run);
const REVISED = "Respelt the greeting as the feedback asked.";
const revised = (run?: string) => answer({ outcome: "done", account: REVISED }, run);

/**
 * Scripts each role's calls, the reconciler proceeding unless told otherwise
 * and each revision round's reviewer in `later`, and runs the cycle on Pi's
 * stand-in.
 */
async function cycle(
  deck: Deck,
  plan: Plan,
  id: string,
  tree: string,
  implementer: Reply[],
  reviewer: Reply[],
  reconciler: Reply[] = [proceed()],
  later: Reply[][] = [],
) {
  const control = stand();
  script(control, ids[0]!, ...reconciler);
  script(control, ids[1]!, ...implementer);
  script(control, ids[2]!, ...reviewer);
  later.forEach((replies, round) => script(control, ids[3 + round]!, ...replies));
  const ended = await runCard(deck, plan, id, tree, "pi");
  return { control, ended };
}

/** The commit's message exactly as git holds it. */
async function message(tree: string, commit = "HEAD"): Promise<string> {
  const raw = await gitOrThrow(["cat-file", "commit", commit], tree);
  return raw.slice(raw.indexOf("\n\n") + 2);
}

async function changed(tree: string): Promise<string[]> {
  return (await gitOrThrow(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], tree)).split("\n").filter(Boolean);
}

test("a card runs through a fresh implementer and a fresh reviewer to one commit: the subject, a blank line and the note", async () => {
  const { repo, deck, plan, id, tree, base, before } = await running();
  const { ended } = await cycle(deck, plan, id, tree, [done("printf 'hello\\n' > hello.txt")], [approved()]);

  expect(ended.outcome).toBe("landed");
  expect(await headSha(tree)).toBe(ended.outcome === "landed" ? ended.sha : "");
  expect((await gitOrThrow(["rev-parse", "HEAD~1"], tree)).trim()).toBe(base);
  // Short paragraphs, so wrapping at 72 leaves the note as it was written.
  expect(await message(tree)).toBe(`${SUBJECT}\n\n${NOTE}\n`);
  expect(await changed(tree)).toEqual(["hello.txt"]);
  expect(await gitOrThrow(["status", "--porcelain"], tree)).toBe("");
  expect(await mainState(repo)).toEqual(before);
});

test("the card closes done with its account and close note beneath its contract", async () => {
  const { deck, plan, id, tree } = await running();
  await cycle(deck, plan, id, tree, [done("printf 'hello\\n' > hello.txt")], [approved()]);

  expect(existsSync(path.join(deck.openDir, `${id}.md`))).toBe(false);
  expect(readFileSync(path.join(deck.closedDir, `${id}.md`), "utf8")).toBe(
    `---\nclosed: done\n---\n\n# Add the greeting\n\n${CONTRACT}\n## Account\n\n${ACCOUNT}\n\n## Close note\n\n${NOTE}\n`,
  );
});

test("each role is launched fresh under its own id, which the plan's record holds beside the card's commit", async () => {
  const { deck, plan, id, tree } = await running();
  const { control, ended } = await cycle(deck, plan, id, tree, [done()], [approved()]);

  const [reconciler, implementer, reviewer] = ids;
  expect(new Set(ids).size).toBe(ids.length);
  for (const session of ids.slice(0, 3)) {
    const [only, ...more] = calls(control, session!);
    expect(more).toEqual([]);
    expect(only!.argv).toEqual(["pi", "-p", "--session-id", session!]);
    expect(only!.cwd).toBe(tree);
  }
  const record = (await listPlans(deck))[0]!.cycle;
  const commit = ended.outcome === "landed" ? ended.sha : "";
  expect(record).toEqual({
    card: id,
    base: record!.base,
    role: "reviewer",
    step: "land",
    sessions: { reconciler, implementer, reviewer },
    rounds: 0,
    exchanges: 0,
    subject: SUBJECT,
    note: NOTE,
    commit,
  });
  expect(ended.plan.cycle).toEqual(record);
});

test("neither the implementer nor the reviewer sees the plan document, and the reviewer gets the card with the account, the diff and the convention", async () => {
  const { deck, plan, id, tree } = await running();
  const { control } = await cycle(deck, plan, id, tree, [done("printf 'hello\\n' > hello.txt")], [approved()]);

  const implementer = calls(control, ids[1]!)[0]!.stdin;
  const reviewer = calls(control, ids[2]!)[0]!.stdin;
  for (const stdin of [implementer, reviewer]) {
    expect(stdin).not.toContain(DOCUMENT_BODY);
    expect(stdin).not.toContain(plan.document);
    expect(stdin).not.toContain("{{");
    expect(stdin).toContain(CONTRACT);
  }
  expect(implementer).not.toContain(ACCOUNT);
  expect(reviewer).toContain(`## Account\n\n${ACCOUNT}\n`);
  expect(reviewer).toContain("+++ b/hello.txt\n@@ -0,0 +1 @@\n+hello\n");
  expect(reviewer).toContain(CONVENTION);
});

test("where the plan document records no commit convention, the reviewer is told none was recorded", async () => {
  const { deck, plan, id, tree } = await running("");
  const { control } = await cycle(deck, plan, id, tree, [done()], [approved()]);

  expect(calls(control, ids[2]!)[0]!.stdin).toContain("    (none)\n");
});

test("an implementer that changed nothing still lands the card, as an empty commit", async () => {
  const { deck, plan, id, tree, base } = await running();
  const { ended } = await cycle(deck, plan, id, tree, [done()], [approved()]);

  expect(ended.outcome).toBe("landed");
  expect((await gitOrThrow(["rev-parse", "HEAD~1"], tree)).trim()).toBe(base);
  expect(await changed(tree)).toEqual([]);
  expect(await message(tree)).toBe(`${SUBJECT}\n\n${NOTE}\n`);
});

test("an implementer's own commit is undone, shown to the reviewer as uncommitted, and folded into the card's one commit", async () => {
  const { deck, plan, id, tree, base } = await running();
  const habit = "printf 'hello\\n' > hello.txt && git add hello.txt && git commit -q -m 'out of habit'";
  const { control } = await cycle(deck, plan, id, tree, [done(habit)], [approved()]);

  expect(calls(control, ids[2]!)[0]!.stdin).toContain("+++ b/hello.txt\n@@ -0,0 +1 @@\n+hello\n");
  expect((await gitOrThrow(["rev-parse", "HEAD~1"], tree)).trim()).toBe(base);
  expect(await changed(tree)).toEqual(["hello.txt"]);
  expect(await message(tree)).toBe(`${SUBJECT}\n\n${NOTE}\n`);
});

test("a reviewer's fixes in place land in the card's one commit, with no second review", async () => {
  const { deck, plan, id, tree, base } = await running();
  const fixed = answer({ outcome: "fixed", subject: SUBJECT, close_note: NOTE }, "printf 'hello, fixed\\n' > hello.txt");
  const { control } = await cycle(deck, plan, id, tree, [done("printf 'hello\\n' > hello.txt")], [fixed]);

  expect(calls(control, ids[2]!)).toHaveLength(1);
  expect((await gitOrThrow(["rev-parse", "HEAD~1"], tree)).trim()).toBe(base);
  expect(await gitOrThrow(["show", "HEAD:hello.txt"], tree)).toBe("hello, fixed\n");
});

test("an account with a line starting `# ` draws the repair prompt, and the repaired account is the one appended", async () => {
  const { deck, plan, id, tree } = await running();
  const headed = answer({ outcome: "done", account: `# What I did\n\n${ACCOUNT}` });
  const { control, ended } = await cycle(deck, plan, id, tree, [headed, done()], [approved()]);

  expect(ended.outcome).toBe("landed");
  const [, repair] = calls(control, ids[1]!);
  expect(repair!.stdin).toContain("The previous report was invalid:\nanswer.account has a line starting `# `");
  expect(readFileSync(path.join(deck.closedDir, `${id}.md`), "utf8")).toContain(`## Account\n\n${ACCOUNT}\n`);
});

test("a subject or a close note with a line starting `# ` draws the repair prompt", async () => {
  const { deck, plan, id, tree } = await running();
  const headed = answer({ outcome: "approved", subject: SUBJECT, close_note: `# Landed\n\n${NOTE}` });
  const { control } = await cycle(deck, plan, id, tree, [done()], [headed, approved()]);

  const [, repair] = calls(control, ids[2]!);
  expect(repair!.stdin).toContain("The previous report was invalid:\nanswer.close_note has a line starting `# `");
  expect(await message(tree)).toBe(`${SUBJECT}\n\n${NOTE}\n`);
});

test("an implementer that fails stops the cycle at its step, with the cause and the session, and lands nothing", async () => {
  const { repo, deck, plan, id, tree, base, before } = await running();
  const { control, ended } = await cycle(deck, plan, id, tree, [{ stderr: "usage limit reached\n", exit: 1 }], []);

  expect(ended.outcome).toBe("stopped");
  if (ended.outcome !== "stopped") return;
  expect(ended.role).toBe("implementer");
  expect(ended.session).toEqual({ harness: "pi", id: ids[1]!, dir: tree });
  expect(ended.cause).toContain("usage limit reached");
  const sessions = { reconciler: ids[0], implementer: ids[1] };
  expect(ended.plan.cycle).toEqual({ card: id, base, role: "implementer", step: "implement", sessions, rounds: 0, exchanges: 0 });
  expect((await listPlans(deck))[0]!.cycle).toEqual(ended.plan.cycle);
  expect(existsSync(path.join(control, ids[2]!, "calls"))).toBe(false);
  expect(await headSha(tree)).toBe(base);
  expect(existsSync(path.join(deck.openDir, `${id}.md`))).toBe(true);
  expect(await mainState(repo)).toEqual(before);
});

test("a reviewer that fails stops the cycle at review, the account appended and the work left uncommitted", async () => {
  const { deck, plan, id, tree, base } = await running();
  const malformed = { stdout: "not JSON" };
  const { ended } = await cycle(deck, plan, id, tree, [done("printf 'hello\\n' > hello.txt")], [malformed, malformed, malformed]);

  expect(ended.outcome).toBe("stopped");
  if (ended.outcome !== "stopped") return;
  expect(ended.role).toBe("reviewer");
  expect(ended.session.id).toBe(ids[2]!);
  expect(ended.cause).toContain("still malformed after 2 repair prompts");
  expect(ended.plan.cycle).toEqual({
    card: id,
    base,
    role: "reviewer",
    step: "review",
    sessions: { reconciler: ids[0], implementer: ids[1], reviewer: ids[2] },
    rounds: 0,
    exchanges: 0,
  });
  expect(await headSha(tree)).toBe(base);
  expect(await gitOrThrow(["status", "--porcelain"], tree)).toBe("?? hello.txt\n");
  expect(readFileSync(path.join(deck.openDir, `${id}.md`), "utf8")).toContain(`## Account\n\n${ACCOUNT}\n`);
});

test("each card's first launch is a reconciler in the worktree, given the plan document and the card with the paths it edits them at", async () => {
  const { deck, plan, id, tree } = await running();
  const marks = tempDir();
  const first = `touch '${marks}/reconciled'`;
  const after = `[ -e '${marks}/reconciled' ] && touch '${marks}/implemented-after'`;
  const { control } = await cycle(deck, plan, id, tree, [done(after)], [approved()], [proceed(first)]);

  expect(existsSync(path.join(marks, "implemented-after"))).toBe(true);
  const [only, ...more] = calls(control, ids[0]!);
  expect(more).toEqual([]);
  expect(only!.argv).toEqual(["pi", "-p", "--session-id", ids[0]!]);
  expect(only!.cwd).toBe(tree);
  expect(only!.stdin).toStartWith("# Reconciling one card\n");
  expect(only!.stdin).toContain(`<card>\n# Add the greeting\n\n${CONTRACT}</card>\n`);
  expect(only!.stdin).toContain(`\`${path.join(deck.openDir, `${id}.md`)}\``);
  expect(only!.stdin).toContain(DOCUMENT_BODY);
  expect(only!.stdin).toContain(`\`${plan.document}\``);
  expect(only!.stdin).toContain(CONVENTION);
  expect(only!.stdin).not.toContain("{{");
  expect(only!.stdin).toEndWith(`\n\n${answerInstruction(RECONCILER)}`);
  expect(logged).toEqual([`${id}: the reconciler proceeded: ${AMENDED}`]);
});

test("a contract the reconciler amended in the card's file reaches the implementer and the reviewer, and closes with the card", async () => {
  const { deck, plan, id, tree } = await running();
  const amend = `sed -i 's/hello\\.txt/greeting.txt/g' '${path.join(deck.openDir, `${id}.md`)}'`;
  const amended = CONTRACT.replaceAll("hello.txt", "greeting.txt");
  const { control, ended } = await cycle(deck, plan, id, tree, [done("printf 'hello\\n' > greeting.txt")], [approved()], [proceed(amend)]);

  expect(ended.outcome).toBe("landed");
  for (const session of [ids[1]!, ids[2]!]) {
    const stdin = calls(control, session)[0]!.stdin;
    expect(stdin).toContain(amended);
    expect(stdin).not.toContain(CONTRACT);
  }
  expect(readFileSync(path.join(deck.closedDir, `${id}.md`), "utf8")).toContain(`# Add the greeting\n\n${amended}\n## Account\n`);
});

test("a reconciler that stops ends the cycle stopped with its cause and question, launching no implementer and landing nothing", async () => {
  const { repo, deck, plan, id, tree, base, before } = await running();
  const { control, ended } = await cycle(deck, plan, id, tree, [done()], [approved()], [stop()]);

  expect(ended.outcome).toBe("stopped");
  if (ended.outcome !== "stopped") return;
  expect(ended.role).toBe("reconciler");
  expect(ended.session).toEqual({ harness: "pi", id: ids[0]!, dir: tree });
  expect(ended.cause).toBe("the card depends on work no earlier card has landed, a problem of order for authoring to fix");
  expect(ended.question).toBe(QUESTION);
  expect(ended.plan.cycle).toEqual({ card: id, base, role: "reconciler", step: "reconcile", sessions: { reconciler: ids[0] }, rounds: 0, exchanges: 0 });
  expect((await listPlans(deck))[0]!.cycle).toEqual(ended.plan.cycle);
  for (const session of [ids[1]!, ids[2]!]) expect(existsSync(path.join(control, session, "calls"))).toBe(false);
  expect(await headSha(tree)).toBe(base);
  expect(existsSync(path.join(deck.openDir, `${id}.md`))).toBe(true);
  expect(await mainState(repo)).toEqual(before);
  expect(logged).toEqual([]);
});

test("a reconciler's answer lacking a field its outcome carries draws the repair prompt", async () => {
  const { deck, plan, id, tree } = await running();
  const bare = answer({ outcome: "stop", cause: "intent" });
  const { control, ended } = await cycle(deck, plan, id, tree, [], [], [bare, stop()]);

  const [, repair] = calls(control, ids[0]!);
  expect(repair!.stdin).toContain('The previous report was invalid:\nanswer lacks the field "question", which outcome "stop" carries');
  expect(ended.outcome === "stopped" && ended.question).toBe(QUESTION);
});

test("a reconciler that fails stops the cycle at reconcile, with its cause and session", async () => {
  const { deck, plan, id, tree, base } = await running();
  const { ended } = await cycle(deck, plan, id, tree, [], [], [{ stderr: "usage limit reached\n", exit: 1 }]);

  expect(ended.outcome).toBe("stopped");
  if (ended.outcome !== "stopped") return;
  expect(ended.role).toBe("reconciler");
  expect(ended.session.id).toBe(ids[0]!);
  expect(ended.cause).toContain("usage limit reached");
  expect(ended.question).toBeUndefined();
  expect(ended.plan.cycle).toEqual({ card: id, base, role: "reconciler", step: "reconcile", sessions: { reconciler: ids[0] }, rounds: 0, exchanges: 0 });
});

/** The card's file, open or closed. */
function cardFile(deck: Deck, id: string): string {
  const open = path.join(deck.openDir, `${id}.md`);
  return readFileSync(existsSync(open) ? open : path.join(deck.closedDir, `${id}.md`), "utf8");
}

const MISSPELT = "printf 'helo\\n' > hello.txt";
// Run by the resumed implementer, so it respells only the work it left.
const RESPELT = "[ \"$(cat hello.txt)\" = helo ] && printf 'hello\\n' > hello.txt";

test("a revision answer leaves its feedback under `## Review feedback`, between the account it reviewed and the revision's", async () => {
  const { deck, plan, id, tree } = await running();
  await cycle(deck, plan, id, tree, [done(MISSPELT), revised(RESPELT)], [revision()], [proceed()], [[approved()]]);

  expect(cardFile(deck, id)).toBe(
    `---\nclosed: done\n---\n\n# Add the greeting\n\n${CONTRACT}\n## Account\n\n${ACCOUNT}\n\n## Review feedback\n\n${FEEDBACK}\n\n## Account\n\n${REVISED}\n\n## Close note\n\n${NOTE}\n`,
  );
});

test("a revision resumes the implementer under its recorded id, carrying the feedback, on the work as it left it", async () => {
  const { deck, plan, id, tree } = await running();
  const { control } = await cycle(deck, plan, id, tree, [done(MISSPELT), revised(RESPELT)], [revision()], [proceed()], [[approved()]]);

  const [, resumed, ...more] = calls(control, ids[1]!);
  expect(more).toEqual([]);
  expect(resumed!.argv).toEqual(["pi", "-p", "--session-id", ids[1]!]);
  expect(resumed!.cwd).toBe(tree);
  expect(resumed!.stdin).toStartWith("# Revising one card\n");
  expect(resumed!.stdin).toContain(`<feedback>\n${FEEDBACK}\n</feedback>\n`);
  expect(resumed!.stdin).not.toContain("{{");
  expect(await gitOrThrow(["show", "HEAD:hello.txt"], tree)).toBe("hello\n");
});

test("each round's review runs under a fresh reviewer, which reads the earlier feedback and the revision's account, and sees the whole work's diff", async () => {
  const { deck, plan, id, tree } = await running();
  const { control, ended } = await cycle(deck, plan, id, tree, [done(MISSPELT), revised(RESPELT)], [revision()], [proceed()], [[approved()]]);

  for (const session of [ids[2]!, ids[3]!]) {
    const [only, ...more] = calls(control, session);
    expect(more).toEqual([]);
    expect(only!.argv).toEqual(["pi", "-p", "--session-id", session]);
  }
  const second = calls(control, ids[3]!)[0]!.stdin;
  expect(second).toContain(`## Account\n\n${ACCOUNT}\n\n## Review feedback\n\n${FEEDBACK}\n\n## Account\n\n${REVISED}\n</card>`);
  expect(second).toContain("+++ b/hello.txt\n@@ -0,0 +1 @@\n+hello\n");
  const record = (await listPlans(deck))[0]!.cycle;
  expect(record?.sessions).toEqual({ reconciler: ids[0], implementer: ids[1], reviewer: ids[3] });
  expect(ended.plan.cycle).toEqual(record);
});

test("after a revision round, one commit lands on approval, holding the revised work", async () => {
  const { deck, plan, id, tree, base } = await running();
  const { ended } = await cycle(deck, plan, id, tree, [done(MISSPELT), revised(RESPELT)], [revision()], [proceed()], [[approved()]]);

  expect(ended.outcome).toBe("landed");
  expect(await headSha(tree)).toBe(ended.outcome === "landed" ? ended.sha : "");
  expect((await gitOrThrow(["rev-parse", "HEAD~1"], tree)).trim()).toBe(base);
  expect(await changed(tree)).toEqual(["hello.txt"]);
  expect(await gitOrThrow(["show", "HEAD:hello.txt"], tree)).toBe("hello\n");
  expect(await message(tree)).toBe(`${SUBJECT}\n\n${NOTE}\n`);
  expect(await gitOrThrow(["status", "--porcelain"], tree)).toBe("");
});

test("a revision round launches no reconciler, nor any session but the implementer resumed and a fresh reviewer", async () => {
  const { deck, plan, id, tree } = await running();
  const { control } = await cycle(deck, plan, id, tree, [done(MISSPELT), revised(RESPELT)], [revision()], [proceed()], [[approved()]]);

  expect(calls(control, ids[0]!)).toHaveLength(1);
  expect(calls(control, ids[1]!)).toHaveLength(2);
  expect(calls(control, ids[3]!)).toHaveLength(1);
  expect(readdirSync(control).sort()).toEqual(ids.slice(0, 4).sort());
  expect(logged).toEqual([`${id}: the reconciler proceeded: ${AMENDED}`]);
});

test(`past ${REVISION_ROUNDS} revision rounds, a reviewer asking for another stops the cycle at review, with its feedback and its session, and lands nothing`, async () => {
  const { deck, plan, id, tree, base } = await running();
  const feedback = (round: number) => `Round ${round}: hello.txt still holds \`helo\`.`;
  const implementer = [done(MISSPELT), revised(), revised(), revised()];
  const later = [2, 3, 4].map((round) => [revision(feedback(round))]);
  const { control, ended } = await cycle(deck, plan, id, tree, implementer, [revision(feedback(1))], [proceed()], later);

  expect(REVISION_ROUNDS).toBe(3);
  expect(calls(control, ids[1]!)).toHaveLength(1 + REVISION_ROUNDS);
  expect(ended.outcome).toBe("stopped");
  if (ended.outcome !== "stopped") return;
  expect(ended.role).toBe("reviewer");
  expect(ended.session).toEqual({ harness: "pi", id: ids[5]!, dir: tree });
  expect(ended.cause).toBe(`the reviewer still asked for a revision after ${REVISION_ROUNDS} revision rounds, the most a card gets`);
  expect(ended.feedback).toBe(feedback(4));
  expect(ended.question).toBeUndefined();
  expect(ended.plan.cycle).toEqual({
    card: id,
    base,
    role: "reviewer",
    step: "review",
    sessions: { reconciler: ids[0], implementer: ids[1], reviewer: ids[5] },
    rounds: REVISION_ROUNDS,
    exchanges: 0,
  });
  expect(await headSha(tree)).toBe(base);
  expect(await gitOrThrow(["status", "--porcelain"], tree)).toBe("?? hello.txt\n");
  expect(cardFile(deck, id).match(/^## Review feedback$/gm)).toHaveLength(4);
  expect(cardFile(deck, id)).toEndWith(`## Review feedback\n\n${feedback(4)}\n`);
  expect(existsSync(path.join(deck.openDir, `${id}.md`))).toBe(true);
});

test("feedback with a line starting `# ` draws the repair prompt, and a revision lacking feedback does too", async () => {
  const { deck, plan, id, tree } = await running();
  const headed = revision(`# Findings\n\n${FEEDBACK}`);
  const bare = answer({ outcome: "revision" });
  const reviewer = [headed, bare, revision()];
  const { control } = await cycle(deck, plan, id, tree, [done(MISSPELT), revised(RESPELT)], reviewer, [proceed()], [[approved()]]);

  const [, first, second] = calls(control, ids[2]!);
  expect(first!.stdin).toContain("The previous report was invalid:\nanswer.feedback has a line starting `# `");
  expect(second!.stdin).toContain('The previous report was invalid:\nanswer lacks the field "feedback", which outcome "revision" carries');
  expect(cardFile(deck, id)).toContain(`## Review feedback\n\n${FEEDBACK}\n\n## Account\n`);
});

const FINDING = "The card's done-condition reads `greeting.txt`, which nothing in the card writes: it asks for `hello.txt` alone.";
const blocked = (run?: string) => answer({ outcome: "blocked", finding: FINDING }, run);
const REPLY = "The card asks for hello.txt alone; read its done-condition as naming that file.";
const reply = (run?: string) => answer({ outcome: "reply", reply: REPLY }, run);
const AMENDMENT = "The card now writes and checks greeting.txt alone.";
const amending = (run?: string) => answer({ outcome: "amended", amended: AMENDMENT }, run);
const DISAGREEMENT = "The implementer and I still disagree on which file the card writes; which does the plan mean?";
const disagreed = answer({ outcome: "stop", cause: "disagreement", question: DISAGREEMENT });

/** Scripts each session the cycle draws, in the order it draws their ids, and runs the cycle on Pi's stand-in. */
async function drawn(deck: Deck, plan: Plan, id: string, tree: string, ...sessions: Reply[][]) {
  const control = stand();
  sessions.forEach((replies, index) => script(control, ids[index]!, ...replies));
  return { control, ended: await runCard(deck, plan, id, tree, "pi") };
}

test("an implementer's blocked answer resumes the reconciler under its recorded id, carrying the finding, and the record has the reconciler conversing", async () => {
  const { deck, plan, id, tree, base } = await running();
  const { control, ended } = await drawn(deck, plan, id, tree, [proceed(), stop()], [blocked()]);

  expect(calls(control, ids[1]!)[0]!.stdin).toContain('"enum":["done","blocked"]');
  const [, conversing, ...more] = calls(control, ids[0]!);
  expect(more).toEqual([]);
  expect(conversing!.argv).toEqual(["pi", "-p", "--session-id", ids[0]!]);
  expect(conversing!.cwd).toBe(tree);
  expect(conversing!.stdin).toStartWith("# Answering a blocking finding\n");
  expect(conversing!.stdin).toContain(`<finding>\n${FINDING}\n</finding>\n`);
  expect(conversing!.stdin).not.toContain("{{");
  expect(ended.outcome).toBe("stopped");
  if (ended.outcome !== "stopped") return;
  expect(ended.role).toBe("reconciler");
  expect(ended.session).toEqual({ harness: "pi", id: ids[0]!, dir: tree });
  expect(ended.question).toBe(QUESTION);
  const sessions = { reconciler: ids[0], implementer: ids[1] };
  expect(ended.plan.cycle).toEqual({ card: id, base, role: "reconciler", step: "converse", sessions, rounds: 0, exchanges: 1 });
  expect((await listPlans(deck))[0]!.cycle).toEqual(ended.plan.cycle);
  expect(existsSync(path.join(control, ids[2]!, "calls"))).toBe(false);
});

test("an amendment discards the implementer's work back to the cycle's base, and a fresh implementer builds the amended card with no second reconciling", async () => {
  const { deck, plan, id, tree, base } = await running();
  const marks = tempDir();
  const partway = "printf 'stray\\n' > stray.txt; printf 'more\\n' >> README.md; git commit -qam habit";
  const amend = `sed -i 's/hello\\.txt/greeting.txt/g' '${path.join(deck.openDir, `${id}.md`)}'`;
  const afresh = `{ git rev-parse HEAD; git status --porcelain; } > '${marks}/seen'; printf 'hello\\n' > greeting.txt`;
  const { control, ended } = await drawn(deck, plan, id, tree, [proceed(), amending(amend)], [blocked(partway)], [done(afresh)], [approved()]);

  expect(readFileSync(path.join(marks, "seen"), "utf8")).toBe(`${base}\n`);
  expect(calls(control, ids[0]!)).toHaveLength(2);
  expect(calls(control, ids[1]!)).toHaveLength(1);
  const [fresh, ...more] = calls(control, ids[2]!);
  expect(more).toEqual([]);
  expect(fresh!.argv).toEqual(["pi", "-p", "--session-id", ids[2]!]);
  expect(fresh!.stdin).toStartWith("# Implementing one card\n");
  expect(fresh!.stdin).toContain(CONTRACT.replaceAll("hello.txt", "greeting.txt"));
  expect(fresh!.stdin).not.toContain(CONTRACT);
  expect(readdirSync(control).sort()).toEqual(ids.slice(0, 4).sort());
  expect(logged).toEqual([`${id}: the reconciler proceeded: ${AMENDED}`, `${id}: the reconciler amended the card: ${AMENDMENT}`]);
  expect(ended.outcome).toBe("landed");
  expect((await gitOrThrow(["rev-parse", "HEAD~1"], tree)).trim()).toBe(base);
  expect(await changed(tree)).toEqual(["greeting.txt"]);
  expect((await listPlans(deck))[0]!.cycle?.sessions).toEqual({ reconciler: ids[0], implementer: ids[2], reviewer: ids[3] });
});

test("an implementer's own commit is undone before the reconciler converses, which sees HEAD at the cycle's base and the change uncommitted", async () => {
  const { deck, plan, id, tree, base } = await running();
  const marks = tempDir();
  const habit = "printf 'more\\n' >> README.md; git commit -qam habit";
  const seeing = `{ git rev-parse HEAD; git status --porcelain; } > '${marks}/seen'`;
  await drawn(deck, plan, id, tree, [proceed(), stop(seeing)], [blocked(habit)]);

  expect(readFileSync(path.join(marks, "seen"), "utf8")).toBe(`${base}\n M README.md\n`);
});

test("a reply resumes the implementer under its own id, carrying the reply, on its work as it left it", async () => {
  const { deck, plan, id, tree } = await running();
  const finish = "[ \"$(cat hello.txt)\" = hel ] && printf 'hello\\n' > hello.txt";
  const { control, ended } = await drawn(deck, plan, id, tree, [proceed(), reply()], [blocked("printf 'hel' > hello.txt"), done(finish)], [approved()]);

  expect(calls(control, ids[0]!)).toHaveLength(2);
  const [, resumed, ...more] = calls(control, ids[1]!);
  expect(more).toEqual([]);
  expect(resumed!.argv).toEqual(["pi", "-p", "--session-id", ids[1]!]);
  expect(resumed!.cwd).toBe(tree);
  expect(resumed!.stdin).toStartWith("# Resuming after the reconciler's reply\n");
  expect(resumed!.stdin).toContain(`<reply>\n${REPLY}\n</reply>\n`);
  expect(resumed!.stdin).toContain('"enum":["done","blocked"]');
  expect(resumed!.stdin).not.toContain("{{");
  expect(ended.outcome).toBe("landed");
  expect(await gitOrThrow(["show", "HEAD:hello.txt"], tree)).toBe("hello\n");
  expect(cardFile(deck, id).match(/^## Account$/gm)).toHaveLength(1);
});

test("an implementer revising may answer blocked, which goes to the reconciler it shares the cycle with", async () => {
  const { deck, plan, id, tree } = await running();
  const { control, ended } = await drawn(deck, plan, id, tree, [proceed(), stop()], [done(MISSPELT), blocked()], [revision()]);

  const [, revising] = calls(control, ids[1]!);
  expect(revising!.stdin).toStartWith("# Revising one card\n");
  expect(revising!.stdin).toContain('"enum":["done","blocked"]');
  const [, conversing] = calls(control, ids[0]!);
  expect(conversing!.stdin).toContain(`<finding>\n${FINDING}\n</finding>\n`);
  expect(ended.outcome === "stopped" && ended.role).toBe("reconciler");
});

test(`a card gets ${EXCHANGES} exchanges counted across its implementers, and a finding past them gets the reconciler's stop for disagreement alone`, async () => {
  const { deck, plan, id, tree, base } = await running();
  const reconciler = [proceed(), amending(), reply(), reply(), disagreed];
  const { control, ended } = await drawn(deck, plan, id, tree, reconciler, [blocked()], [blocked(), blocked(), blocked()]);

  expect(EXCHANGES).toBe(3);
  const turns = calls(control, ids[0]!);
  expect(turns).toHaveLength(2 + EXCHANGES);
  for (const turn of turns.slice(1, 4)) expect(turn.stdin).toContain('"enum":["amended","reply","stop"]');
  expect(turns[4]!.stdin).toStartWith("# Answering a blocking finding\n");
  expect(turns[4]!.stdin).toContain('"enum":["stop"]');
  expect(turns[4]!.stdin).toContain('"enum":["disagreement"]');
  expect(ended.outcome).toBe("stopped");
  if (ended.outcome !== "stopped") return;
  expect(ended.role).toBe("reconciler");
  expect(ended.session).toEqual({ harness: "pi", id: ids[0]!, dir: tree });
  expect(ended.cause).toBe("the reconciler and the implementer had not agreed after 3 exchanges, the most a card gets");
  expect(ended.question).toBe(DISAGREEMENT);
  const sessions = { reconciler: ids[0], implementer: ids[2] };
  expect(ended.plan.cycle).toEqual({ card: id, base, role: "reconciler", step: "converse", sessions, rounds: 0, exchanges: EXCHANGES + 1 });
});

const FOUND = [
  { headline: "The README still names greet.sh", body: "README.md shows `greet.sh`, which no file in the tree is.\n\nNothing in this card touches the README." },
  { headline: "Nothing says how the code is licensed", body: "The tree holds no license file." },
];
/** `reply`'s answer with `findings` added. */
const finding = (reply: Reply, findings: { headline: string; body: string }[] = FOUND): Reply => ({
  ...reply,
  stdout: JSON.stringify({ ...JSON.parse(reply.stdout!), findings }),
});

/**
 * The findings the plan's state records, each with its card's file, which has
 * to be in `open/`, and the waiting cards' ids, sorted.
 */
async function filed(deck: Deck) {
  const findings = (await listPlans(deck))[0]!.findings;
  const files = findings.map(({ id }) => readFileSync(path.join(deck.openDir, `${id}.md`), "utf8"));
  const waiting = (await waitingCards(deck)).map(({ id }) => id).sort();
  return { findings, files, waiting };
}

/** The file a finding is filed as, with the role, the card and the plan on its body's first line. */
const findingFile = (role: string, card: string, { headline, body }: { headline: string; body: string }) =>
  `# ${headline}\n\nFiled by the ${role} of ${card}, in the plan greeting.\n\n${body}\n`;

test("a reviewer approving with two findings leaves two waiting cards naming the reviewer, the card and the plan, while the card lands", async () => {
  const { deck, plan, id, tree } = await running();
  const { ended } = await cycle(deck, plan, id, tree, [done("printf 'hello\\n' > hello.txt")], [finding(approved())]);

  expect(ended.outcome).toBe("landed");
  expect(existsSync(path.join(deck.closedDir, `${id}.md`))).toBe(true);
  const { findings, files, waiting } = await filed(deck);
  expect(findings.map(({ role, card }) => ({ role, card }))).toEqual([
    { role: "reviewer", card: id },
    { role: "reviewer", card: id },
  ]);
  expect(files).toEqual(FOUND.map((found) => findingFile("reviewer", id, found)));
  expect(waiting).toEqual(findings.map((found) => found.id).sort());
  expect(ended.plan.findings).toEqual(findings);
  expect(cardFile(deck, id)).not.toContain(FOUND[0]!.headline);
});

test("a reconciler's finding is filed as a waiting card naming the reconciler, and the cycle goes on to land the card", async () => {
  const { deck, plan, id, tree } = await running();
  const { ended } = await cycle(deck, plan, id, tree, [done()], [approved()], [finding(proceed(), [FOUND[0]!])]);

  expect(ended.outcome).toBe("landed");
  const { findings, files, waiting } = await filed(deck);
  expect(findings).toEqual([{ id: findings[0]!.id, role: "reconciler", card: id }]);
  expect(files).toEqual([findingFile("reconciler", id, FOUND[0]!)]);
  expect(waiting).toEqual([findings[0]!.id]);
});

test("an implementer's finding is filed as a waiting card naming the implementer, and the cycle goes on to land the card", async () => {
  const { deck, plan, id, tree } = await running();
  const { ended } = await cycle(deck, plan, id, tree, [finding(done(), [FOUND[1]!])], [approved()]);

  expect(ended.outcome).toBe("landed");
  const { findings, files, waiting } = await filed(deck);
  expect(findings).toEqual([{ id: findings[0]!.id, role: "implementer", card: id }]);
  expect(files).toEqual([findingFile("implementer", id, FOUND[1]!)]);
  expect(waiting).toEqual([findings[0]!.id]);
  expect(cardFile(deck, id)).toContain(`## Account\n\n${ACCOUNT}\n`);
});

test("a finding whose headline wraps, or whose body has a line starting `# `, draws the repair prompt, and the repaired finding is filed", async () => {
  const { deck, plan, id, tree } = await running();
  const wraps = finding(done(), [{ headline: "The README\nstill names greet.sh", body: FOUND[0]!.body }]);
  const headed = finding(done(), [{ headline: FOUND[0]!.headline, body: `# README\n\n${FOUND[0]!.body}` }]);
  const { control, ended } = await cycle(deck, plan, id, tree, [wraps, headed, finding(done(), [FOUND[0]!])], [approved()]);

  expect(ended.outcome).toBe("landed");
  const [, first, second] = calls(control, ids[1]!);
  expect(first!.stdin).toContain("The previous report was invalid:\nanswer.findings[0].headline: a headline is one line and never wraps");
  expect(second!.stdin).toContain("The previous report was invalid:\nanswer.findings[0].body has a line starting `# `");
  expect((await filed(deck)).files).toEqual([findingFile("implementer", id, FOUND[0]!)]);
});

test("every role's answer schema carries the optional findings list of headline and body", async () => {
  const { deck, plan, id, tree } = await running();
  const { control } = await drawn(deck, plan, id, tree, [proceed(), reply()], [blocked(), done()], [approved()]);

  const field = '"findings":{"type":"array","items":{"type":"object","properties":{"headline":{"type":"string"},"body":{"type":"string"}},"required":["headline","body"]}}';
  const turns = [...calls(control, ids[0]!), ...calls(control, ids[1]!), ...calls(control, ids[2]!)];
  expect(turns).toHaveLength(5);
  for (const turn of turns) expect(turn.stdin).toContain(field);
  expect(RECONCILER.required).not.toContain("findings");
});

// A card id of the `proj` deck the tests run on, and two more for a message
// that cites several, then one shaped alike under a prefix no deck here has.
const CITED = "proj-dagobe";
const ALSO = "proj-bafoki";
const ELSEWHERE = "acme-dagobe";
const citing = (subject = SUBJECT, note = `${NOTE}\n\nFollows ${CITED}.`) => answer({ outcome: "approved", subject, close_note: note });
// The implementer's work with a second line citing an id.
const CITING_WORK = `printf 'hello\\nsee ${CITED}\\n' > hello.txt`;
// A reviewer's answer after removing the id, as its small fix.
const stripped = (run = `sed -i '/${CITED}/d' hello.txt`) => answer({ outcome: "fixed", subject: SUBJECT, close_note: NOTE }, run);
const LANDING_ENUM = '"enum":["approved","fixed"]';

test("a subject and close note citing card ids of the deck go back to the reviewer once, by the repair prompt naming each id, and the clean message lands", async () => {
  const { deck, plan, id, tree, base } = await running();
  const cited = citing(`${SUBJECT} for ${CITED}`, `${NOTE}\n\nFollows ${CITED} and ${ALSO}.`);
  const { control, ended } = await cycle(deck, plan, id, tree, [done("printf 'hello\\n' > hello.txt")], [cited, approved()]);

  const [, repair, ...more] = calls(control, ids[2]!);
  expect(more).toEqual([]);
  expect(repair!.argv).toEqual(["pi", "-p", "--session-id", ids[2]!]);
  expect(repair!.stdin).toStartWith("The work attempt is finished.\n");
  expect(repair!.stdin).toContain(`The previous report was invalid:\nanswer.subject cites ${CITED}, and answer.close_note cites ${CITED}, ${ALSO}`);
  expect(repair!.stdin).toContain(LANDING_ENUM);
  expect(ended.outcome).toBe("landed");
  expect((await gitOrThrow(["rev-parse", "HEAD~1"], tree)).trim()).toBe(base);
  expect(await message(tree)).toBe(`${SUBJECT}\n\n${NOTE}\n`);
  expect(cardFile(deck, id)).toEndWith(`## Close note\n\n${NOTE}\n`);
  expect((await listPlans(deck))[0]!.cycle).toMatchObject({ step: "land", subject: SUBJECT, note: NOTE });
});

test("a line the diff adds citing a card id of the deck resumes the reviewer under strip-ids with the line quoted, and lands once the id is gone", async () => {
  const { deck, plan, id, tree, base } = await running();
  const marks = tempDir();
  const during = path.join(marks, "state.json");
  const strip = stripped(`cp '${path.join(plan.dir, "state.json")}' '${during}'; sed -i '/${CITED}/d' hello.txt`);
  const { control, ended } = await cycle(deck, plan, id, tree, [done(CITING_WORK)], [approved(), strip]);

  const [, stripping, ...more] = calls(control, ids[2]!);
  expect(more).toEqual([]);
  expect(stripping!.argv).toEqual(["pi", "-p", "--session-id", ids[2]!]);
  expect(stripping!.cwd).toBe(tree);
  expect(stripping!.stdin).toStartWith("# Removing card ids from the diff\n");
  expect(stripping!.stdin).toContain(`<lines>\nsee ${CITED}\n</lines>\n`);
  expect(stripping!.stdin).toContain(LANDING_ENUM);
  expect(stripping!.stdin).not.toContain("{{");
  // Nothing that has not passed the checks is recorded at step land.
  const recorded = JSON.parse(readFileSync(during, "utf8")).cycle;
  expect(recorded.step).toBe("review");
  expect(recorded.subject).toBeUndefined();
  expect(ended.outcome).toBe("landed");
  expect((await gitOrThrow(["rev-parse", "HEAD~1"], tree)).trim()).toBe(base);
  expect(await gitOrThrow(["show", "HEAD:hello.txt"], tree)).toBe("hello\n");
  expect(await message(tree)).toBe(`${SUBJECT}\n\n${NOTE}\n`);
});

test(`a diff still citing a card id after ${ID_RETURNS} returns stops the cycle as a reviewer that failed, quoting the line, and commits nothing`, async () => {
  const { repo, deck, plan, id, tree, base, before } = await running();
  const { control, ended } = await cycle(deck, plan, id, tree, [done(CITING_WORK)], [approved(), approved(), approved()]);

  expect(ID_RETURNS).toBe(2);
  expect(calls(control, ids[2]!)).toHaveLength(1 + ID_RETURNS);
  expect(ended.outcome).toBe("stopped");
  if (ended.outcome !== "stopped") return;
  expect(ended.role).toBe("reviewer");
  expect(ended.session).toEqual({ harness: "pi", id: ids[2]!, dir: tree });
  expect(ended.cause).toBe(`the lines the card's diff adds still cited a card id after ${ID_RETURNS} returns: "see ${CITED}"`);
  expect(ended.plan.cycle).toEqual({
    card: id,
    base,
    role: "reviewer",
    step: "review",
    sessions: { reconciler: ids[0], implementer: ids[1], reviewer: ids[2] },
    rounds: 0,
    exchanges: 0,
  });
  expect(await headSha(tree)).toBe(base);
  expect(await gitOrThrow(["status", "--porcelain"], tree)).toBe("?? hello.txt\n");
  expect(existsSync(path.join(deck.openDir, `${id}.md`))).toBe(true);
  expect(await mainState(repo)).toEqual(before);
});

test(`a close note still citing a card id after ${ID_RETURNS} returns stops the cycle as a reviewer that failed, naming the id, and commits nothing`, async () => {
  const { deck, plan, id, tree, base } = await running();
  const { control, ended } = await cycle(deck, plan, id, tree, [done("printf 'hello\\n' > hello.txt")], [citing(), citing(), citing()]);

  expect(calls(control, ids[2]!)).toHaveLength(1 + ID_RETURNS);
  expect(ended.outcome).toBe("stopped");
  if (ended.outcome !== "stopped") return;
  expect(ended.role).toBe("reviewer");
  expect(ended.session.id).toBe(ids[2]!);
  expect(ended.cause).toStartWith(`the subject and close note still cited a card id after ${ID_RETURNS} returns: answer.close_note cites ${CITED}`);
  expect(ended.plan.cycle?.step).toBe("review");
  expect(await headSha(tree)).toBe(base);
  expect(existsSync(path.join(deck.openDir, `${id}.md`))).toBe(true);
});

test("each check gets its own returns, apart from each other and from the repair prompts a malformed answer gets", async () => {
  const { deck, plan, id, tree } = await running();
  const reviewer = [{ stdout: "not JSON" }, citing(), citing(), approved(), approved(), stripped()];
  const { control, ended } = await cycle(deck, plan, id, tree, [done(CITING_WORK)], reviewer);

  const turns = calls(control, ids[2]!);
  expect(turns).toHaveLength(6);
  expect(turns.slice(1, 4).map(({ stdin }) => stdin.split("\n")[0])).toEqual(Array(3).fill("The work attempt is finished."));
  expect(turns.slice(4).map(({ stdin }) => stdin.split("\n")[0])).toEqual(Array(2).fill("# Removing card ids from the diff"));
  expect(ended.outcome).toBe("landed");
  expect(await gitOrThrow(["show", "HEAD:hello.txt"], tree)).toBe("hello\n");
});

test("an id under another prefix, in the message or the diff, passes both checks and lands at once", async () => {
  const { deck, plan, id, tree } = await running();
  const note = `${NOTE}\n\nFollows ${ELSEWHERE}.`;
  const work = `printf 'hello\\nsee ${ELSEWHERE}\\n' > hello.txt`;
  const { control, ended } = await cycle(deck, plan, id, tree, [done(work)], [citing(SUBJECT, note)]);

  expect(calls(control, ids[2]!)).toHaveLength(1);
  expect(ended.outcome).toBe("landed");
  expect(await message(tree)).toBe(`${SUBJECT}\n\n${note}\n`);
  expect(await gitOrThrow(["show", "HEAD:hello.txt"], tree)).toBe(`hello\nsee ${ELSEWHERE}\n`);
});

test("a landing answer's findings are filed from the answer that passes the checks, each restated finding once and a new one too", async () => {
  const { deck, plan, id, tree } = await running();
  const [first, added] = FOUND as [{ headline: string; body: string }, { headline: string; body: string }];
  const reviewer = [finding(citing(), [first]), finding(approved(), [first]), finding(stripped(), [first, added])];
  const { control, ended } = await cycle(deck, plan, id, tree, [done(CITING_WORK)], reviewer);

  expect(ended.outcome).toBe("landed");
  const field = '"findings":{"type":"array"';
  for (const turn of calls(control, ids[2]!)) expect(turn.stdin).toContain(field);
  const { findings, files, waiting } = await filed(deck);
  expect(files).toEqual([findingFile("reviewer", id, first), findingFile("reviewer", id, added)]);
  expect(waiting).toEqual(findings.map((found) => found.id).sort());
});

test("a reviewer that fails at the third return files none of its findings, as a role that fails", async () => {
  const { deck, plan, id, tree } = await running();
  const reviewer = [finding(citing()), finding(citing()), finding(citing())];
  const { ended } = await cycle(deck, plan, id, tree, [done()], reviewer);

  expect(ended.outcome).toBe("stopped");
  expect((await filed(deck)).findings).toEqual([]);
  expect(ended.plan.findings).toEqual([]);
});
