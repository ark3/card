import { locate, requireDeck } from "../deck.ts";

const USAGE = "usage: deck show <id> [--path]";

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
