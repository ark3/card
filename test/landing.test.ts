import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git } from "../src/git.ts";
import {
  addedLines,
  CommitRefused,
  commitMessage,
  discard,
  ensureBranch,
  holdWorktree,
  land,
  removeWorktree,
  undoMovedHead,
} from "../src/landing.ts";
import { removeTempDirs, tempDir, tempRepo } from "./helpers.ts";

afterAll(removeTempDirs);

async function out(args: string[], cwd: string): Promise<string> {
  const result = await git(args, cwd);
  if (!result.ok) throw new Error(result.stderr);
  return result.stdout.trim();
}

/** A commit on `branch` made without a checkout, so the main checkout never moves. */
async function commitOnBranch(repo: string, branch: string, message: string): Promise<string> {
  const tree = await out(["rev-parse", `${branch}^{tree}`], repo);
  const sha = await out(["commit-tree", tree, "-p", branch, "-m", message], repo);
  await out(["update-ref", `refs/heads/${branch}`, sha], repo);
  return sha;
}

/**
 * A repository whose seed ignores `node_modules/`, and whose main checkout is
 * mid-work — a staged edit, an unstaged one and an untracked file — so a
 * landing operation that touched it would show.
 */
async function fixture(): Promise<string> {
  const repo = await tempRepo();
  writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
  await out(["add", ".gitignore"], repo);
  await out(["commit", "-q", "-m", "ignore dependencies"], repo);
  await out(["branch", "develop"], repo);

  writeFileSync(path.join(repo, "README.md"), "staged\n");
  await out(["add", "README.md"], repo);
  writeFileSync(path.join(repo, "README.md"), "staged, then edited\n");
  writeFileSync(path.join(repo, "scratch.txt"), "the owner's own\n");
  return repo;
}

/** The main checkout's HEAD, index and status, which no operation may change. */
async function mainState(repo: string): Promise<string[]> {
  return [
    await out(["symbolic-ref", "HEAD"], repo),
    await out(["rev-parse", "HEAD"], repo),
    await out(["ls-files", "--stage"], repo),
    await out(["status", "--porcelain"], repo),
  ];
}

/** A fixture with the plan's branch `plan/tidy` ensured and held, and the main checkout's state before. */
async function held(): Promise<{ repo: string; tree: string; before: string[] }> {
  const repo = await fixture();
  const before = await mainState(repo);
  await ensureBranch("plan/tidy", "develop", repo);
  const tree = await holdWorktree("tidy", "plan/tidy", repo);
  return { repo, tree, before };
}

test("an absent branch is created from its start point, resolved by name at the call", async () => {
  const repo = await fixture();
  const before = await mainState(repo);
  // develop moves after the fixture names it; the branch follows where it is now.
  const moved = await commitOnBranch(repo, "develop", "develop moves on");

  await ensureBranch("plan/tidy", "develop", repo);

  expect(await out(["rev-parse", "refs/heads/plan/tidy"], repo)).toBe(moved);
  expect(await mainState(repo)).toEqual(before);
});

test("a present branch is used as it stands, not reset to its start point", async () => {
  const repo = await fixture();
  await ensureBranch("plan/tidy", "develop", repo);
  const ahead = await commitOnBranch(repo, "plan/tidy", "work already on the plan's branch");
  const before = await mainState(repo);

  await ensureBranch("plan/tidy", "develop", repo);

  expect(await out(["rev-parse", "refs/heads/plan/tidy"], repo)).toBe(ahead);
  expect(await mainState(repo)).toEqual(before);
});

test("the branch is held in a worktree under .worktrees, hidden from git status", async () => {
  const { repo, tree, before } = await held();

  expect(tree).toBe(path.join(repo, ".worktrees", "tidy"));
  expect(await out(["symbolic-ref", "HEAD"], tree)).toBe("refs/heads/plan/tidy");
  expect(readFileSync(path.join(repo, ".worktrees", ".gitignore"), "utf8")).toBe("*\n");
  expect(await mainState(repo)).toEqual(before);
});

test("git refuses a second checkout of the plan's branch while the worktree stands", async () => {
  const { repo } = await held();

  const elsewhere = await git(["worktree", "add", path.join(tempDir(), "elsewhere"), "plan/tidy"], repo);

  expect(elsewhere.ok).toBe(false);
  expect(elsewhere.stderr).toContain("plan/tidy");
});

test("holding the branch again finds the worktree that already holds it", async () => {
  const { repo, tree, before } = await held();
  writeFileSync(path.join(tree, "in-flight.txt"), "kept\n");

  expect(await holdWorktree("tidy", "plan/tidy", repo)).toBe(tree);
  expect(readFileSync(path.join(tree, "in-flight.txt"), "utf8")).toBe("kept\n");
  expect(await mainState(repo)).toEqual(before);
});

test("discard removes tracked edits and untracked files and keeps ignored ones", async () => {
  const { repo, tree, before } = await held();
  writeFileSync(path.join(tree, "README.md"), "edited\n");
  writeFileSync(path.join(tree, "new.txt"), "untracked\n");
  mkdirSync(path.join(tree, "newdir"));
  writeFileSync(path.join(tree, "newdir", "deep.txt"), "untracked\n");
  mkdirSync(path.join(tree, "node_modules"));
  writeFileSync(path.join(tree, "node_modules", "dep.js"), "installed\n");

  await discard(tree);

  expect(readFileSync(path.join(tree, "README.md"), "utf8")).toBe("seed\n");
  expect(existsSync(path.join(tree, "new.txt"))).toBe(false);
  expect(existsSync(path.join(tree, "newdir"))).toBe(false);
  expect(readFileSync(path.join(tree, "node_modules", "dep.js"), "utf8")).toBe("installed\n");
  expect(await out(["status", "--porcelain"], tree)).toBe("");
  expect(await mainState(repo)).toEqual(before);
});

test("two implementer commits are undone, their changes left in the worktree", async () => {
  const { repo, tree, before } = await held();
  const recorded = await out(["rev-parse", "HEAD"], tree);
  writeFileSync(path.join(tree, "README.md"), "first\n");
  await out(["commit", "-q", "-am", "first"], tree);
  writeFileSync(path.join(tree, "added.txt"), "second\n");
  await out(["add", "added.txt"], tree);
  await out(["commit", "-q", "-m", "second"], tree);

  expect(await undoMovedHead(recorded, tree)).toBe(true);

  expect(await out(["rev-parse", "HEAD"], tree)).toBe(recorded);
  expect(await out(["rev-parse", "refs/heads/plan/tidy"], repo)).toBe(recorded);
  expect(readFileSync(path.join(tree, "README.md"), "utf8")).toBe("first\n");
  expect(readFileSync(path.join(tree, "added.txt"), "utf8")).toBe("second\n");
  expect(await mainState(repo)).toEqual(before);
});

test("a HEAD that has not moved is left alone", async () => {
  const { tree } = await held();
  const recorded = await out(["rev-parse", "HEAD"], tree);
  writeFileSync(path.join(tree, "README.md"), "uncommitted\n");

  expect(await undoMovedHead(recorded, tree)).toBe(false);
  expect(readFileSync(path.join(tree, "README.md"), "utf8")).toBe("uncommitted\n");
});

test("the added lines are the diff's, new untracked files included, and nothing removed or ignored", async () => {
  const { repo, tree, before } = await held();
  writeFileSync(path.join(tree, "README.md"), "++ looks like a header\nanother\n");
  mkdirSync(path.join(tree, "src"));
  writeFileSync(path.join(tree, "src", "new.ts"), "export const a = 1;\nexport const b = 2;\n");
  mkdirSync(path.join(tree, "node_modules"));
  writeFileSync(path.join(tree, "node_modules", "dep.js"), "ignored\n");

  expect(await addedLines(tree)).toEqual([
    "++ looks like a header",
    "another",
    "export const a = 1;",
    "export const b = 2;",
  ]);
  expect(await mainState(repo)).toEqual(before);
});

test("a commit message is the subject, a blank line and the body wrapped at 72", () => {
  const body = [
    "Hold the plan's branch in one worktree for the whole run, so git refuses to check it out anywhere else meanwhile.",
    "Each card lands as one commit.",
    "",
    "",
    "See https://example.invalid/a/very/long/address/that/is/longer/than/seventy/two/columns/on/its/own for more.",
  ].join("\n");

  expect(commitMessage("Land each card as one commit", body)).toBe(
    [
      "Land each card as one commit",
      "",
      "Hold the plan's branch in one worktree for the whole run, so git refuses",
      "to check it out anywhere else meanwhile. Each card lands as one commit.",
      "",
      "See",
      "https://example.invalid/a/very/long/address/that/is/longer/than/seventy/two/columns/on/its/own",
      "for more.",
      "",
    ].join("\n"),
  );
});

test("a commit message fills each list item on its own, its continuation lines under its text", () => {
  const body = [
    "Fill a close note the way an editor would,",
    "so that a list in it survives the trip into the commit message.",
    "",
    "- A short item.",
    "- Prose paragraphs are refilled to 72 columns, and a line that begins with a list marker starts an item of its own.",
    "  - A nested item keeps its indent, and its continuation lines sit under its own text as well.",
    "- A last item.",
    "",
    "1) Numbered steps work the same way, whatever the marker, and their continuation lines line up too.",
    "2) A second step.",
  ].join("\n");

  expect(commitMessage("Fill a list item by item", body)).toBe(
    [
      "Fill a list item by item",
      "",
      "Fill a close note the way an editor would, so that a list in it survives",
      "the trip into the commit message.",
      "",
      "- A short item.",
      "- Prose paragraphs are refilled to 72 columns, and a line that begins",
      "  with a list marker starts an item of its own.",
      "  - A nested item keeps its indent, and its continuation lines sit under",
      "    its own text as well.",
      "- A last item.",
      "",
      "1) Numbered steps work the same way, whatever the marker, and their",
      "   continuation lines line up too.",
      "2) A second step.",
      "",
    ].join("\n"),
  );
});

test("landing commits everything in the worktree under the message, byte for byte", async () => {
  const { repo, tree, before } = await held();
  writeFileSync(path.join(tree, "README.md"), "landed\n");
  writeFileSync(path.join(tree, "new.txt"), "untracked, then landed\n");
  mkdirSync(path.join(tree, "node_modules"));
  writeFileSync(path.join(tree, "node_modules", "dep.js"), "ignored\n");
  const subject = "Land the card";
  const body = "What landed, how it was verified, and how to see it working, written long enough to wrap.\n\nA second paragraph.";

  const sha = await land(subject, body, tree);

  expect(await out(["rev-parse", "refs/heads/plan/tidy"], repo)).toBe(sha);
  const raw = await git(["cat-file", "commit", sha], repo);
  expect(raw.stdout.slice(raw.stdout.indexOf("\n\n") + 2)).toBe(commitMessage(subject, body));
  expect(await out(["ls-tree", "--name-only", sha], repo)).toBe(".gitignore\nREADME.md\nnew.txt");
  expect(await out(["status", "--porcelain"], tree)).toBe("");
  expect(await mainState(repo)).toEqual(before);
});

test("landing with nothing changed makes an empty commit and returns its sha", async () => {
  const { repo, tree, before } = await held();
  const parent = await out(["rev-parse", "HEAD"], tree);

  const sha = await land("Check the whole plan", "Nothing changed.", tree);

  expect(sha).not.toBe(parent);
  expect(await out(["rev-parse", "HEAD"], tree)).toBe(sha);
  expect(await out(["rev-parse", `${sha}^`], repo)).toBe(parent);
  expect(await out(["rev-parse", `${sha}^{tree}`], repo)).toBe(await out(["rev-parse", `${parent}^{tree}`], repo));
  expect(await mainState(repo)).toEqual(before);
});

test("a commit git refuses is a failure carrying git's cause", async () => {
  const { repo, tree } = await held();
  const hooks = path.join(repo, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\necho 'the hook says no' >&2\nexit 1\n", { mode: 0o755 });
  const parent = await out(["rev-parse", "HEAD"], tree);

  const landing = land("Land the card", "A note.", tree);

  await expect(landing).rejects.toThrow(CommitRefused);
  await expect(landing).rejects.toThrow("the hook says no");
  expect(await out(["rev-parse", "HEAD"], tree)).toBe(parent);
});

test("removing the worktree keeps the branch and frees it for a checkout elsewhere", async () => {
  const { repo, tree, before } = await held();
  const tip = await land("Land the card", "A note.", tree);
  mkdirSync(path.join(tree, "node_modules"));
  writeFileSync(path.join(tree, "node_modules", "dep.js"), "ignored\n");

  await removeWorktree(tree);

  expect(existsSync(tree)).toBe(false);
  expect(await out(["rev-parse", "refs/heads/plan/tidy"], repo)).toBe(tip);
  expect(await mainState(repo)).toEqual(before);
  expect((await git(["worktree", "add", path.join(tempDir(), "elsewhere"), "plan/tidy"], repo)).ok).toBe(true);
});
