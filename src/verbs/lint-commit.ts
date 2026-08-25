import { requireDeck } from "../deck.ts";
import { idPattern } from "../id.ts";

export async function run(_args: string[], cwd: string): Promise<void> {
  const deck = await requireDeck(cwd);
  const message = await Bun.stdin.text();

  // A public deck is its repo's public tracker, and its convention cites ids
  // in commit messages; there is no boundary here for the gate to hold.
  if (deck.public) return;

  // The pattern alone, with no check that the id names a card in `open/` or
  // `closed/`: what the rule forbids is a public citation of a card id, and a
  // string shaped like one cites a card whether or not this deck still holds
  // it. Cross-checking would also go quiet exactly where the deck has moved on
  // — an id closed and archived elsewhere, or drawn in another checkout — and a
  // check that passes because the card is gone is worse than none.
  const cited = [...new Set(message.match(idPattern(deck.prefix)) ?? [])];
  if (cited.length === 0) return;

  for (const id of cited) console.error(id);
  // Not a throw: `card` prefixes a throw with `card: `, and this output is a
  // plain list for a caller to read back.
  process.exit(1);
}
