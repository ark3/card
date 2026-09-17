import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { git } from "../src/git.ts";
import { run as cardRun } from "../src/verbs/run.ts";
import { clearCardRoot, removeTempDirs, tempDir, tempRepo } from "./helpers.ts";

const STUB = path.join(import.meta.dir, "run-stub.sh");
const CARD = path.join(import.meta.dir, "..", "src", "card.ts");

/** Where temporary directories go outside this file, which runs beside others. */
const OUTER_TMPDIR = process.env.TMPDIR;

function restoreTmpDir(): void {
  if (OUTER_TMPDIR === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = OUTER_TMPDIR;
}

beforeEach(() => {
  clearCardRoot();
  // Every run makes a directory named for the second it started in, so each
  // test gets its own temp directory rather than racing the one before it.
  restoreTmpDir();
  process.env.TMPDIR = tempDir();
});
afterAll(() => {
  restoreTmpDir();
  removeTempDirs();
});

type Config = {
  /** Puts the deck in the working tree, where `git status` can see it. */
  inTree?: boolean;
  public?: boolean;
  closeCommit?: string;
  models?: Record<string, string>;
};

type Bed = { repo: string; deckDir: string; control: string };

/** A repository with a deck, and a launch command pointing at the stub. */
async function bed(config: Config = {}): Promise<Bed> {
  const repo = await tempRepo();
  const control = tempDir();
  const cardDir = path.join(repo, ".git", "card");
  mkdirSync(cardDir, { recursive: true });
  const relative = config.inTree === true ? "../../deck" : "deck";
  const deckDir = path.resolve(cardDir, relative);
  mkdirSync(path.join(deckDir, "open"), { recursive: true });
  mkdirSync(path.join(deckDir, "closed"), { recursive: true });

  const lines = [`prefix = "proj"`, `deck = "${relative}"`];
  if (config.public === true) lines.push("public = true");
  lines.push("", "[run]", `launch = ["${STUB}", "${control}", "${CARD}"]`);
  if (config.models !== undefined) {
    const pairs = Object.entries(config.models).map(([label, model]) => `"${label}" = "${model}"`);
    lines.push(`models = { ${pairs.join(", ")} }`);
  }
  if (config.closeCommit !== undefined) lines.push(`close_commit = "${config.closeCommit}"`);
  await Bun.write(path.join(cardDir, "card-config.toml"), `${lines.join("\n")}\n`);

  return { repo, deckDir, control };
}

async function card(bed: Bed, id: string, labels: string[] = []): Promise<void> {
  const front = labels.length === 0 ? "" : `---\nlabels: [${labels.join(", ")}]\n---\n\n`;
  await Bun.write(path.join(bed.deckDir, "open", `${id}.md`), `${front}# ${id}\n\nBody.\n`);
}

/** What the stub does for that card: nothing said means it hands back open. */
async function tell(bed: Bed, id: string, ...directives: string[]): Promise<void> {
  await Bun.write(path.join(bed.control, id), `${directives.join("\n")}\n`);
}

/** Commits everything, so a deck kept in the tree starts the run clean. */
async function commitAll(repo: string): Promise<void> {
  await git(["add", "-A"], repo);
  await git(["commit", "-q", "-m", "seed the deck"], repo);
}

async function capture(fn: () => Promise<void>) {
  const out: string[] = [];
  const stages: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...parts: unknown[]) => out.push(parts.join(" "));
  console.error = (...parts: unknown[]) => stages.push(parts.join(" "));

  let error: Error | null = null;
  try {
    await fn();
  } catch (thrown) {
    error = thrown as Error;
  } finally {
    console.log = log;
    console.error = err;
  }
  return { out: out.join("\n").trim(), stages: stages.join("\n"), error };
}

/** The report the run wrote, found by the path it printed to stdout. */
async function reportOf(out: string): Promise<{ dir: string; text: string }> {
  const reportPath = out.trim().split("\n").pop()!;
  return { dir: path.dirname(reportPath), text: await Bun.file(reportPath).text() };
}

test("a series the sessions all close done finishes, in order, each section resumable", async () => {
  const here = await bed({ models: { "": "the-default", payload: "the-payload-model" } });
  for (const id of ["proj-alpha", "proj-beta"]) await card(here, id);
  await card(here, "proj-gamma", ["payload"]);
  for (const id of ["proj-alpha", "proj-beta", "proj-gamma"]) await tell(here, id, "done");

  const { out, error } = await capture(() =>
    cardRun(["proj-alpha", "proj-beta", "proj-gamma"], here.repo),
  );

  expect(error).toBeNull();
  const { text } = await reportOf(out);
  expect(text).toContain("Finished: every card in the series is closed done.");
  expect(text.indexOf("## proj-alpha")).toBeLessThan(text.indexOf("## proj-beta"));
  expect(text.indexOf("## proj-beta")).toBeLessThan(text.indexOf("## proj-gamma"));
  // The model is the card's first label the map names, else the deck's default.
  expect(text).toContain("model: the-default");
  expect(text).toContain("model: the-payload-model");

  // Every section resumes the session the verb actually launched, which is
  // what the stub echoed back out of its own argv.
  const resumed = [...text.matchAll(/^resume: claude --resume (\S+)$/gm)].map((match) => match[1]);
  const launched = [...text.matchAll(/^session (\S+)$/gm)].map((match) => match[1]);
  expect(resumed).toHaveLength(3);
  expect(resumed).toEqual(launched);
});

test("a card the session leaves open stops the run, and the report leads with its resume command", async () => {
  const here = await bed();
  for (const id of ["proj-alpha", "proj-beta"]) await card(here, id);
  await tell(here, "proj-alpha", "done");
  // Nothing told for proj-beta: the session hands back for the owner's input.

  const { out, error } = await capture(() => cardRun(["proj-alpha", "proj-beta"], here.repo));

  expect(error?.message).toContain("proj-beta ended open rather than done");
  const { text } = await reportOf(out);
  const lead = text.split("## proj-alpha")[0]!;
  expect(lead).toContain("Stopped at proj-beta");
  const session = /^session (\S+)$/m.exec(text.split("## proj-beta")[1]!)![1];
  expect(lead).toContain(`Resume that session with: claude --resume ${session}`);
});

test("a card already closed before the run is skipped, and the next one still runs", async () => {
  const here = await bed();
  await Bun.write(
    path.join(here.deckDir, "closed", "proj-alpha.md"),
    "---\nclosed: moot\n---\n\n# proj-alpha\n\nResolved by hand.\n",
  );
  await card(here, "proj-beta");
  await tell(here, "proj-beta", "done");

  const { out, error } = await capture(() => cardRun(["proj-alpha", "proj-beta"], here.repo));

  expect(error).toBeNull();
  const { dir, text } = await reportOf(out);
  expect(existsSync(path.join(dir, "proj-alpha.log"))).toBe(false);
  expect(text).toContain("resume: no session ran");
  expect(await Bun.file(path.join(dir, "proj-beta.log")).text()).toContain("stub ran for proj-beta");
});

test("a dirty main checkout stops the run before anything is launched", async () => {
  const here = await bed();
  await card(here, "proj-alpha");
  await tell(here, "proj-alpha", "done");
  await Bun.write(path.join(here.repo, "stray.txt"), "left behind\n");

  const { out, error } = await capture(() => cardRun(["proj-alpha"], here.repo));

  expect(error?.message).toContain("stray.txt");
  const { dir } = await reportOf(out);
  expect(existsSync(path.join(dir, "proj-alpha.log"))).toBe(false);
  expect(await Bun.file(path.join(here.deckDir, "open", "proj-alpha.md")).exists()).toBe(true);
});

test("with a close-commit template, deck dirt is committed and the run goes on", async () => {
  const here = await bed({ inTree: true, public: true, closeCommit: "chore: close {id}" });
  for (const id of ["proj-alpha", "proj-beta"]) await card(here, id);
  for (const id of ["proj-alpha", "proj-beta"]) await tell(here, id, "done");
  await commitAll(here.repo);

  const { out, error } = await capture(() => cardRun(["proj-alpha", "proj-beta"], here.repo));

  expect(error).toBeNull();
  const { text } = await reportOf(out);
  expect(text).toContain("Finished: every card in the series is closed done.");
  expect((await git(["status", "--porcelain"], here.repo)).stdout).toBe("");
  const log = (await git(["log", "--format=%s"], here.repo)).stdout;
  expect(log).toContain("chore: close proj-alpha");
  expect(log).toContain("chore: close proj-beta");
});

test("dirt outside the deck stops the run whatever the template says", async () => {
  const here = await bed({ inTree: true, public: true, closeCommit: "chore: close {id}" });
  for (const id of ["proj-alpha", "proj-beta"]) await card(here, id);
  await tell(here, "proj-alpha", "done", `dirty ${path.join(here.repo, "stray.txt")}`);
  await tell(here, "proj-beta", "done");
  await commitAll(here.repo);

  const { out, error } = await capture(() => cardRun(["proj-alpha", "proj-beta"], here.repo));

  expect(error?.message).toContain("stray.txt");
  const { dir } = await reportOf(out);
  expect(existsSync(path.join(dir, "proj-beta.log"))).toBe(false);
  expect((await git(["log", "--format=%s"], here.repo)).stdout).not.toContain("chore: close");
});

test("a close-commit template on a deck that is not public refuses at config time", async () => {
  const here = await bed({ closeCommit: "chore: close {id}" });
  await card(here, "proj-alpha");
  await tell(here, "proj-alpha", "done");

  const { error } = await capture(() => cardRun(["proj-alpha"], here.repo));

  expect(error?.message).toContain("close_commit on a deck that is not public");
});

test("a deck with no [run] section has no command to launch", async () => {
  const repo = await tempRepo();
  const cardDir = path.join(repo, ".git", "card");
  mkdirSync(path.join(cardDir, "deck", "open"), { recursive: true });
  await Bun.write(path.join(cardDir, "card-config.toml"), 'prefix = "proj"\n');

  const { error } = await capture(() => cardRun(["proj-alpha"], repo));
  expect(error?.message).toContain("no [run] launch");
});
