import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { git } from "../src/git.ts";

const created: string[] = [];

/** A throwaway directory under the system temp directory. */
export function tempDir(): string {
  // realpath, because a symlinked temp directory would make git's absolute
  // paths disagree with the ones the test built.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "card-test-")));
  created.push(dir);
  return dir;
}

/** A throwaway git repository with one commit, so worktrees can be cut. */
export async function tempRepo(): Promise<string> {
  const dir = tempDir();
  await git(["init", "-q", "-b", "main"], dir);
  await git(["config", "user.email", "test@example.invalid"], dir);
  await git(["config", "user.name", "card test"], dir);
  await Bun.write(path.join(dir, "README.md"), "seed\n");
  await git(["add", "README.md"], dir);
  await git(["commit", "-q", "-m", "seed"], dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** The environment every test starts from: no CARD_ROOT unless it sets one. */
export function clearCardRoot(): void {
  delete process.env.CARD_ROOT;
}
