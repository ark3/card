import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { type Deck, resolveDeck } from "../src/deck.ts";
import { run as close } from "../src/verbs/close.ts";
import { run as init } from "../src/verbs/init.ts";
import { clearCardRoot, removeTempDirs, tempRepo } from "./helpers.ts";

const CARD = "---\nlabels: [PROJ-1]\n---\n\n# The card being closed\n\nIts body.\n";
const NOTE = "Landed as PROJ-1. Verified by the suite in test/close.test.ts.";

const realStdin = Bun.stdin;
let logged: string[] = [];
let errored: string[] = [];

beforeEach(() => {
  clearCardRoot();
  logged = [];
  errored = [];
  spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    logged.push(parts.join(" "));
  });
  spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errored.push(parts.join(" "));
  });
});
afterEach(() => mock.restore());
afterAll(() => {
  (Bun as unknown as { stdin: unknown }).stdin = realStdin;
  removeTempDirs();
});

/** Verbs read `Bun.stdin` directly, so a test hands them one. */
function onStdin(text: string): void {
  (Bun as unknown as { stdin: Blob }).stdin = new Blob([text]);
}

async function deckIn(): Promise<{ repo: string; deck: Deck }> {
  const repo = await tempRepo();
  await init(["proj"], repo);
  logged = [];
  return { repo, deck: (await resolveDeck(repo))! };
}

async function open(deck: Deck, id: string, text: string): Promise<string> {
  const file = path.join(deck.openDir, `${id}.md`);
  await Bun.write(file, text);
  return file;
}

test("moves the card and appends the explanation, in one act", async () => {
  const { repo, deck } = await deckIn();
  await open(deck, "proj-behilo", CARD);
  onStdin(`${NOTE}\n`);

  await close(["proj-behilo", "--done"], repo);

  expect(await Bun.file(path.join(deck.openDir, "proj-behilo.md")).exists()).toBe(false);
  expect(await Bun.file(path.join(deck.closedDir, "proj-behilo.md")).text()).toBe(`${CARD}\n${NOTE}\n`);
  expect(logged).toEqual(["closed proj-behilo", "nothing was waiting on it."]);
});

test("appends without reformatting a card the owner hand-wrote", async () => {
  const { repo, deck } = await deckIn();
  const byHand = "---\nlabels: [a,b]\n---\n# Squeezed together\nProse.\n";
  await open(deck, "proj-behilo", byHand);
  onStdin(`${NOTE}\n`);

  await close(["proj-behilo", "--done"], repo);

  expect(await Bun.file(path.join(deck.closedDir, "proj-behilo.md")).text()).toBe(`${byHand}\n${NOTE}\n`);
});

test("nothing on stdin refuses and leaves the card untouched in open/", async () => {
  const { repo, deck } = await deckIn();
  const file = await open(deck, "proj-behilo", CARD);

  onStdin("");
  await expect(close(["proj-behilo", "--done"], repo)).rejects.toThrow(/needs a close note on stdin/);
  onStdin("  \n\t\n");
  await expect(close(["proj-behilo", "--done"], repo)).rejects.toThrow(/needs a close note on stdin/);

  expect(await Bun.file(file).text()).toBe(CARD);
  expect(await Bun.file(path.join(deck.closedDir, "proj-behilo.md")).exists()).toBe(false);
});

test("an interruption before the move leaves the open card whole and closed/ empty", async () => {
  const { repo, deck } = await deckIn();
  const file = await open(deck, "proj-behilo", CARD);
  onStdin(`${NOTE}\n`);

  // `closed/` unwritable stops the verb at its first write, which is the
  // staged copy. Nothing has been renamed and nothing has been unlinked.
  await chmod(deck.closedDir, 0o555);
  try {
    await expect(close(["proj-behilo", "--done"], repo)).rejects.toThrow(/EACCES/);
  } finally {
    await chmod(deck.closedDir, 0o755);
  }

  expect(await Bun.file(file).text()).toBe(CARD);
  expect(await Array.fromAsync(new Bun.Glob("*").scan({ cwd: deck.closedDir, dot: true }))).toEqual([]);
});

test("an interruption after the move leaves the closed card whole, explanation and all", async () => {
  const { repo, deck } = await deckIn();
  const file = await open(deck, "proj-behilo", CARD);
  onStdin(`${NOTE}\n`);

  // `open/` unwritable lets the staged copy be written and renamed into
  // `closed/`, then stops the verb at the unlink.
  await chmod(deck.openDir, 0o555);
  try {
    await expect(close(["proj-behilo", "--done"], repo)).rejects.toThrow(/EACCES/);
  } finally {
    await chmod(deck.openDir, 0o755);
  }

  // Neither half-state: the closed copy has its explanation, and the copy
  // still in open/ is the card exactly as it was.
  expect(await Bun.file(path.join(deck.closedDir, "proj-behilo.md")).text()).toBe(`${CARD}\n${NOTE}\n`);
  expect(await Bun.file(file).text()).toBe(CARD);
});

for (const flag of ["--promoted", "--declined", "--moot"]) {
  test(`${flag} names every open card this one was blocking`, async () => {
    const { repo, deck } = await deckIn();
    await open(deck, "proj-behilo", CARD);
    await open(deck, "proj-vezipo", "---\nblocked-by: [proj-behilo]\n---\n\n# First dependent\n\nBody.\n");
    await open(deck, "proj-dumoka", "---\nblocked-by: [proj-behilo, proj-nosuch]\n---\n\n# Second dependent\n\nBody.\n");
    await open(deck, "proj-lakito", "---\nblocked-by: [proj-vezipo]\n---\n\n# Not a dependent\n\nBody.\n");
    onStdin("Went elsewhere; PROJ-42 is where the work will happen.\n");

    await close(["proj-behilo", flag], repo);

    const printed = logged.join("\n");
    expect(printed).toContain("its work never happened");
    expect(printed).toContain("proj-vezipo  First dependent");
    expect(printed).toContain("proj-dumoka  Second dependent");
    expect(printed).not.toContain("proj-lakito");
  });
}

test("names the file it could not parse and the dependents it still found", async () => {
  const { repo, deck } = await deckIn();
  await open(deck, "proj-behilo", CARD);
  await open(deck, "proj-vezipo", "---\nblocked-by: [proj-behilo]\n---\n\n# First dependent\n\nBody.\n");
  await open(deck, "proj-fanovi", "---\nkind: [chore]\n---\n\n# Typo in its frontmatter\n\nBody.\n");
  onStdin("Went elsewhere; PROJ-42 is where the work will happen.\n");

  // The scan is advisory and the close has already happened, so one bad file
  // must not turn a completed close into a reported failure.
  await close(["proj-behilo", "--moot"], repo);

  expect(logged.join("\n")).toContain("proj-vezipo  First dependent");
  expect(errored.join("\n")).toContain("proj-fanovi.md: unknown frontmatter field `kind`");
});

test("--done names the cards this one was blocking, as work that just came free", async () => {
  const { repo, deck } = await deckIn();
  await open(deck, "proj-behilo", CARD);
  await open(deck, "proj-vezipo", "---\nblocked-by: [proj-behilo]\n---\n\n# First dependent\n\nBody.\n");
  await open(deck, "proj-lakito", "---\nblocked-by: [proj-vezipo]\n---\n\n# Not a dependent\n\nBody.\n");
  onStdin(`${NOTE}\n`);

  await close(["proj-behilo", "--done"], repo);

  const printed = logged.join("\n");
  expect(printed).toContain("its work is at rest");
  expect(printed).toContain("proj-vezipo  First dependent");
  expect(printed).not.toContain("proj-lakito");
});

test("--done passes over a dependent another open card still blocks", async () => {
  const { repo, deck } = await deckIn();
  await open(deck, "proj-behilo", CARD);
  await open(deck, "proj-vezipo", "---\nblocked-by: [proj-behilo]\n---\n\n# Came free\n\nBody.\n");
  await open(deck, "proj-dumoka", "---\nblocked-by: [proj-behilo, proj-lakito]\n---\n\n# Still shut\n\nBody.\n");
  await open(deck, "proj-lakito", "---\n---\n\n# The other blocker, still open\n\nBody.\n");
  // A blocker that is closed holds nothing shut; one that is in neither
  // open/ nor closed/ still blocks, and the scan says so on stderr.
  await Bun.write(path.join(deck.closedDir, "proj-gonemo.md"), CARD);
  await open(deck, "proj-fanovi", "---\nblocked-by: [proj-behilo, proj-gonemo]\n---\n\n# Last blocker closed\n\nBody.\n");
  await open(deck, "proj-hitowa", "---\nblocked-by: [proj-behilo, proj-nosuch]\n---\n\n# Blocker never existed\n\nBody.\n");
  onStdin(`${NOTE}\n`);

  await close(["proj-behilo", "--done"], repo);

  const printed = logged.join("\n");
  expect(printed).toContain("its work is at rest");
  expect(printed).toContain("proj-vezipo  Came free");
  expect(printed).toContain("proj-fanovi  Last blocker closed");
  expect(printed).not.toContain("proj-hitowa");
  expect(printed).not.toContain("proj-dumoka");
  expect(errored).toContain(
    "card: proj-hitowa is blocked by proj-nosuch, which is in neither open/ nor closed/",
  );
});

test("--promoted names a dependent another open card still blocks, which is what it warns about", async () => {
  const { repo, deck } = await deckIn();
  await open(deck, "proj-behilo", CARD);
  await open(deck, "proj-dumoka", "---\nblocked-by: [proj-behilo, proj-lakito]\n---\n\n# Still shut\n\nBody.\n");
  await open(deck, "proj-lakito", "---\n---\n\n# The other blocker, still open\n\nBody.\n");
  onStdin("Went elsewhere; PROJ-42 is where the work will happen.\n");

  await close(["proj-behilo", "--promoted"], repo);

  const printed = logged.join("\n");
  expect(printed).toContain("about to look ready and are not");
  expect(printed).toContain("proj-dumoka  Still shut");
});

test("a close whose card was blocking nothing says so rather than printing nothing", async () => {
  const { repo, deck } = await deckIn();
  await open(deck, "proj-behilo", CARD);
  onStdin("The reason for it is gone, and nothing was waiting on it either.\n");

  await close(["proj-behilo", "--moot"], repo);

  expect(logged).toEqual(["closed proj-behilo", "nothing was waiting on it."]);
});

test("refuses without a flag, with two flags, and with the retired spellings", async () => {
  const { repo, deck } = await deckIn();
  const file = await open(deck, "proj-behilo", CARD);
  onStdin(`${NOTE}\n`);

  await expect(close(["proj-behilo"], repo)).rejects.toThrow(/how the card ended/);
  await expect(close(["proj-behilo", "--done", "--moot"], repo)).rejects.toThrow(/pass one of/);
  await expect(close(["proj-behilo", "--work-done"], repo)).rejects.toThrow(/no such option as `--work-done`/);
  await expect(close(["proj-behilo", "--work-not-done"], repo)).rejects.toThrow(/no such option as `--work-not-done`/);

  expect(await Bun.file(file).text()).toBe(CARD);
});

test("refuses an id that is nowhere, and one that has already closed", async () => {
  const { repo, deck } = await deckIn();
  await Bun.write(path.join(deck.closedDir, "proj-behilo.md"), CARD);
  onStdin(`${NOTE}\n`);

  await expect(close(["proj-nosuch", "--done"], repo)).rejects.toThrow(/no card proj-nosuch/);
  await expect(close(["proj-behilo", "--done"], repo)).rejects.toThrow(/already closed/);
  expect(await Bun.file(path.join(deck.closedDir, "proj-behilo.md")).text()).toBe(CARD);
});

test("refuses when there is no deck", async () => {
  const repo = await tempRepo();
  await expect(close(["proj-behilo", "--done"], repo)).rejects.toThrow(/no deck here/);
});
