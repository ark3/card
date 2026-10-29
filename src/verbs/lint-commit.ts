import { requireDeck } from "../deck.ts";
import { citedIds } from "../id.ts";

export async function run(_args: string[], cwd: string): Promise<void> {
  const deck = await requireDeck(cwd);
  const cited = citedIds(await Bun.stdin.text(), deck.prefix);
  if (cited.length === 0) return;

  for (const id of cited) console.error(id);
  // Not a throw: `deck` prefixes a throw with `deck: `, and this output is a
  // plain list for a caller to read back.
  process.exit(1);
}
