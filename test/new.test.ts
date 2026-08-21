import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import path from "node:path";
import { type Deck, resolveDeck } from "../src/deck.ts";
import { run as init } from "../src/verbs/init.ts";
import { run as neu } from "../src/verbs/new.ts";
import { clearCardRoot, removeTempDirs, tempRepo } from "./helpers.ts";

const realStdin = Bun.stdin;
let logged: string[] = [];

beforeEach(() => {
  clearCardRoot();
  logged = [];
  spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    logged.push(parts.join(" "));
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

/** Every draw yields `proj-bababa`, which is what forces a collision. */
function alwaysDrawsBababa(): void {
  spyOn(Math, "random").mockReturnValue(0);
}

/** The first draw yields `proj-bababa`; every later one is a real draw. */
function firstDrawIsBababa(): void {
  const real = Math.random;
  let calls = 0;
  spyOn(Math, "random").mockImplementation(() => (calls++ < 6 ? 0 : real()));
}

test("writes the card and prints the id it drew", async () => {
  const { repo, deck } = await deckIn();
  onStdin("The grounding a cold reader needs.\n");

  await neu(["Do the thing", "--label", "PROJ-1", "--label", "work-laptop", "--blocked-by", "proj-behilo"], repo);

  const id = logged[0]!;
  expect(id).toMatch(/^proj-[a-z]{6}$/);
  expect(await Bun.file(path.join(deck.openDir, `${id}.md`)).text()).toBe(
    "---\nlabels: [PROJ-1, work-laptop]\nblocked-by: [proj-behilo]\n---\n\n" +
      "# Do the thing\n\nThe grounding a cold reader needs.\n",
  );
});

test("writes a card with no frontmatter when nothing was passed", async () => {
  const { repo, deck } = await deckIn();
  onStdin("Prose only.\n");

  await neu(["A bare card"], repo);

  expect(await Bun.file(path.join(deck.openDir, `${logged[0]}.md`)).text()).toBe(
    "# A bare card\n\nProse only.\n",
  );
});

test("a forced collision in open/ fails rather than overwriting", async () => {
  const { repo, deck } = await deckIn();
  const taken = path.join(deck.openDir, "proj-bababa.md");
  await Bun.write(taken, "# The card that was already there\n\nIts body.\n");
  alwaysDrawsBababa();
  onStdin("The body of the card that must not land.\n");

  await expect(neu(["Second session, same id"], repo)).rejects.toThrow(/every one was taken/);

  expect(await Bun.file(taken).text()).toBe("# The card that was already there\n\nIts body.\n");
});

test("a forced collision in closed/ fails rather than reusing the id", async () => {
  const { repo, deck } = await deckIn();
  const spent = path.join(deck.closedDir, "proj-bababa.md");
  await Bun.write(spent, "# A card that closed last week\n\nWhat it decided.\n");
  alwaysDrawsBababa();
  onStdin("The body of the card that must not land.\n");

  await expect(neu(["Drawing a spent id"], repo)).rejects.toThrow(/every one was taken/);

  expect(await Bun.file(spent).text()).toBe("# A card that closed last week\n\nWhat it decided.\n");
  expect(await Bun.file(path.join(deck.openDir, "proj-bababa.md")).exists()).toBe(false);
});

test("an id sitting in closed/ is redrawn past, not reused", async () => {
  const { repo, deck } = await deckIn();
  await Bun.write(path.join(deck.closedDir, "proj-bababa.md"), "# Spent\n\nGone.\n");
  firstDrawIsBababa();
  onStdin("A body.\n");

  await neu(["The next card"], repo);

  expect(logged[0]).not.toBe("proj-bababa");
  expect(await Bun.file(path.join(deck.closedDir, "proj-bababa.md")).text()).toBe("# Spent\n\nGone.\n");
  expect(await Bun.file(path.join(deck.openDir, `${logged[0]}.md`)).text()).toContain("# The next card");
});

test("refuses a body that is empty or only whitespace", async () => {
  const { repo, deck } = await deckIn();

  onStdin("");
  await expect(neu(["No body at all"], repo)).rejects.toThrow(/needs a body on stdin/);
  onStdin("   \n\n\t\n");
  await expect(neu(["No body at all"], repo)).rejects.toThrow(/needs a body on stdin/);

  expect(await Array.fromAsync(new Bun.Glob("*.md").scan(deck.openDir))).toEqual([]);
});

test("refuses without a headline, or with a second one", async () => {
  const { repo } = await deckIn();
  await expect(neu([], repo)).rejects.toThrow(/usage/);
  await expect(neu(["  "], repo)).rejects.toThrow(/needs a headline/);
  await expect(neu(["One", "Two"], repo)).rejects.toThrow(/usage/);
});

test("refuses a flag with no value, and a flag it does not know", async () => {
  const { repo } = await deckIn();
  await expect(neu(["A headline", "--label"], repo)).rejects.toThrow(/--label needs a value/);
  await expect(neu(["A headline", "--kind", "bug"], repo)).rejects.toThrow(/no such option as `--kind`/);
});

test("refuses when there is no deck", async () => {
  const repo = await tempRepo();
  await expect(neu(["A headline"], repo)).rejects.toThrow(/no deck here/);
});
