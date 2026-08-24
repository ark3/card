import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Card } from "../cardfile.ts";
import { readCard } from "../cardfile.ts";
import { requireDeck } from "../deck.ts";

const USAGE = "usage: card list [--open | --ready | --closed] [--label L]...";
const LISTINGS = ["--open", "--ready", "--closed"];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The ids in a directory, from the `<id>.md` filenames, in sorted order. */
async function ids(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  return names
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
}

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
      throw new Error(`\`${arg}\` is not a listing card understands\n${USAGE}`);
    }
  }
  const wantsClosed = listing === "--closed";
  const wantsReady = listing === "--ready";

  const deck = await requireDeck(cwd);
  const dir = wantsClosed ? deck.closedDir : deck.openDir;
  const listedIds = await ids(dir);
  // A closed card's blockers are history, so only an open listing pays for the
  // other directory.
  const open = wantsClosed ? new Set<string>() : new Set(listedIds);
  const closed = wantsClosed ? new Set<string>() : new Set(await ids(deck.closedDir));

  const listed: { id: string; card: Card; waiting: string[] }[] = [];
  let blocked = 0;
  for (const id of listedIds) {
    let card: Card;
    try {
      card = await readCard(path.join(dir, `${id}.md`));
    } catch (error) {
      // One bad file must not take down the listing, and passing over it in
      // silence is the failure the strict parser exists to prevent.
      console.error(`card: skipped ${message(error)}`);
      continue;
    }
    if (!labels.every((label) => card.labels.includes(label))) continue;

    const waiting = wantsClosed ? [] : card.blockedBy.filter((blocker) => !closed.has(blocker));
    for (const blocker of waiting) {
      if (!open.has(blocker)) {
        console.error(`card: ${id} is blocked by ${blocker}, which is in neither open/ nor closed/`);
      }
    }
    if (waiting.length > 0) {
      blocked++;
      if (wantsReady) continue;
    }
    listed.push({ id, card, waiting });
  }

  if (listed.length > 0) {
    for (const { id, card, waiting } of listed) {
      const shown = card.labels.length > 0 ? `  [${card.labels.join(", ")}]` : "";
      const stuck = waiting.length > 0 ? `  (blocked by ${waiting.join(", ")})` : "";
      console.log(`${id}  ${card.headline}${shown}${stuck}`);
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
