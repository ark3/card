import path from "node:path";
import { gitCommonDir } from "./git.ts";

export const CONFIG_NAME = "card-config.toml";
export const DEFAULT_DECK = "deck";

export type Deck = {
  /** Holds `card-config.toml`. `.git/card/` in an ordinary checkout. */
  cardDir: string;
  /** Holds `open/`, `closed/` and `.ignore`. */
  deckDir: string;
  openDir: string;
  closedDir: string;
  prefix: string;
};

/**
 * Where a card directory would be, whether or not one is there. `CARD_ROOT`
 * wins outright; otherwise it is `<git-common-dir>/card`. Null outside a git
 * repository with `CARD_ROOT` unset, where there is nowhere for a deck to be.
 */
export async function findCardDir(cwd: string): Promise<string | null> {
  const root = process.env.CARD_ROOT;
  if (root !== undefined && root !== "") return path.resolve(cwd, root);
  const common = await gitCommonDir(cwd);
  return common === null ? null : path.join(common, "card");
}

/**
 * The deck for `cwd`, or null when there is none. Never creates anything: a
 * card directory without `card-config.toml` is not a deck.
 */
export async function resolveDeck(cwd: string): Promise<Deck | null> {
  const cardDir = await findCardDir(cwd);
  if (cardDir === null) return null;

  const configPath = path.join(cardDir, CONFIG_NAME);
  const config = Bun.file(configPath);
  if (!(await config.exists())) return null;

  const parsed = Bun.TOML.parse(await config.text()) as { prefix?: unknown; deck?: unknown };
  if (typeof parsed.prefix !== "string" || parsed.prefix === "") {
    throw new Error(`${configPath} carries no prefix`);
  }
  const relative = typeof parsed.deck === "string" ? parsed.deck : DEFAULT_DECK;
  const deckDir = path.resolve(cardDir, relative);

  return {
    cardDir,
    deckDir,
    openDir: path.join(deckDir, "open"),
    closedDir: path.join(deckDir, "closed"),
    prefix: parsed.prefix,
  };
}

export async function requireDeck(cwd: string): Promise<Deck> {
  const deck = await resolveDeck(cwd);
  if (deck === null) throw new Error("no deck here");
  return deck;
}
