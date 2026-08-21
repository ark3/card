import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { resolveDeck } from "../src/deck.ts";
import { run as author } from "../src/verbs/author.ts";
import { run as execute } from "../src/verbs/execute.ts";
import { run as init } from "../src/verbs/init.ts";
import { run as status } from "../src/verbs/status.ts";
import { clearCardRoot, removeTempDirs, tempDir, tempRepo } from "./helpers.ts";

// The probe writes into $HOME, so $HOME is the whole seam: a directory this
// process cannot write to stands in for the sandbox, a writable one for the
// sandbox being off, and a missing one for a verdict never reached.
const HOME = process.env.HOME;
const readOnlyHome = tempDir();
chmodSync(readOnlyHome, 0o500);

beforeEach(clearCardRoot);
afterEach(() => {
  if (HOME === undefined) delete process.env.HOME;
  else process.env.HOME = HOME;
});
afterAll(() => chmodSync(readOnlyHome, 0o700));
afterAll(removeTempDirs);

/** Everything the verb printed, and whatever it threw instead of printing. */
async function capture(fn: () => Promise<void>): Promise<{ out: string; error: Error | null }> {
  const chunks: string[] = [];
  const log = console.log;
  const write = process.stdout.write.bind(process.stdout);
  console.log = (...parts: unknown[]) => chunks.push(`${parts.join(" ")}\n`);
  process.stdout.write = ((chunk: string) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  let error: Error | null = null;
  try {
    await fn();
  } catch (thrown) {
    error = thrown as Error;
  } finally {
    console.log = log;
    process.stdout.write = write;
  }
  return { out: chunks.join(""), error };
}

test("a sandbox that is off stops the session, having printed nothing", async () => {
  const repo = await tempRepo();
  await init(["proj"], repo);
  const home = tempDir();
  process.env.HOME = home;

  const { out, error } = await capture(() => status([], repo));

  expect(error?.message).toContain("the sandbox is off");
  expect(out).toBe("");
  expect(existsSync(path.join(home, ".card-sandbox-probe"))).toBe(false);
});

test("a probe that cannot land is not a pass", async () => {
  const repo = await tempRepo();
  await init(["proj"], repo);
  process.env.HOME = path.join(tempDir(), "gone");

  const { out, error } = await capture(() => status([], repo));

  expect(error?.message).toContain("cannot be verified");
  expect(error?.message).toContain("ENOENT");
  expect(out).toBe("");
});

test("nowhere to probe is not a pass either", async () => {
  const repo = await tempRepo();
  await init(["proj"], repo);
  delete process.env.HOME;

  const { out, error } = await capture(() => status([], repo));

  expect(error?.message).toContain("HOME is unset");
  expect(out).toBe("");
});

test("says nothing about cards when there is no deck", async () => {
  process.env.HOME = readOnlyHome;
  const repo = await tempRepo();
  const loose = tempDir();

  for (const cwd of [repo, loose]) {
    const { out, error } = await capture(() => status([], cwd));
    expect(error).toBeNull();
    expect(out).toBe("No deck for this project. `card init <prefix>` starts one.\n");
    for (const teaching of ["card new", "card list", "## Mode", "one-directional", "Deck:"]) {
      expect(out).not.toContain(teaching);
    }
  }
});

test("reports the deck, its counts, and then the payload", async () => {
  const repo = await tempRepo();
  await init(["proj"], repo);
  const deck = (await resolveDeck(repo))!;
  await Bun.write(path.join(deck.openDir, "proj-behilo.md"), "# one\n");
  await Bun.write(path.join(deck.openDir, "proj-vezipo.md"), "# two\n");
  await Bun.write(path.join(deck.closedDir, "proj-kamuno.md"), "# three\n");
  process.env.HOME = readOnlyHome;

  const { out, error } = await capture(() => status([], repo));

  expect(error).toBeNull();
  expect(out.split("\n")[0]).toBe(`Deck: ${deck.deckDir} — 2 open, 1 closed.`);
  expect(out).toContain("## Mode");
  expect(out).toContain("card list --ready");
  expect(out).toContain("References are one-directional");
  expect(out).not.toContain("{{");
  expect(out).not.toContain("CARD_ROOT");
});

test("says so when the deck came from CARD_ROOT, which wins silently otherwise", async () => {
  const repo = await tempRepo();
  const elsewhere = tempDir();
  process.env.CARD_ROOT = elsewhere;
  await init(["other"], repo);
  const deck = (await resolveDeck(repo))!;
  process.env.HOME = readOnlyHome;

  const { out } = await capture(() => status([], repo));

  expect(out.split("\n")[0]).toBe(`Deck: ${deck.deckDir} (from CARD_ROOT) — 0 open, 0 closed.`);
});

// `author` and `execute` are the modes `status` points at, and every line of
// either is an instruction to run a verb against a deck.
test("author and execute print their procedure, and only where there is a deck", async () => {
  const repo = await tempRepo();

  await expect(author([], repo)).rejects.toThrow(/no deck here/);
  await expect(execute([], repo)).rejects.toThrow(/no deck here/);

  await init(["proj"], repo);
  const authoring = await capture(() => author([], repo));
  expect(authoring.out).toContain("# Authoring");
  expect(authoring.out).toContain("Sweep the closed pile first");

  const executing = await capture(() => execute([], repo));
  expect(executing.out).toContain("# Execution");
  expect(executing.out).toContain("card worktree <id>");
});
