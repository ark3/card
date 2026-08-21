import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Card } from "../cardfile.ts";
import { readCard } from "../cardfile.ts";
import { requireDeck } from "../deck.ts";

const USAGE = "usage: card list --ready [--label L]...";

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
  let ready = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--ready") {
      ready = true;
    } else if (arg === "--label") {
      const value = args[++i];
      if (value === undefined) throw new Error("--label wants a label");
      labels.push(value);
    } else {
      throw new Error(`\`${arg}\` is not a listing card understands\n${USAGE}`);
    }
  }
  // The rest of `list` is deferred, so no mode is an error rather than a
  // default: a default would quietly define what the other listings are.
  if (!ready) throw new Error(`--ready is the only listing there is\n${USAGE}`);

  const deck = await requireDeck(cwd);
  const openIds = await ids(deck.openDir);
  const open = new Set(openIds);
  const closed = new Set(await ids(deck.closedDir));

  const listed: { id: string; card: Card }[] = [];
  let blocked = 0;
  for (const id of openIds) {
    let card: Card;
    try {
      card = await readCard(path.join(deck.openDir, `${id}.md`));
    } catch (error) {
      // One bad file must not take down the listing, and passing over it in
      // silence is the failure the strict parser exists to prevent.
      console.error(`card: skipped ${message(error)}`);
      continue;
    }
    if (!labels.every((label) => card.labels.includes(label))) continue;

    const waiting = card.blockedBy.filter((blocker) => !closed.has(blocker));
    for (const blocker of waiting) {
      if (!open.has(blocker)) {
        console.error(`card: ${id} is blocked by ${blocker}, which is in neither open/ nor closed/`);
      }
    }
    if (waiting.length === 0) listed.push({ id, card });
    else blocked++;
  }

  if (listed.length > 0) {
    for (const { id, card } of listed) {
      const shown = card.labels.length > 0 ? `  [${card.labels.join(", ")}]` : "";
      console.log(`${id}  ${card.headline}${shown}`);
    }
    return;
  }

  // Which kind of empty: nothing open, and everything open blocked, are
  // different answers to the session that just asked.
  const scope = labels.length === 0 ? "open" : "matching open";
  if (blocked === 0) console.log(`nothing ready: no ${scope} cards`);
  else if (blocked === 1) console.log(`nothing ready: 1 ${scope} card is blocked`);
  else console.log(`nothing ready: ${blocked} ${scope} cards are blocked`);
}
