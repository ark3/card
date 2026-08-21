import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveDeck } from "../src/deck.ts";
import { run as init } from "../src/verbs/init.ts";
import { clearCardRoot, removeTempDirs, tempDir, tempRepo } from "./helpers.ts";

beforeEach(clearCardRoot);
afterAll(removeTempDirs);

test("creates the config, the two directories and .ignore", async () => {
  const repo = await tempRepo();
  await init(["proj"], repo);

  const cardDir = path.join(repo, ".git", "card");
  expect(await Bun.file(path.join(cardDir, "card-config.toml")).text()).toBe(
    'prefix = "proj"\ndeck = "deck"\n',
  );
  expect(await Bun.file(path.join(cardDir, "deck", ".ignore")).text()).toBe("!*\n");

  const deck = await resolveDeck(repo);
  expect(existsSync(deck!.openDir)).toBe(true);
  expect(existsSync(deck!.closedDir)).toBe(true);
});

test("a second init refuses rather than clobbering", async () => {
  const repo = await tempRepo();
  await init(["proj"], repo);
  const configPath = path.join(repo, ".git", "card", "card-config.toml");
  await Bun.write(path.join(repo, ".git", "card", "deck", "open", "proj-behilo.md"), "# a card\n");

  await expect(init(["other"], repo)).rejects.toThrow(/already configured/);

  expect(await Bun.file(configPath).text()).toBe('prefix = "proj"\ndeck = "deck"\n');
  expect((await resolveDeck(repo))?.prefix).toBe("proj");
  expect(await Bun.file(path.join(repo, ".git", "card", "deck", "open", "proj-behilo.md")).exists()).toBe(true);
});

test("creates the deck under CARD_ROOT when one is set", async () => {
  const repo = await tempRepo();
  const elsewhere = tempDir();
  process.env.CARD_ROOT = elsewhere;

  await init(["other"], repo);

  expect(await Bun.file(path.join(elsewhere, "card-config.toml")).exists()).toBe(true);
  expect(await Bun.file(path.join(repo, ".git", "card", "card-config.toml")).exists()).toBe(false);
});

test("refuses outside a repository with CARD_ROOT unset", async () => {
  const loose = tempDir();
  await expect(init(["proj"], loose)).rejects.toThrow(/nowhere to put a deck/);
});

test("refuses without a prefix, since a prefix is never inferred", async () => {
  const repo = await tempRepo();
  await expect(init([], repo)).rejects.toThrow(/usage/);
  expect(await resolveDeck(repo)).toBeNull();
});

test("refuses a prefix that would not make a filename", async () => {
  const repo = await tempRepo();
  await expect(init(["../oops"], repo)).rejects.toThrow(/not a usable prefix/);
  await expect(init(["--prefix"], repo)).rejects.toThrow(/not a usable prefix/);
  expect(await resolveDeck(repo)).toBeNull();
});
