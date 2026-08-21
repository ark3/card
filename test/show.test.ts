import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import path from "node:path";
import { type Deck, resolveDeck } from "../src/deck.ts";
import { run as init } from "../src/verbs/init.ts";
import { run as show } from "../src/verbs/show.ts";
import { clearCardRoot, removeTempDirs, tempRepo } from "./helpers.ts";

const CARD = "---\nlabels: [PROJ-1]\n---\n\n# A card worth showing\n\nIts body.\n";

let logged: string[] = [];
let written: string[] = [];

beforeEach(() => {
  clearCardRoot();
  logged = [];
  written = [];
  spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    logged.push(parts.join(" "));
  });
  spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
});
afterEach(() => mock.restore());
afterAll(removeTempDirs);

async function deckIn(): Promise<{ repo: string; deck: Deck }> {
  const repo = await tempRepo();
  await init(["proj"], repo);
  logged = [];
  return { repo, deck: (await resolveDeck(repo))! };
}

test("prints an open card", async () => {
  const { repo, deck } = await deckIn();
  await Bun.write(path.join(deck.openDir, "proj-behilo.md"), CARD);

  await show(["proj-behilo"], repo);

  expect(written.join("")).toBe(CARD);
});

test("finds a card that has closed since it was cited", async () => {
  const { repo, deck } = await deckIn();
  await Bun.write(path.join(deck.closedDir, "proj-behilo.md"), CARD);

  await show(["proj-behilo"], repo);

  expect(written.join("")).toBe(CARD);
});

test("prints a hand-written card exactly as it was written", async () => {
  const { repo, deck } = await deckIn();
  const byHand = "---\nlabels: [a,b]\n---\n# Squeezed together\nProse.\n";
  await Bun.write(path.join(deck.openDir, "proj-behilo.md"), byHand);

  await show(["proj-behilo"], repo);

  expect(written.join("")).toBe(byHand);
});

test("--path prints the file's absolute path and nothing else", async () => {
  const { repo, deck } = await deckIn();
  const file = path.join(deck.closedDir, "proj-behilo.md");
  await Bun.write(file, CARD);

  await show(["proj-behilo", "--path"], repo);

  expect(logged).toEqual([file]);
  expect(path.isAbsolute(logged[0]!)).toBe(true);
  expect(written).toEqual([]);
});

test("an id in neither directory is an error naming the id", async () => {
  const { repo } = await deckIn();
  await expect(show(["proj-nosuch"], repo)).rejects.toThrow(/no card proj-nosuch/);
});

test("refuses anything that is not a bare id", async () => {
  const { repo, deck } = await deckIn();
  await Bun.write(path.join(deck.openDir, "proj-behilo.md"), CARD);

  await expect(show(["../open/proj-behilo"], repo)).rejects.toThrow(/is not a card id/);
  await expect(show(["proj-behilo.md"], repo)).rejects.toThrow(/is not a card id/);
});

test("refuses without an id, or with a second one", async () => {
  const { repo } = await deckIn();
  await expect(show([], repo)).rejects.toThrow(/usage/);
  await expect(show(["proj-behilo", "proj-vezipo"], repo)).rejects.toThrow(/usage/);
});

test("refuses when there is no deck", async () => {
  const repo = await tempRepo();
  await expect(show(["proj-behilo"], repo)).rejects.toThrow(/no deck here/);
});
