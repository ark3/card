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
/**
 * One call's reply; `run` is shell the stand-in runs in its working directory
 * first, as the session's work, `answer` what it then writes to the answer
 * file, and `trap` shell it runs when sent SIGTERM, before it exits.
 */
export type Reply = { answer?: string; stdout?: string; stderr?: string; exit?: number; run?: string; trap?: string };

/**
 * The stand-in linked onto a PATH as each of `names`, and a control directory
 * it records into and answers from. The PATH holds git beside the stand-ins
 * and nothing else, since a run the test starts in another process finds git
 * on it.
 */
export function stand(names = ["claude", "pi"]): string {
  const bin = tempDir();
  for (const name of names) symlinkSync(STUB, path.join(bin, name));
  symlinkSync(Bun.which("git")!, path.join(bin, "git"));
  const control = tempDir();
  process.env.PATH = bin;
  process.env.HARNESS_STUB = control;
  process.env.HARNESS_STUB_PATH = OUTER_PATH;
  return control;
}

/** What the stand-in does on each call to session `id`, in order. */
export function script(control: string, id: string, ...replies: Reply[]): void {
  answers(path.join(control, id, "answers"), replies);
}

/**
 * What the stand-in does for each session launched under an id nothing is
 * scripted for, in launch order, one list of replies per session. For
 * sessions whose ids are drawn in another process, such as a run's, which no
 * spy on `crypto.randomUUID` in the test reaches.
 */
export function queue(control: string, ...sessions: Reply[][]): void {
  sessions.forEach((replies, index) => answers(path.join(control, "queue", String(index + 1), "answers"), replies));
}

function answers(root: string, replies: Reply[]): void {
  replies.forEach((reply, index) => {
    const dir = path.join(root, String(index + 1));
    mkdirSync(dir, { recursive: true });
    if (reply.answer !== undefined) writeFileSync(path.join(dir, "answer"), reply.answer);
    if (reply.stdout !== undefined) writeFileSync(path.join(dir, "stdout"), reply.stdout);
    if (reply.stderr !== undefined) writeFileSync(path.join(dir, "stderr"), reply.stderr);
    if (reply.exit !== undefined) writeFileSync(path.join(dir, "exit"), String(reply.exit));
    if (reply.run !== undefined) writeFileSync(path.join(dir, "run"), reply.run);
    if (reply.trap !== undefined) writeFileSync(path.join(dir, "trap"), reply.trap);
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
