import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { git } from "../src/git.ts";
import { run as cardList } from "../src/verbs/list.ts";
import { run as cardRun } from "../src/verbs/run.ts";
import { clearCardRoot, removeTempDirs, tempDir, tempRepo } from "./helpers.ts";

const STUB = path.join(import.meta.dir, "run-stub.sh");
const CARD = path.join(import.meta.dir, "..", "src", "card.ts");

/** Where temporary directories go, and where commands are found, outside this file, which runs beside others. */
const OUTER_TMPDIR = process.env.TMPDIR;
const OUTER_PATH = process.env.PATH;

/**
 * What every PATH a test builds carries besides the stand-ins: git for the
 * verb, and bun for the card entry point the stub closes cards through. Linked
 * one by one rather than taken as directories, since a directory holding git
 * can hold a real `claude`, `pi` or `sbox` too.
 */
const TOOLS = ["git", "bun"].map((name) => {
  const found = Bun.which(name, { PATH: OUTER_PATH ?? "" });
  if (found === null) throw new Error(`${name} is not on PATH`);
  return { name, found };
});

function restoreEnv(): void {
  if (OUTER_TMPDIR === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = OUTER_TMPDIR;
  if (OUTER_PATH === undefined) delete process.env.PATH;
  else process.env.PATH = OUTER_PATH;
}

beforeEach(() => {
  clearCardRoot();
  // Every run makes a directory named for the second it started in, so each
  // test gets its own temp directory rather than racing the one before it.
  restoreEnv();
  process.env.TMPDIR = tempDir();
});
afterAll(() => {
  restoreEnv();
  removeTempDirs();
});

type Stand = "claude" | "pi" | "sbox";

type Config = {
  /** Puts the deck in the working tree, where `git status` can see it. */
  inTree?: boolean;
  public?: boolean;
  /** The stand-ins on PATH; Claude Code under `sbox` unless a test says otherwise. */
  on?: Stand[];
  /** Appended to the config verbatim. */
  extra?: string;
};

type Bed = { repo: string; deckDir: string; control: string };

/** A repository with a deck, and a PATH holding the stand-ins the test names. */
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
  if (config.extra !== undefined) lines.push("", config.extra);
  await Bun.write(path.join(cardDir, "card-config.toml"), `${lines.join("\n")}\n`);

  const bin = tempDir();
  for (const tool of TOOLS) symlinkSync(tool.found, path.join(bin, tool.name));
  for (const name of config.on ?? ["claude", "sbox"]) symlinkSync(STUB, path.join(bin, name));
  process.env.PATH = bin;
  process.env.RUN_STUB_CONTROL = control;
  process.env.RUN_STUB_CLI = CARD;

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
  const log = console.log;
  console.log = (...parts: unknown[]) => out.push(parts.join(" "));

  let error: Error | null = null;
  try {
    await fn();
  } catch (thrown) {
    error = thrown as Error;
  } finally {
    console.log = log;
  }
  return { out: out.join("\n").trim(), error };
}

/** The report the run wrote, found by the path it printed to stdout. */
async function reportOf(out: string): Promise<{ dir: string; text: string }> {
  const reportPath = out.trim().split("\n").pop()!;
  return { dir: path.dirname(reportPath), text: await Bun.file(reportPath).text() };
}

/** The session id the stub echoed back out of its own argv, in that card's section. */
function sessionOf(text: string, id: string): string {
  return /^session (\S+)$/m.exec(text.split(`## ${id}`)[1]!)![1]!;
}

test("a series the sessions all close done finishes, in order, each section resumable", async () => {
  const here = await bed();
  for (const id of ["proj-alpha", "proj-beta", "proj-gamma"]) await card(here, id);
  for (const id of ["proj-alpha", "proj-beta", "proj-gamma"]) await tell(here, id, "done");

  const { out, error } = await capture(() =>
    cardRun(["proj-alpha", "proj-beta", "proj-gamma"], here.repo),
  );

  expect(error).toBeNull();
  const { text } = await reportOf(out);
  expect(text).toContain("Finished: every card in the series is closed done.");
  expect(text.indexOf("## proj-alpha")).toBeLessThan(text.indexOf("## proj-beta"));
  expect(text.indexOf("## proj-beta")).toBeLessThan(text.indexOf("## proj-gamma"));

  // Every section resumes the session the verb actually launched, under the
  // wrapper it ran in and from the main checkout, where the harness finds it.
  const resumed = [...text.matchAll(/^resume: cd (\S+) && sbox claude --resume (\S+)$/gm)];
  const launched = [...text.matchAll(/^session (\S+)$/gm)].map((match) => match[1]);
  expect(resumed).toHaveLength(3);
  expect(resumed.map((match) => match[1])).toEqual([here.repo, here.repo, here.repo]);
  expect(resumed.map((match) => match[2])).toEqual(launched);
});

test("with claude and pi both on PATH the session is Claude Code, and the stage line and report say why", async () => {
  const here = await bed({ on: ["claude", "pi", "sbox"] });
  await card(here, "proj-alpha");
  await tell(here, "proj-alpha", "done");

  const { out, error } = await capture(() => cardRun(["proj-alpha"], here.repo));

  expect(error).toBeNull();
  const { dir, text } = await reportOf(out);
  expect(await Bun.file(path.join(dir, "proj-alpha.log")).text()).toContain("harness claude");
  const what = "claude under sbox, chosen because claude is on PATH";
  expect(out).toMatch(new RegExp(`proj-alpha starting: ${what}; logging to `));
  expect(text).toContain(`Sessions ran ${what}.`);
});

test("with only pi on PATH the session is Pi, and both resume lines are Pi's own under sbox", async () => {
  const here = await bed({ on: ["pi", "sbox"] });
  for (const id of ["proj-alpha", "proj-beta"]) await card(here, id);
  await tell(here, "proj-alpha", "done");

  const { out, error } = await capture(() => cardRun(["proj-alpha", "proj-beta"], here.repo));

  expect(error?.message).toContain("proj-beta ended open rather than done");
  const { dir, text } = await reportOf(out);
  expect(await Bun.file(path.join(dir, "proj-alpha.log")).text()).toContain("harness pi");
  const what = "pi under sbox, chosen because pi is on PATH and claude is not";
  expect(out).toContain(`proj-beta starting: ${what}; `);
  expect(text).toContain(`Sessions ran ${what}.`);

  const session = sessionOf(text, "proj-beta");
  expect(text).toContain(`Resume that session with: cd ${here.repo} && sbox pi --session ${session}`);
  expect(text).toContain(`resume: cd ${here.repo} && sbox pi --session ${session}`);
  expect(text).not.toContain("--resume");
});

test("with neither claude nor pi on PATH the run refuses before anything launches", async () => {
  const here = await bed({ on: ["sbox"] });
  await card(here, "proj-alpha");
  await tell(here, "proj-alpha", "done");

  const { out, error } = await capture(() => cardRun(["proj-alpha"], here.repo));

  expect(error?.message).toContain("neither claude nor pi is on PATH");
  expect(out).toBe("");
  expect(existsSync(path.join(here.deckDir, "open", "proj-alpha.md"))).toBe(true);
});

test("--harness overrides the choice PATH would make, and the report says the flag chose it", async () => {
  const here = await bed({ on: ["claude", "pi", "sbox"] });
  await card(here, "proj-alpha");
  await tell(here, "proj-alpha", "done");

  const { out, error } = await capture(() => cardRun(["--harness", "pi", "proj-alpha"], here.repo));

  expect(error).toBeNull();
  const { dir, text } = await reportOf(out);
  expect(await Bun.file(path.join(dir, "proj-alpha.log")).text()).toContain("harness pi");
  expect(text).toContain("Sessions ran pi under sbox, chosen because --harness named it.");
  expect(text).toContain(`resume: cd ${here.repo} && sbox pi --session `);
});

test("--harness naming a harness that is not on PATH refuses before anything launches", async () => {
  const here = await bed({ on: ["claude", "sbox"] });
  await card(here, "proj-alpha");
  await tell(here, "proj-alpha", "done");

  const { out, error } = await capture(() => cardRun(["--harness", "pi", "proj-alpha"], here.repo));

  expect(error?.message).toContain("pi is not on PATH");
  expect(out).toBe("");
  expect(existsSync(path.join(here.deckDir, "open", "proj-alpha.md"))).toBe(true);
});

test("sbox on PATH wraps the session, whose argv carries no --model and nothing else the verb did not name", async () => {
  const here = await bed();
  // A label that once routed to a model of its own routes nowhere now.
  await card(here, "proj-alpha", ["payload"]);
  await tell(here, "proj-alpha", "done");

  const { out, error } = await capture(() => cardRun(["proj-alpha"], here.repo));

  expect(error).toBeNull();
  const { dir } = await reportOf(out);
  const log = await Bun.file(path.join(dir, "proj-alpha.log")).text();
  expect(log.indexOf("sbox wrapped")).toBe(0);
  expect(log).toContain("harness claude");
  expect(log).not.toContain("--model");
  const session = /^session (\S+)$/m.exec(log)![1];
  expect(log).toContain(
    `argv -p --session-id ${session} --name card run proj-alpha Please execute the card proj-alpha\n`,
  );
});

test("without sbox on PATH the run refuses before anything launches, naming --no-sbox", async () => {
  const here = await bed({ on: ["claude"] });
  await card(here, "proj-alpha");
  await tell(here, "proj-alpha", "done");

  const { out, error } = await capture(() => cardRun(["proj-alpha"], here.repo));

  expect(error?.message).toContain("sbox is not on PATH");
  expect(error?.message).toContain("--no-sbox");
  expect(out).toBe("");
  expect(existsSync(path.join(here.deckDir, "open", "proj-alpha.md"))).toBe(true);
});

test("--no-sbox runs the harness unwrapped with no flag added, and its resume line has no sbox", async () => {
  const here = await bed({ on: ["claude"] });
  await card(here, "proj-alpha");
  // Nothing told: the session hands back, so the stop message carries a resume.

  const { out, error } = await capture(() => cardRun(["--no-sbox", "proj-alpha"], here.repo));

  expect(error?.message).toContain("proj-alpha ended open rather than done");
  const { dir, text } = await reportOf(out);
  const log = await Bun.file(path.join(dir, "proj-alpha.log")).text();
  expect(log).not.toContain("sbox wrapped");
  const session = sessionOf(text, "proj-alpha");
  expect(log).toContain(
    `argv -p --session-id ${session} --name card run proj-alpha Please execute the card proj-alpha\n`,
  );
  expect(text).toContain("Sessions ran claude without sbox, as --no-sbox asked, chosen because claude is on PATH.");
  expect(text).toContain(`Resume that session with: cd ${here.repo} && claude --resume ${session}`);
  expect(text).toContain(`resume: cd ${here.repo} && claude --resume ${session}`);
});

test("stage lines and the run directory carry local time, not UTC", async () => {
  const here = await bed();
  await card(here, "proj-alpha");
  await tell(here, "proj-alpha", "done");

  // A zone far from UTC, so a UTC stamp cannot pass by coincidence.
  const zone = process.env.TZ;
  process.env.TZ = "Pacific/Kiritimati";
  try {
    const { out, error } = await capture(() => cardRun(["proj-alpha"], here.repo));
    expect(error).toBeNull();

    // A stamp without a zone parses as local time, so it lands near now only
    // if it was written in local time.
    const near = (stamp: string) => Math.abs(Date.now() - new Date(stamp).getTime()) < 60_000;
    const line = out.match(/^\[(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)\] /m);
    expect(line).not.toBeNull();
    expect(near(`${line![1]}T${line![2]}`)).toBe(true);

    const { dir } = await reportOf(out);
    const name = path.basename(dir).match(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)$/);
    expect(name).not.toBeNull();
    expect(near(`${name![1]}T${name![2]}:${name![3]}:${name![4]}`)).toBe(true);
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
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
  const session = sessionOf(text, "proj-beta");
  expect(lead).toContain(`Resume that session with: cd ${here.repo} && sbox claude --resume ${session}`);
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

test("on a public deck, deck dirt is committed as chore: close <id> and the run goes on", async () => {
  const here = await bed({ inTree: true, public: true });
  for (const id of ["proj-alpha", "proj-beta"]) await card(here, id);
  for (const id of ["proj-alpha", "proj-beta"]) await tell(here, id, "done");
  await commitAll(here.repo);

  const { out, error } = await capture(() => cardRun(["proj-alpha", "proj-beta"], here.repo));

  expect(error).toBeNull();
  const { text } = await reportOf(out);
  expect(text).toContain("Finished: every card in the series is closed done.");
  expect((await git(["status", "--porcelain"], here.repo)).stdout).toBe("");
  const log = (await git(["log", "--format=%s"], here.repo)).stdout;
  expect(log).toContain("chore: close proj-alpha\n");
  expect(log).toContain("chore: close proj-beta\n");
});

test("on a deck that is not public, deck dirt stops the run and nothing is committed", async () => {
  const here = await bed({ inTree: true });
  for (const id of ["proj-alpha", "proj-beta"]) await card(here, id);
  for (const id of ["proj-alpha", "proj-beta"]) await tell(here, id, "done");
  await commitAll(here.repo);

  const { out, error } = await capture(() => cardRun(["proj-alpha", "proj-beta"], here.repo));

  expect(error?.message).toContain("is dirty after proj-alpha");
  const { dir } = await reportOf(out);
  expect(existsSync(path.join(dir, "proj-beta.log"))).toBe(false);
  expect((await git(["log", "--format=%s"], here.repo)).stdout).not.toContain("chore: close");
});

test("dirt outside the deck stops the run, public deck or not", async () => {
  const here = await bed({ inTree: true, public: true });
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

test("a leftover [run] section makes card run refuse, naming it, while another verb on the deck still works", async () => {
  const here = await bed({ extra: `[run]\nlaunch = ["${STUB}"]\nmodels = { "" = "the-default" }` });
  await card(here, "proj-alpha");
  await tell(here, "proj-alpha", "done");

  const ran = await capture(() => cardRun(["proj-alpha"], here.repo));

  expect(ran.error?.message).toContain(path.join(here.repo, ".git", "card", "card-config.toml"));
  expect(ran.error?.message).toContain("delete [run]");
  expect(ran.out).toBe("");
  expect(existsSync(path.join(here.deckDir, "open", "proj-alpha.md"))).toBe(true);

  const listed = await capture(() => cardList([], here.repo));
  expect(listed.error).toBeNull();
  expect(listed.out).toContain("proj-alpha");
});
