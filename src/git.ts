export type GitResult = { ok: boolean; stdout: string; stderr: string };

export async function git(args: string[], cwd: string): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { ok: (await proc.exited) === 0, stdout, stderr };
}

/** `git` where a failure is the caller's failure: its stdout, or git's error thrown. */
export async function gitOrThrow(args: string[], cwd: string): Promise<string> {
  const result = await git(args, cwd);
  if (!result.ok) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

/** The commit `cwd`'s HEAD names. */
export async function headSha(cwd: string): Promise<string> {
  return (await gitOrThrow(["rev-parse", "HEAD"], cwd)).trim();
}

/** Whether a local branch named `branch` exists. */
export async function branchExists(branch: string, cwd: string): Promise<boolean> {
  return (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd)).ok;
}

/**
 * The main checkout's `.git`, from anywhere: a subdirectory, a worktree, or
 * inside the deck itself. Null outside a git repository. This is the whole of
 * the worktree-to-deck mapping.
 */
export async function gitCommonDir(cwd: string): Promise<string | null> {
  const result = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  return result.ok ? result.stdout.trim() : null;
}

/**
 * Whether `cwd` sits in a linked worktree rather than the main checkout: its
 * own `.git` is a file pointing into the common directory, so the two paths
 * differ. False outside a git repository, where nothing is a worktree.
 */
export async function inLinkedWorktree(cwd: string): Promise<boolean> {
  const own = await git(["rev-parse", "--path-format=absolute", "--git-dir"], cwd);
  const common = await gitCommonDir(cwd);
  if (!own.ok || common === null) return false;
  return own.stdout.trim() !== common;
}

/**
 * One record of `git worktree list --porcelain`. `sha` and `branch` are both
 * absent for a bare repository, which has no checkout of its own, and `branch`
 * alone is absent for a detached HEAD.
 */
export type Worktree = { root: string; bare: boolean; sha?: string; branch?: string };

/**
 * Every worktree git lists, in git's own order, which always names the main
 * checkout first. The porcelain record's field names are spelled here and
 * nowhere else, so a change in how the tool reads the format has one site.
 */
export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const listed = await git(["worktree", "list", "--porcelain"], cwd);
  if (!listed.ok) throw new Error(listed.stderr.trim() || "not in a git repository");

  return listed.stdout.split("\n\n").flatMap((record) => {
    const lines = record.split("\n");
    const field = (name: string) =>
      lines.find((line) => line.startsWith(`${name} `))?.slice(name.length + 1);
    const root = field("worktree");
    // The output ends in a blank line, which splits into a record naming no
    // worktree; it is not one, and neither is anything else shaped like it.
    if (root === undefined) return [];
    return [{ root, bare: lines.includes("bare"), sha: field("HEAD"), branch: field("branch") }];
  });
}

/**
 * The first record of `git worktree list --porcelain`, which is the main
 * checkout, or the repository itself where that is bare and so has no checkout
 * of its own.
 */
export async function firstListed(cwd: string): Promise<Worktree> {
  const first = (await listWorktrees(cwd))[0];
  if (first === undefined) throw new Error("git named no worktree");
  return first;
}

/**
 * Refuses a deck-writing verb run from a linked worktree, which is where a
 * role session works: a role session files findings only through its answer,
 * and where the deck is committed in the tree the write lands in the main
 * checkout's tree, uncommitted, where the role session's branch never sees it.
 */
export async function refuseFromLinkedWorktree(verb: string, cwd: string): Promise<void> {
  if (!(await inLinkedWorktree(cwd))) return;
  // The root alone, with no branch resolved: a detached or bare main checkout
  // has no branch, and this refusal holds either way.
  const { root, bare } = await firstListed(cwd);
  const where = bare ? `${root}, the bare repository the deck is reached from` : `the main checkout at ${root}`;
  throw new Error(
    `deck ${verb} does not run from a linked worktree, since a role session works in the plan's worktree and files findings only through its answer; run it from ${where}`,
  );
}
