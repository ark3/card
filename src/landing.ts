import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { wrote } from "./dying.ts";
import { branchExists, firstListed, git, gitOrThrow, headSha, listWorktrees } from "./git.ts";

/**
 * Makes sure the plan's branch exists: created from `startPoint` when absent,
 * and used as it stands when present, as when the owner made it or a stopped
 * run resumes. The start point is a name resolved here, at the call, since a
 * name like `develop` moves.
 */
export async function ensureBranch(branch: string, startPoint: string, cwd: string): Promise<void> {
  if (await branchExists(branch, cwd)) return;
  // --no-track: the plan's branch tracking its start point would aim a stray
  // push from the plan's worktree at it.
  await gitOrThrow(["branch", "--no-track", branch, startPoint], cwd);
}

/** The plan's worktree, `.worktrees/<slug>` at the repository root, where it holds `branch`, and otherwise null. */
export async function worktreeOf(slug: string, branch: string, cwd: string): Promise<string | null> {
  const { root } = await firstListed(cwd);
  const tree = path.join(root, ".worktrees", slug);
  const holding = await listWorktrees(cwd);
  return holding.some((listed) => listed.root === tree && listed.branch === `refs/heads/${branch}`) ? tree : null;
}

/**
 * Holds `branch` checked out in the plan's worktree, `.worktrees/<slug>` at the
 * repository root, and returns its path; a worktree already holding it there,
 * as when a dead run is carried on, is returned as it stands. While it stands,
 * git itself refuses to check the branch out anywhere else.
 */
export async function holdWorktree(slug: string, branch: string, cwd: string): Promise<string> {
  const held = await worktreeOf(slug, branch, cwd);
  if (held !== null) return held;

  const { root } = await firstListed(cwd);
  const trees = path.join(root, ".worktrees");
  const tree = path.join(trees, slug);
  await mkdir(trees, { recursive: true });
  // `*` hides the trees, and this file, from git status, so the tool depends on
  // nothing machine-level to keep them out of the repository.
  await Bun.write(path.join(trees, ".gitignore"), "*\n");
  await gitOrThrow(["worktree", "add", "-q", tree, branch], root);
  wrote();
  return tree;
}

/**
 * Resets the worktree hard to `commit` and cleans it: tracked edits, untracked
 * files and any commit past `commit` go, and ignored files stay, since
 * installed dependencies are why there is one worktree per plan.
 */
export async function discard(tree: string, commit = "HEAD"): Promise<void> {
  await gitOrThrow(["reset", "-q", "--hard", commit], tree);
  wrote();
  await gitOrThrow(["clean", "-q", "-f", "-d"], tree);
  wrote();
}

/**
 * Moves the worktree's HEAD back to `since` where commits have moved it, as an
 * implementer committing out of habit does, keeping their changes in the tree
 * uncommitted. Returns whether HEAD had moved.
 */
export async function undoMovedHead(since: string, tree: string): Promise<boolean> {
  if ((await headSha(tree)) === since) return false;
  await gitOrThrow(["reset", "-q", since], tree);
  return true;
}

// --no-color and --no-ext-diff, because a user's config can otherwise colour
// the diff or hand it to another program, and either breaks the reading.
const DIFF = ["diff", "--no-color", "--no-ext-diff"];

/** The worktree's uncommitted diff against HEAD, new untracked files whole. */
export async function uncommittedDiff(tree: string): Promise<string> {
  const diffs = [await gitOrThrow([...DIFF, "HEAD"], tree)];
  const untracked = await gitOrThrow(["ls-files", "-z", "--others", "--exclude-standard"], tree);
  for (const file of untracked.split("\0").filter(Boolean)) {
    // Against /dev/null, so a new file shows whole and a binary one adds no
    // lines, as in the tracked diff. It exits 1 because the two differ.
    diffs.push((await git([...DIFF, "--no-index", "--", "/dev/null", file], tree)).stdout);
  }
  return diffs.join("");
}

/**
 * The paths at which the worktree differs from `commit`, committed or not, new
 * untracked files included; a rename names both of its paths.
 */
export async function changedPaths(tree: string, commit: string): Promise<string[]> {
  const tracked = await gitOrThrow(["diff", "--name-only", "--no-renames", "-z", commit], tree);
  const untracked = await gitOrThrow(["ls-files", "-z", "--others", "--exclude-standard"], tree);
  return `${tracked}${untracked}`.split("\0").filter(Boolean);
}

/** What a worktree path holds: its bytes, `directory` for a repository nested there, or null where it is gone. */
type Held = Buffer | "directory" | null;

/** The paths at which the worktree differs from a commit, as `changedPaths` names them, each with what it holds. */
export type Snapshot = Map<string, Held>;

async function held(file: string): Promise<Held> {
  try {
    return await readFile(file);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ENOENT") return null;
    if (code === "EISDIR") return "directory";
    throw error;
  }
}

/** The worktree's `changedPaths` from `commit`, each with what it holds now. */
export async function snapshot(tree: string, commit: string): Promise<Snapshot> {
  const paths = await changedPaths(tree, commit);
  return new Map(await Promise.all(paths.map(async (file) => [file, await held(path.join(tree, file))] as const)));
}

/**
 * The paths at which the worktree has changed since `before`, its `snapshot`
 * from `commit`: each path changed from `commit` that `before` lacks, and each
 * of `before` that holds otherwise now. Against an empty snapshot, these are
 * its `changedPaths`.
 */
export async function changedSince(tree: string, commit: string, before: Snapshot): Promise<string[]> {
  const changed: string[] = [];
  for (const file of new Set([...before.keys(), ...(await changedPaths(tree, commit))])) {
    const was = before.get(file);
    if (was === undefined) {
      changed.push(file);
      continue;
    }
    const is = await held(path.join(tree, file));
    if (was instanceof Buffer && is instanceof Buffer ? !was.equals(is) : was !== is) changed.push(file);
  }
  return changed;
}

/** The lines the worktree's uncommitted diff adds, new untracked files whole. */
export async function addedLines(tree: string): Promise<string[]> {
  return added(await uncommittedDiff(tree));
}

/**
 * The `+` lines of a diff's hunks. A file's header ends at its first `@@`, so a
 * `+++` there names the file, while in a hunk it is an added line that starts
 * with `++`; every hunk line carries a one-character prefix, so `diff ` always
 * opens the next file's header.
 */
function added(diff: string): string[] {
  const lines: string[] = [];
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff ")) inHunk = false;
    else if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && line.startsWith("+")) lines.push(line.slice(1));
  }
  return lines;
}

const WIDTH = 72;

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;
const HEADING = /^#{1,6}\s/;

/**
 * The subject, a blank line, and the body filled at 72 columns, as an editor
 * fills it. Blank lines separate the body's paragraphs, and each paragraph is
 * refilled. A line beginning with a list marker (`-`, `*`, `+`, `1.` or `1)`)
 * starts an item filled on its own, keeping its indent, its continuation
 * lines indented to sit under its text. A heading stays as it is, and a word
 * longer than the width, such as a URL, stays whole on a line of its own.
 */
export function commitMessage(subject: string, body: string): string {
  const out: string[] = [];
  let words: string[] = [];
  let first = "";
  let rest = "";
  const flush = () => {
    if (words.length > 0) out.push(fill(words, first, rest));
    words = [];
  };
  for (const line of body.trim().split("\n")) {
    const item = ITEM.exec(line);
    if (line.trim() === "") {
      flush();
      if (out.at(-1) !== "") out.push("");
    } else if (HEADING.test(line)) {
      flush();
      out.push(line);
    } else if (item) {
      flush();
      first = `${item[1]}${item[2]} `;
      rest = " ".repeat(first.length);
      words = line.slice(item[0].length).match(/\S+/g) ?? [];
    } else {
      if (words.length === 0) first = rest = "";
      words.push(...line.trim().split(/\s+/));
    }
  }
  flush();
  return `${subject}\n\n${out.join("\n")}\n`;
}

/** Fills `words` at the width, the first line after `first` and each later line after `rest`. */
function fill(words: string[], first: string, rest: string): string {
  const lines: string[] = [];
  let line = first + words[0];
  for (const word of words.slice(1)) {
    if (line.length + 1 + word.length <= WIDTH) line += ` ${word}`;
    else {
      lines.push(line);
      line = rest + word;
    }
  }
  lines.push(line);
  return lines.join("\n");
}

/** A commit git refused, such as by a hook or for an unset identity; the message is git's cause. */
export class CommitRefused extends Error {}

/**
 * Commits everything in the worktree, ignored files aside, as one commit under
 * `commitMessage(subject, body)`, an empty one where nothing changed, and
 * returns its sha. Hooks run as git runs them; bypassing one is the caller's
 * decision, not this one's.
 */
export async function land(subject: string, body: string, tree: string): Promise<string> {
  await gitOrThrow(["add", "-A"], tree);
  // --cleanup=verbatim, so the message lands byte for byte as composed.
  const committed = await git(
    ["commit", "-q", "--allow-empty", "--cleanup=verbatim", "-m", commitMessage(subject, body)],
    tree,
  );
  if (!committed.ok) {
    throw new CommitRefused(`git refused the commit: ${(committed.stderr + committed.stdout).trim()}`);
  }
  return headSha(tree);
}

/**
 * The work `removeWorktree` would refuse to remove the worktree over, one
 * line per path, as `git worktree remove` itself checks for it: modified and
 * untracked files. Empty where there is none.
 */
export async function unremovable(tree: string): Promise<string> {
  return gitOrThrow(["status", "--porcelain", "--ignore-submodules=none"], tree);
}

/** Removes the plan's worktree, keeping its branch. */
export async function removeWorktree(tree: string): Promise<void> {
  // Run from the repository root, not from inside the tree being removed.
  const { root } = await firstListed(tree);
  await gitOrThrow(["worktree", "remove", tree], root);
  wrote();
}
