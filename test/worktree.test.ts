import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { git } from "../src/git.ts";
import { run as worktree } from "../src/verbs/worktree.ts";
import { clearCardRoot, removeTempDirs, tempDir, tempRepo } from "./helpers.ts";

beforeEach(clearCardRoot);
afterAll(removeTempDirs);

/** Everything the verb printed, and whatever it threw instead of printing. */
async function capture(fn: () => Promise<void>): Promise<{ out: string; error: Error | null }> {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...parts: unknown[]) => lines.push(parts.join(" "));

  let error: Error | null = null;
  try {
    await fn();
  } catch (thrown) {
    error = thrown as Error;
  } finally {
    console.log = log;
  }
  return { out: lines.join("\n"), error };
}

async function sha(rev: string, cwd: string): Promise<string> {
  return (await git(["rev-parse", rev], cwd)).stdout.trim();
}

test("cuts the tree on a branch named for the id, and reports where it starts", async () => {
  const repo = await tempRepo();
  const tip = await sha("main", repo);

  const { out, error } = await capture(() => worktree(["proj-behilo"], repo));

  expect(error).toBeNull();
  const treePath = path.join(repo, ".worktrees", "proj-behilo");
  expect(existsSync(path.join(treePath, "README.md"))).toBe(true);
  expect(out).toBe(`tree ${treePath}\nbranch card/proj-behilo, cut from main at ${tip}`);
  expect(await sha("HEAD", treePath)).toBe(tip);
  expect(await sha("card/proj-behilo", repo)).toBe(tip);
});

test("keeps .worktrees out of git status without touching the repository", async () => {
  const repo = await tempRepo();
  await capture(() => worktree(["one"], repo));

  expect(await Bun.file(path.join(repo, ".worktrees", ".gitignore")).text()).toBe("*\n");
  expect((await git(["status", "--porcelain"], repo)).stdout).toBe("");
  expect(existsSync(path.join(repo, ".gitignore"))).toBe(false);
});

test("bases on whatever branch the main checkout is on", async () => {
  const repo = await tempRepo();
  await git(["checkout", "-q", "-b", "ticket"], repo);
  await Bun.write(path.join(repo, "ticket.md"), "work\n");
  await git(["add", "ticket.md"], repo);
  await git(["commit", "-q", "-m", "ticket"], repo);

  const { out } = await capture(() => worktree(["one"], repo));

  expect(out).toContain(`cut from ticket at ${await sha("ticket", repo)}`);
});

test("a tree cut from inside another tree bases on the main checkout, not the inner one", async () => {
  const repo = await tempRepo();
  await capture(() => worktree(["one"], repo));
  const inner = path.join(repo, ".worktrees", "one");

  await Bun.write(path.join(inner, "inner.md"), "inner\n");
  await git(["add", "inner.md"], inner);
  await git(["commit", "-q", "-m", "inner"], inner);

  const tip = await sha("main", repo);
  expect(await sha("HEAD", inner)).not.toBe(tip);

  const { out, error } = await capture(() => worktree(["two"], inner));

  expect(error).toBeNull();
  const second = path.join(repo, ".worktrees", "two");
  expect(out).toBe(`tree ${second}\nbranch card/two, cut from main at ${tip}`);
  expect(await sha("HEAD", second)).toBe(tip);
});

test("refuses when the main checkout is on a detached HEAD", async () => {
  const repo = await tempRepo();
  await git(["checkout", "-q", "--detach"], repo);

  const { out, error } = await capture(() => worktree(["one"], repo));

  expect(error?.message).toContain("detached HEAD");
  expect(out).toBe("");
  expect(existsSync(path.join(repo, ".worktrees", "one"))).toBe(false);
});

test("refuses to clobber an existing tree, or an existing branch", async () => {
  const repo = await tempRepo();
  await capture(() => worktree(["one"], repo));
  await Bun.write(path.join(repo, ".worktrees", "one", "kept.md"), "kept\n");

  const again = await capture(() => worktree(["one"], repo));
  expect(again.error?.message).toContain("already exists");
  expect(existsSync(path.join(repo, ".worktrees", "one", "kept.md"))).toBe(true);

  const other = await tempRepo();
  await git(["branch", "card/two"], other);
  const clash = await capture(() => worktree(["two"], other));
  expect(clash.error?.message).toContain("already exists");
  expect(existsSync(path.join(other, ".worktrees", "two"))).toBe(false);
});

test("refuses an id that would not make a directory or a branch", async () => {
  const repo = await tempRepo();

  await expect(worktree([], repo)).rejects.toThrow(/usage/);
  await expect(worktree(["../oops"], repo)).rejects.toThrow(/not a usable id/);
  await expect(worktree(["a/b"], repo)).rejects.toThrow(/not a usable id/);
  expect(existsSync(path.join(repo, ".worktrees"))).toBe(false);
});

test("refuses outside a git repository", async () => {
  const loose = tempDir();
  const { error } = await capture(() => worktree(["one"], loose));
  expect(error).not.toBeNull();
});
