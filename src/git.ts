export type GitResult = { ok: boolean; stdout: string; stderr: string };

export async function git(args: string[], cwd: string): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { ok: (await proc.exited) === 0, stdout, stderr };
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
