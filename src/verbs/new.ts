import path from "node:path";
import { createCard } from "../cardfile.ts";
import { requireDeck } from "../deck.ts";
import { drawId } from "../id.ts";

const USAGE = "usage: card new '<headline>' [--label L]... [--blocked-by <id>]..., body on stdin";
// Ninety ids per syllable cubed. Ten collisions in a row is not a deck that
// happens to be full; it is something wrong worth stopping on.
const DRAWS = 10;

export async function run(args: string[], cwd: string): Promise<void> {
  const labels: string[] = [];
  const blockedBy: string[] = [];
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--label" || arg === "--blocked-by") {
      const value = args[++i];
      if (value === undefined) throw new Error(`${arg} needs a value\n${USAGE}`);
      (arg === "--label" ? labels : blockedBy).push(value);
    } else if (arg.startsWith("--")) {
      throw new Error(`no such option as \`${arg}\`\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  const headline = positional[0]?.trim();
  if (headline === undefined || positional.length > 1) throw new Error(USAGE);
  if (headline === "") throw new Error("a card needs a headline");
  if (headline.includes("\n")) throw new Error("a headline is one line and never wraps");

  const deck = await requireDeck(cwd);

  // Validated before any id is drawn, so a refused filing leaves no file behind.
  for (const blocker of blockedBy) {
    if (await Bun.file(path.join(deck.openDir, `${blocker}.md`)).exists()) continue;
    if (await Bun.file(path.join(deck.closedDir, `${blocker}.md`)).exists()) {
      // Blocking new work on finished work means the card is born ready with a
      // dead blocked-by line — almost certainly a typo for a different id — so
      // refuse loudly rather than guess. Finished work worth referencing is
      // cited by id in the card body instead.
      throw new Error(`--blocked-by ${blocker}: that card is already closed; cite it in the body instead`);
    }
    throw new Error(`--blocked-by ${blocker}: no such card in the deck`);
  }

  const body = await Bun.stdin.text();
  if (body.trim() === "") {
    throw new Error("a card needs a body on stdin; a headline alone is the skeleton this verb replaces");
  }

  const card = { labels, blockedBy, headline, body };
  for (let draw = 0; draw < DRAWS; draw++) {
    const id = drawId(deck.prefix);
    // `closed/` has to be looked at; `open/` is checked by the exclusive
    // create itself, which is what makes drawing and writing one act.
    if (await Bun.file(path.join(deck.closedDir, `${id}.md`)).exists()) continue;
    try {
      await createCard(path.join(deck.openDir, `${id}.md`), card);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      continue;
    }
    console.log(id);
    return;
  }

  throw new Error(`drew ${DRAWS} ids and every one was taken; look at the deck at ${deck.deckDir}`);
}
