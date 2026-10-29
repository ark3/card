import { createDeck } from "../deck.ts";

export async function run(args: string[], cwd: string): Promise<void> {
  const prefix = args[0];
  if (prefix === undefined || args.length > 1) {
    throw new Error("usage: deck init <prefix>");
  }

  const deck = await createDeck(cwd, prefix);
  console.log(`deck at ${deck.deckDir}, prefix ${prefix}`);
}
