import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runCard } from "../src/cycle.ts";
import { createDeck, type Deck } from "../src/deck.ts";
import { gitOrThrow, headSha } from "../src/git.ts";
import { ensureBranch, holdWorktree } from "../src/landing.ts";
import { fileCard } from "../src/operations.ts";
import { bootId, listPlans, type Plan, startPlan, writeRecord } from "../src/plan.ts";
import { calls, type Reply, removeTempDirs, script, stand, tempRepo } from "./helpers.ts";

const OUTER_PATH = process.env.PATH;

// The ids the cycle draws for its sessions, handed out in order, so the
// stand-in can be scripted for each before the cycle runs.
let ids: string[] = [];
beforeEach(() => {
  ids = [crypto.randomUUID(), crypto.randomUUID()];
  const queue = [...ids];
  spyOn(crypto, "randomUUID").mockImplementation(() => queue.shift() as ReturnType<typeof crypto.randomUUID>);
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
const done = (run?: string) => answer({ outcome: "done", account: ACCOUNT }, run);
const approved = (run?: string) => answer({ outcome: "approved", subject: SUBJECT, close_note: NOTE }, run);

/** Scripts the implementer's and the reviewer's calls, and runs the cycle on Pi's stand-in. */
async function cycle(deck: Deck, plan: Plan, id: string, tree: string, implementer: Reply[], reviewer: Reply[]) {
  const control = stand();
  script(control, ids[0]!, ...implementer);
  script(control, ids[1]!, ...reviewer);
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

  const [implementer, reviewer] = ids;
  expect(implementer).not.toBe(reviewer);
  for (const session of ids) {
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
    sessions: { implementer, reviewer },
    subject: SUBJECT,
    note: NOTE,
    commit,
  });
  expect(ended.plan.cycle).toEqual(record);
});

test("neither role sees the plan document, and the reviewer gets the card with the account, the diff and the convention", async () => {
  const { deck, plan, id, tree } = await running();
  const { control } = await cycle(deck, plan, id, tree, [done("printf 'hello\\n' > hello.txt")], [approved()]);

  const implementer = calls(control, ids[0]!)[0]!.stdin;
  const reviewer = calls(control, ids[1]!)[0]!.stdin;
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

  expect(calls(control, ids[1]!)[0]!.stdin).toContain("    (none)\n");
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

  expect(calls(control, ids[1]!)[0]!.stdin).toContain("+++ b/hello.txt\n@@ -0,0 +1 @@\n+hello\n");
  expect((await gitOrThrow(["rev-parse", "HEAD~1"], tree)).trim()).toBe(base);
  expect(await changed(tree)).toEqual(["hello.txt"]);
  expect(await message(tree)).toBe(`${SUBJECT}\n\n${NOTE}\n`);
});

test("a reviewer's fixes in place land in the card's one commit, with no second review", async () => {
  const { deck, plan, id, tree, base } = await running();
  const fixed = answer({ outcome: "fixed", subject: SUBJECT, close_note: NOTE }, "printf 'hello, fixed\\n' > hello.txt");
  const { control } = await cycle(deck, plan, id, tree, [done("printf 'hello\\n' > hello.txt")], [fixed]);

  expect(calls(control, ids[1]!)).toHaveLength(1);
  expect((await gitOrThrow(["rev-parse", "HEAD~1"], tree)).trim()).toBe(base);
  expect(await gitOrThrow(["show", "HEAD:hello.txt"], tree)).toBe("hello, fixed\n");
});

test("an account with a line starting `# ` draws the repair prompt, and the repaired account is the one appended", async () => {
  const { deck, plan, id, tree } = await running();
  const headed = answer({ outcome: "done", account: `# What I did\n\n${ACCOUNT}` });
  const { control, ended } = await cycle(deck, plan, id, tree, [headed, done()], [approved()]);

  expect(ended.outcome).toBe("landed");
  const [, repair] = calls(control, ids[0]!);
  expect(repair!.stdin).toContain("The previous report was invalid:\nanswer.account has a line starting `# `");
  expect(readFileSync(path.join(deck.closedDir, `${id}.md`), "utf8")).toContain(`## Account\n\n${ACCOUNT}\n`);
});

test("a subject or a close note with a line starting `# ` draws the repair prompt", async () => {
  const { deck, plan, id, tree } = await running();
  const headed = answer({ outcome: "approved", subject: SUBJECT, close_note: `# Landed\n\n${NOTE}` });
  const { control } = await cycle(deck, plan, id, tree, [done()], [headed, approved()]);

  const [, repair] = calls(control, ids[1]!);
  expect(repair!.stdin).toContain("The previous report was invalid:\nanswer.close_note has a line starting `# `");
  expect(await message(tree)).toBe(`${SUBJECT}\n\n${NOTE}\n`);
});

test("an implementer that fails stops the cycle at its step, with the cause and the session, and lands nothing", async () => {
  const { repo, deck, plan, id, tree, base, before } = await running();
  const { control, ended } = await cycle(deck, plan, id, tree, [{ stderr: "usage limit reached\n", exit: 1 }], []);

  expect(ended.outcome).toBe("stopped");
  if (ended.outcome !== "stopped") return;
  expect(ended.role).toBe("implementer");
  expect(ended.session).toEqual({ harness: "pi", id: ids[0]!, dir: tree });
  expect(ended.cause).toContain("usage limit reached");
  expect(ended.plan.cycle).toEqual({ card: id, base, role: "implementer", step: "implement", sessions: { implementer: ids[0] } });
  expect((await listPlans(deck))[0]!.cycle).toEqual(ended.plan.cycle);
  expect(existsSync(path.join(control, ids[1]!, "calls"))).toBe(false);
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
  expect(ended.session.id).toBe(ids[1]!);
  expect(ended.cause).toContain("still malformed after 2 repair prompts");
  expect(ended.plan.cycle).toEqual({
    card: id,
    base,
    role: "reviewer",
    step: "review",
    sessions: { implementer: ids[0], reviewer: ids[1] },
  });
  expect(await headSha(tree)).toBe(base);
  expect(await gitOrThrow(["status", "--porcelain"], tree)).toBe("?? hello.txt\n");
  expect(readFileSync(path.join(deck.openDir, `${id}.md`), "utf8")).toContain(`## Account\n\n${ACCOUNT}\n`);
});
