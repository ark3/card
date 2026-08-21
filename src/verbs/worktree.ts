import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { git } from "../git.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

type Checkout = { root: string; branch: string; sha: string };

/**
 * The main checkout, which `git worktree list` always names first, with its
 * branch resolved explicitly. Taking the base from `HEAD` instead follows the
 * *current* worktree when a tree is cut from inside another one, which stacks
 * temporary branches on each other.
 */
async function mainCheckout(cwd: string): Promise<Checkout> {
  const listed = await git(["worktree", "list", "--porcelain"], cwd);
  if (!listed.ok) throw new Error(listed.stderr.trim() || "not in a git repository");

  const record = listed.stdout.split("\n\n")[0]!.split("\n");
  const field = (name: string) =>
    record.find((line) => line.startsWith(`${name} `))?.slice(name.length + 1);
  const root = field("worktree");
  const sha = field("HEAD");
  const branch = field("branch");

  if (root === undefined || sha === undefined) throw new Error("git named no main checkout");
  if (branch === undefined) {
    throw new Error(`the main checkout at ${root} is on a detached HEAD, so there is no branch to cut from`);
  }
  return { root, branch: branch.replace(/^refs\/heads\//, ""), sha };
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
