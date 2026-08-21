import path from "node:path";
import { type Deck, requireDeck } from "../deck.ts";

const USAGE = "usage: card show <id> [--path]";
// Prefixes are letters, digits, `-` and `_`; syllables are letters. Anything
// else is not an id, and must never be joined onto the deck's path.
const ID = /^[A-Za-z0-9_-]+$/;

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

export async function run(args: string[], cwd: string): Promise<void> {
  const wantsPath = args.includes("--path");
  const positional = args.filter((arg) => arg !== "--path");
  const id = positional[0];
  if (id === undefined || positional.length > 1) throw new Error(USAGE);

  const deck = await requireDeck(cwd);
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);

  if (wantsPath) console.log(found.path);
  // Verbatim: a card the owner hand-wrote prints as he wrote it.
  else process.stdout.write(await Bun.file(found.path).text());
}
