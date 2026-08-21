import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { findCardDir, requireDeck, resolveDeck } from "../src/deck.ts";
import { git } from "../src/git.ts";
import { run as init } from "../src/verbs/init.ts";
import { clearCardRoot, removeTempDirs, tempDir, tempRepo } from "./helpers.ts";

beforeEach(clearCardRoot);
afterAll(removeTempDirs);

describe("with no deck", () => {
  test("a repository without a card directory has no deck", async () => {
    const repo = await tempRepo();
    expect(await resolveDeck(repo)).toBeNull();
    await expect(requireDeck(repo)).rejects.toThrow(/no deck here/);
  });

  test("a card directory without card-config.toml is not a deck", async () => {
    const repo = await tempRepo();
    mkdirSync(path.join(repo, ".git", "card", "deck", "open"), { recursive: true });
    expect(await resolveDeck(repo)).toBeNull();
  });

  test("outside a repository, with CARD_ROOT unset, there is nowhere for one", async () => {
    const loose = tempDir();
    expect(await findCardDir(loose)).toBeNull();
    expect(await resolveDeck(loose)).toBeNull();
  });
});

describe("resolution", () => {
  test("finds the deck from the repository root", async () => {
    const repo = await tempRepo();
    await init(["proj"], repo);

    const deck = await resolveDeck(repo);
    expect(deck?.prefix).toBe("proj");
    expect(deck?.cardDir).toBe(path.join(repo, ".git", "card"));
    expect(deck?.deckDir).toBe(path.join(repo, ".git", "card", "deck"));
    expect(deck?.openDir).toBe(path.join(repo, ".git", "card", "deck", "open"));
    expect(deck?.closedDir).toBe(path.join(repo, ".git", "card", "deck", "closed"));
  });

  test("finds it from a subdirectory", async () => {
    const repo = await tempRepo();
    await init(["proj"], repo);
    const nested = path.join(repo, "src", "deep");
    mkdirSync(nested, { recursive: true });

    const deck = await resolveDeck(nested);
    expect(deck?.prefix).toBe("proj");
    expect(deck?.deckDir).toBe(path.join(repo, ".git", "card", "deck"));
  });

  test("finds it from a worktree cut off the repository", async () => {
    const repo = await tempRepo();
    await init(["proj"], repo);
    const worktree = path.join(repo, ".worktrees", "agent");
    const cut = await git(["worktree", "add", "-q", "-b", "tmp", worktree], repo);
    expect(cut.ok).toBe(true);

    const deck = await resolveDeck(worktree);
    expect(deck?.prefix).toBe("proj");
    expect(deck?.deckDir).toBe(path.join(repo, ".git", "card", "deck"));
  });

  test("finds it from inside the deck itself", async () => {
    const repo = await tempRepo();
    await init(["proj"], repo);
    const inside = path.join(repo, ".git", "card", "deck", "open");

    expect((await resolveDeck(inside))?.prefix).toBe("proj");
  });

  test("CARD_ROOT wins outright over the repository's own deck", async () => {
    const repo = await tempRepo();
    await init(["proj"], repo);
    const elsewhere = tempDir();
    process.env.CARD_ROOT = elsewhere;
    await init(["other"], elsewhere);

    const deck = await resolveDeck(repo);
    expect(deck?.prefix).toBe("other");
    expect(deck?.deckDir).toBe(path.join(elsewhere, "deck"));
  });

  test("CARD_ROOT works outside any repository", async () => {
    const loose = tempDir();
    const root = tempDir();
    process.env.CARD_ROOT = root;
    await init(["loose"], root);

    expect((await resolveDeck(loose))?.prefix).toBe("loose");
  });
});

describe("the config", () => {
  test("redirects the deck relative to the card directory", async () => {
    const repo = await tempRepo();
    const cardDir = path.join(repo, ".git", "card");
    mkdirSync(cardDir, { recursive: true });
    await Bun.write(path.join(cardDir, "card-config.toml"), 'prefix = "OW"\ndeck = "../../docs/work"\n');

    const deck = await resolveDeck(repo);
    expect(deck?.prefix).toBe("OW");
    expect(deck?.deckDir).toBe(path.join(repo, "docs", "work"));
  });

  test("without a prefix is reported rather than guessed at", async () => {
    const repo = await tempRepo();
    const cardDir = path.join(repo, ".git", "card");
    mkdirSync(cardDir, { recursive: true });
    await Bun.write(path.join(cardDir, "card-config.toml"), 'deck = "deck"\n');

    await expect(resolveDeck(repo)).rejects.toThrow(/carries no prefix/);
  });
});
