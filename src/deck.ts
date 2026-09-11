import path from "node:path";
import { gitCommonDir } from "./git.ts";

export const CONFIG_NAME = "card-config.toml";
export const DEFAULT_DECK = "deck";

/**
 * What `card run` needs and cannot derive: all of it per-clone, since the
 * launch command differs by machine, the models are the owner's cost choice
 * for this deck, and the commit template is legal only where citing an id is.
 */
export type RunConfig = {
  /** Argv that starts one headless session, before the verb's own flags. */
  launch: string[];
  /** Label to model, with the empty key as the deck's default. */
  models: Record<string, string>;
  /** Message for the commit that lands a close's own dirt, with `{id}` in it. */
  closeCommit?: string;
};

export type Deck = {
  /** Holds `card-config.toml`. `.git/card/` in an ordinary checkout. */
  cardDir: string;
  /** Holds `open/`, `closed/` and `.ignore`. */
  deckDir: string;
  openDir: string;
  closedDir: string;
  prefix: string;
  /** The deck is its repo's public tracker, so citing an id is no leak. */
  public: boolean;
  /** Absent where the clone has no `[run]` section, which `run` refuses on. */
  run?: RunConfig;
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
 * The `[run]` section, or undefined where there is none. Every malformed value
 * is reported rather than defaulted: a typo here routes to the wrong model or
 * commits nothing, and both are silent.
 */
function parseRun(configPath: string, raw: unknown, isPublic: boolean): RunConfig | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${configPath} carries a run that is not a table`);
  }
  const section = raw as { launch?: unknown; models?: unknown; close_commit?: unknown };

  const launch = section.launch;
  if (
    !Array.isArray(launch) ||
    launch.length === 0 ||
    launch.some((word) => typeof word !== "string" || word === "")
  ) {
    throw new Error(`${configPath} carries a run.launch that is not a non-empty list of words`);
  }

  const models: Record<string, string> = {};
  if (section.models !== undefined) {
    if (typeof section.models !== "object" || section.models === null || Array.isArray(section.models)) {
      throw new Error(`${configPath} carries a run.models that is not a table`);
    }
    for (const [label, model] of Object.entries(section.models)) {
      if (typeof model !== "string" || model === "") {
        throw new Error(`${configPath} carries a run.models entry for \`${label}\` that is not a model name`);
      }
      models[label] = model;
    }
  }

  if (section.close_commit !== undefined) {
    if (typeof section.close_commit !== "string" || section.close_commit === "") {
      throw new Error(`${configPath} carries a run.close_commit that is not a message`);
    }
    // The template's whole purpose is to cite an id in a commit message, which
    // is a leak anywhere the deck is not the repository's own public tracker.
    if (!isPublic) {
      throw new Error(`${configPath} carries a run.close_commit on a deck that is not public`);
    }
  }

  return {
    launch: launch as string[],
    models,
    ...(section.close_commit === undefined ? {} : { closeCommit: section.close_commit as string }),
  };
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
    run?: unknown;
  };
  if (typeof parsed.prefix !== "string" || parsed.prefix === "") {
    throw new Error(`${configPath} carries no prefix`);
  }
  if (parsed.public !== undefined && typeof parsed.public !== "boolean") {
    throw new Error(`${configPath} carries a non-boolean public`);
  }
  const isPublic = parsed.public === true;
  const run = parseRun(configPath, parsed.run, isPublic);
  const relative = typeof parsed.deck === "string" ? parsed.deck : DEFAULT_DECK;
  const deckDir = path.resolve(cardDir, relative);

  return {
    cardDir,
    deckDir,
    openDir: path.join(deckDir, "open"),
    closedDir: path.join(deckDir, "closed"),
    prefix: parsed.prefix,
    public: isPublic,
    ...(run === undefined ? {} : { run }),
  };
}

export async function requireDeck(cwd: string): Promise<Deck> {
  const deck = await resolveDeck(cwd);
  if (deck === null) throw new Error("no deck here");
  return deck;
}
