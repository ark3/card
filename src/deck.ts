import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gitCommonDir } from "./git.ts";

export const CONFIG_NAME = "card-config.toml";
export const DEFAULT_DECK = "deck";

const PREFIX = /^[A-Za-z][A-Za-z0-9_-]*$/;
// Prefixes are letters, digits, `-` and `_`; syllables are letters. Anything
// else is not an id, and must never be joined onto the deck's path.
const ID = /^[A-Za-z0-9_-]+$/;

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
 * Where `close` stages a closed card before renaming it into place. Hidden and
 * not ending `.md`, so no listing of the deck shows a close still in flight.
 */
export function stagingName(id: string): string {
  return `.${id}.md.closing`;
}

/** The id a staged close is for, or null for any other name in `closed/`. */
export function stagedId(name: string): string | null {
  const match = /^\.(.+)\.md\.closing$/.exec(name);
  return match === null ? null : match[1];
}

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

  const parsed = Bun.TOML.parse(await config.text()) as {
    prefix?: unknown;
    deck?: unknown;
    public?: unknown;
  };
  if (typeof parsed.prefix !== "string" || parsed.prefix === "") {
    throw new Error(`${configPath} carries no prefix`);
  }
  // Refused at any value, rather than ignored, so the owner never believes the
  // flag still applies to a deck. No deck needs it: the one public deck there
  // was, agentpane's, is being emptied into that repository's issues.
  if (parsed.public !== undefined) {
    throw new Error(`${configPath} carries public, but the public flag is gone and nothing reads it; delete public from that file`);
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

/**
 * Creates the deck for `cwd` under `prefix` and returns it: the two
 * directories, `.ignore`, and the config, which is written last.
 */
export async function createDeck(cwd: string, prefix: string): Promise<Deck> {
  if (!PREFIX.test(prefix)) {
    throw new Error(`\`${prefix}\` is not a usable prefix: a letter, then letters, digits, - or _`);
  }

  const cardDir = await findCardDir(cwd);
  if (cardDir === null) {
    throw new Error("not in a git repository and CARD_ROOT is unset, so there is nowhere to put a deck");
  }

  const configPath = path.join(cardDir, CONFIG_NAME);
  if (await Bun.file(configPath).exists()) {
    throw new Error(`a deck is already configured by ${configPath}`);
  }

  const deckDir = path.join(cardDir, DEFAULT_DECK);
  await mkdir(path.join(deckDir, "open"), { recursive: true });
  await mkdir(path.join(deckDir, "closed"), { recursive: true });
  // Ripgrep and fd walk up to the repository's root `.gitignore`, which can
  // hide the whole deck. `.ignore` beats it in both, and git never reads it.
  await Bun.write(path.join(deckDir, ".ignore"), "!*\n");
  // Last, and exclusively: until this exists, there is no deck here.
  await writeFile(configPath, `prefix = "${prefix}"\ndeck = "${DEFAULT_DECK}"\n`, { flag: "wx" });

  return {
    cardDir,
    deckDir,
    openDir: path.join(deckDir, "open"),
    closedDir: path.join(deckDir, "closed"),
    prefix,
  };
}

/** Where the card with this id is, whichever directory it sits in. */
export async function locate(
  deck: Deck,
  id: string,
): Promise<{ path: string; closed: boolean } | null> {
  if (!ID.test(id)) throw new Error(`\`${id}\` is not a card id`);
  for (const closed of [false, true]) {
    const file = path.join(closed ? deck.closedDir : deck.openDir, `${id}.md`);
    if (await Bun.file(file).exists()) return { path: file, closed };
  }
  return null;
}
