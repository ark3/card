import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { EXCHANGES, RECONCILER, REVISION_ROUNDS, runCard } from "../src/cycle.ts";
import { createDeck, type Deck } from "../src/deck.ts";
import { gitOrThrow, headSha } from "../src/git.ts";
import { ensureBranch, holdWorktree } from "../src/landing.ts";
import { fileCard } from "../src/operations.ts";
import { bootId, listPlans, type Plan, startPlan, writeRecord } from "../src/plan.ts";
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
  expect(ended.plan.cycle).toEqual({ card: id, base, role: "implementer", step: "implement", sessions });
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
  expect(ended.plan.cycle).toEqual({ card: id, base, role: "reconciler", step: "reconcile", sessions: { reconciler: ids[0] } });
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
  expect(ended.plan.cycle).toEqual({ card: id, base, role: "reconciler", step: "reconcile", sessions: { reconciler: ids[0] } });
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
  expect(ended.plan.cycle).toEqual({ card: id, base, role: "reconciler", step: "converse", sessions });
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
  expect(ended.plan.cycle).toEqual({ card: id, base, role: "reconciler", step: "converse", sessions });
});
