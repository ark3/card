import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { git, inLinkedWorktree, listWorktrees, type Worktree } from "../git.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

type Checkout = { root: string; branch: string; sha: string };

/**
 * The first record of `git worktree list --porcelain`, which is the main
 * checkout, or the repository itself where that is bare and so has no checkout
 * of its own.
 */
async function firstListed(cwd: string): Promise<Worktree> {
  const first = (await listWorktrees(cwd))[0];
  if (first === undefined) throw new Error("git named no worktree");
  return first;
}

/**
 * The main checkout, which `git worktree list` always names first, with its
 * branch resolved explicitly. Taking the base from `HEAD` instead follows the
 * *current* worktree when a tree is cut from inside another one, which stacks
 * temporary branches on each other.
 */
export async function mainCheckout(cwd: string): Promise<Checkout> {
  const { root, sha, branch } = await firstListed(cwd);

  // A bare repository is caught here too: its record carries no `HEAD` line.
  if (sha === undefined) throw new Error("git named no main checkout");
  if (branch === undefined) {
    throw new Error(`the main checkout at ${root} is on a detached HEAD, so there is no branch to cut from`);
  }
  return { root, branch: branch.replace(/^refs\/heads\//, ""), sha };
}

/**
 * Refuses a deck-writing verb run from a linked worktree, which is where a
 * dispatched session works: filing and closing are the dispatching session's
 * work, and where the deck is committed in the tree the write lands in the main
 * checkout's tree, uncommitted, where the dispatched session's branch never
 * sees it.
 */
export async function refuseFromLinkedWorktree(verb: string, cwd: string): Promise<void> {
  if (!(await inLinkedWorktree(cwd))) return;
  // The root alone, not `mainCheckout`: a detached or bare main checkout has no
  // base branch, and this refusal holds either way, so resolving one here would
  // replace this message with one about cutting a branch.
  const { root, bare } = await firstListed(cwd);
  const where = bare ? `${root}, the bare repository the deck is reached from` : `the main checkout at ${root}`;
  throw new Error(
    `card ${verb} writes the deck, which is the dispatching session's work, not a dispatched one's; run it from ${where}`,
  );
}

export async function run(args: string[], cwd: string): Promise<void> {
  const id = args[0];
  if (id === undefined || args.length > 1) {
    throw new Error("usage: card worktree <id>");
  }
  if (!ID.test(id)) {
    throw new Error(`\`${id}\` is not a usable id: a letter or digit, then letters, digits, - or _`);
  }

  const main = await mainCheckout(cwd);
  const trees = path.join(main.root, ".worktrees");
  const treePath = path.join(trees, id);
  const branch = `card/${id}`;
  // Checked here rather than left to git, which creates the branch before it
  // notices the path and would leave that branch behind.
  if (existsSync(treePath)) throw new Error(`${treePath} already exists`);

  await mkdir(trees, { recursive: true });
  // `*` hides the trees, and this file, from git status, so the tool depends on
  // nothing machine-level to keep them out of the repository.
  await Bun.write(path.join(trees, ".gitignore"), "*\n");

  // --no-track: the temporary branch is never pushed, and tracking the base
  // makes a stray push in the tree aim at it.
  const added = await git(
    ["worktree", "add", "--no-track", "-b", branch, treePath, main.branch],
    main.root,
  );
  if (!added.ok) throw new Error(added.stderr.trim() || `could not cut a worktree at ${treePath}`);

  console.log(`tree ${treePath}`);
  console.log(`branch ${branch}, cut from ${main.branch} at ${main.sha}`);
}
