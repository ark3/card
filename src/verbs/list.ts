import { requireDeck } from "../deck.ts";
import { type Listing, listCards } from "../operations.ts";

const USAGE = "usage: deck list [--open | --ready | --closed] [--label L]...";
const LISTINGS = ["--open", "--ready", "--closed"];

export async function run(args: string[], cwd: string): Promise<void> {
  const labels: string[] = [];
  let listing: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (LISTINGS.includes(arg)) {
      if (listing !== null && listing !== arg) {
        throw new Error(`${listing} and ${arg} are different listings; pick one\n${USAGE}`);
      }
      listing = arg;
    } else if (arg === "--label") {
      const value = args[++i];
      if (value === undefined) throw new Error("--label wants a label");
      labels.push(value);
    } else {
      throw new Error(`\`${arg}\` is not a listing deck understands\n${USAGE}`);
    }
  }
  const wantsClosed = listing === "--closed";
  const wantsReady = listing === "--ready";

  const deck = await requireDeck(cwd);
  const { listed, blocked, warnings } = await listCards(deck, (listing?.slice(2) ?? "open") as Listing, labels);
  // On stderr, since stdout is the listing and none of these is a card.
  for (const warning of warnings) console.error(`deck: ${warning}`);

  if (listed.length > 0) {
    for (const { id, card, waiting } of listed) {
      const shown = card.labels.length > 0 ? `  [${card.labels.join(", ")}]` : "";
      const stuck = waiting.length > 0 ? `  (blocked by ${waiting.join(", ")})` : "";
      // How a closed card ended, so the closed pile can be scanned by outcome
      // without opening a card. Cards closed before `close` recorded it have
      // nothing to show, and show nothing.
      const ended = wantsClosed && card.closed !== undefined ? `  (${card.closed})` : "";
      console.log(`${id}  ${card.headline}${shown}${ended}${stuck}`);
    }
    return;
  }

  const kind = wantsClosed ? "closed" : "open";
  const scope = labels.length === 0 ? kind : `matching ${kind}`;
  if (!wantsReady) {
    console.log(`no ${scope} cards`);
    return;
  }
  // Which kind of empty: nothing open, and everything open blocked, are
  // different answers to the session that just asked.
  if (blocked === 0) console.log(`nothing ready: no ${scope} cards`);
  else if (blocked === 1) console.log(`nothing ready: 1 ${scope} card is blocked`);
  else console.log(`nothing ready: ${blocked} ${scope} cards are blocked`);
}
