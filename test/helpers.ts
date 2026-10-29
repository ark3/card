import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

/**
 * A bare clone of `repo` with one linked worktree: a bare repository has no
 * checkout of its own, so every checkout of it is a linked one.
 */
export async function bareCloneWithWorktree(repo: string): Promise<{ bare: string; tree: string }> {
  const dir = tempDir();
  const bare = path.join(dir, "repo.git");
  await git(["clone", "-q", "--bare", repo, bare], dir);
  const tree = path.join(dir, "wt");
  await git(["worktree", "add", "-q", tree, "main"], bare);
  return { bare, tree };
}

export function removeTempDirs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** The environment every test starts from: no CARD_ROOT unless it sets one. */
export function clearCardRoot(): void {
  delete process.env.CARD_ROOT;
}

// The PATH the tests started with, which the stand-in's own commands need
// once a test's PATH holds only the stand-ins.
const OUTER_PATH = process.env.PATH;
const STUB = path.join(import.meta.dir, "harness-stub.sh");

export type Call = { argv: string[]; stdin: string; cwd: string };
/** One call's answer; `run` is shell the stand-in runs in its working directory first, as the session's work. */
export type Reply = { stdout?: string; stderr?: string; exit?: number; run?: string };

/**
 * The stand-in linked onto a PATH holding nothing else as both `claude` and
 * `pi`, and a control directory it records into and answers from.
 */
export function stand(): string {
  const bin = tempDir();
  for (const name of ["claude", "pi"]) symlinkSync(STUB, path.join(bin, name));
  const control = tempDir();
  process.env.PATH = bin;
  process.env.HARNESS_STUB = control;
  process.env.HARNESS_STUB_PATH = OUTER_PATH;
  return control;
}

/** What the stand-in does on each call to session `id`, in order. */
export function script(control: string, id: string, ...replies: Reply[]): void {
  replies.forEach((reply, index) => {
    const dir = path.join(control, id, "answers", String(index + 1));
    mkdirSync(dir, { recursive: true });
    if (reply.stdout !== undefined) writeFileSync(path.join(dir, "stdout"), reply.stdout);
    if (reply.stderr !== undefined) writeFileSync(path.join(dir, "stderr"), reply.stderr);
    if (reply.exit !== undefined) writeFileSync(path.join(dir, "exit"), String(reply.exit));
    if (reply.run !== undefined) writeFileSync(path.join(dir, "run"), reply.run);
  });
}

/** Every call the stand-in recorded for session `id`, in order. */
export function calls(control: string, id: string): Call[] {
  const dir = path.join(control, id, "calls");
  return readdirSync(dir)
    .map(Number)
    .sort((a, b) => a - b)
    .map((n) => {
      const read = (name: string) => readFileSync(path.join(dir, String(n), name), "utf8");
      return { argv: read("argv").trimEnd().split("\n"), stdin: read("stdin"), cwd: read("cwd").trimEnd() };
    });
}
