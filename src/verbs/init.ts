import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_NAME, DEFAULT_DECK, findCardDir } from "../deck.ts";

const PREFIX = /^[A-Za-z][A-Za-z0-9_-]*$/;

export async function run(args: string[], cwd: string): Promise<void> {
  const prefix = args[0];
  if (prefix === undefined || args.length > 1) {
    throw new Error("usage: card init <prefix>");
  }
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

  console.log(`deck at ${deckDir}, prefix ${prefix}`);
}
