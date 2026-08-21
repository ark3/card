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
