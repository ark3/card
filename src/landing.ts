import { mkdir } from "node:fs/promises";
import path from "node:path";
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

/**
 * Holds `branch` checked out in the plan's worktree, `.worktrees/<slug>` at the
 * repository root, and returns its path; a worktree already holding it there,
 * as when a dead run is carried on, is returned as it stands. While it stands,
 * git itself refuses to check the branch out anywhere else.
 */
export async function holdWorktree(slug: string, branch: string, cwd: string): Promise<string> {
  const { root } = await firstListed(cwd);
  const trees = path.join(root, ".worktrees");
  const tree = path.join(trees, slug);
  const holding = await listWorktrees(cwd);
  if (holding.some((listed) => listed.root === tree && listed.branch === `refs/heads/${branch}`)) return tree;

  await mkdir(trees, { recursive: true });
  // `*` hides the trees, and this file, from git status, so the tool depends on
  // nothing machine-level to keep them out of the repository.
  await Bun.write(path.join(trees, ".gitignore"), "*\n");
  await gitOrThrow(["worktree", "add", "-q", tree, branch], root);
  return tree;
}

/**
 * Resets the worktree hard to `commit` and cleans it: tracked edits, untracked
 * files and any commit past `commit` go, and ignored files stay, since
 * installed dependencies are why there is one worktree per plan.
 */
export async function discard(tree: string, commit = "HEAD"): Promise<void> {
  await gitOrThrow(["reset", "-q", "--hard", commit], tree);
  await gitOrThrow(["clean", "-q", "-f", "-d"], tree);
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

/** Removes the plan's worktree, keeping its branch. */
export async function removeWorktree(tree: string): Promise<void> {
  // Run from the repository root, not from inside the tree being removed.
  const { root } = await firstListed(tree);
  await gitOrThrow(["worktree", "remove", tree], root);
}
