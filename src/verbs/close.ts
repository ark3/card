import { readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Card } from "../cardfile.ts";
import { readCard } from "../cardfile.ts";
import { requireDeck } from "../deck.ts";
import { locate } from "./show.ts";

const USAGE = "usage: card close <id> --done|--promoted|--declined|--moot, close note on stdin";
const FLAGS = ["--done", "--promoted", "--declined", "--moot"];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function run(args: string[], cwd: string): Promise<void> {
  let outcome: string | undefined;
  const positional: string[] = [];

  for (const arg of args) {
    if (FLAGS.includes(arg)) {
      if (outcome !== undefined) throw new Error(`pass one of ${FLAGS.join(", ")}\n${USAGE}`);
      outcome = arg;
    } else if (arg.startsWith("--")) {
      throw new Error(`no such option as \`${arg}\`\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  const id = positional[0];
  if (id === undefined || positional.length > 1) throw new Error(USAGE);
  if (outcome === undefined) {
    throw new Error(
      `how the card ended is what says which cards to warn about\n${USAGE}`,
    );
  }
  const workDone = outcome === "--done";

  const deck = await requireDeck(cwd);
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  if (found.closed) throw new Error(`${id} is already closed`);

  const explanation = (await Bun.stdin.text()).trim();
  if (explanation === "") {
    throw new Error(
      `${id} needs a close note on stdin, written for the next authoring session sweeping closed cards for prior art`,
    );
  }

  // Appended to the card's own text rather than reformatted through
  // `formatCard`, which would rewrite frontmatter the owner hand-wrote.
  const text = await Bun.file(found.path).text();
  const staging = path.join(deck.closedDir, `.${id}.md.closing`);
  await writeFile(staging, `${text.replace(/\n*$/, "\n")}\n${explanation}\n`);
  // The card arrives in `closed/` explanation and all, in one rename. Until
  // the unlink runs the open copy is still the card exactly as it was, so no
  // interruption leaves a closed card without its explanation or an
  // explanation on a card still open.
  await rename(staging, path.join(deck.closedDir, `${id}.md`));
  await unlink(found.path);

  console.log(`closed ${id}`);

  const blocked: string[] = [];
  for (const entry of (await readdir(deck.openDir)).sort()) {
    if (!entry.endsWith(".md")) continue;
    let card: Card;
    try {
      card = await readCard(path.join(deck.openDir, entry));
    } catch (error) {
      // The close has already happened, so one bad file leaves the scan
      // incomplete rather than failing the command; this line is what says so.
      console.error(`card: skipped ${message(error)}`);
      continue;
    }
    if (card.blockedBy.includes(id)) blocked.push(`${entry.slice(0, -3)}  ${card.headline}`);
  }
  // Silence here reads as the scan never having run, so an empty list says so.
  if (blocked.length === 0) {
    console.log(`nothing was waiting on it.`);
    return;
  }

  console.log(
    workDone
      ? `its work is at rest, and these were waiting on it:`
      : `its work never happened, and these are about to look ready and are not:`,
  );
  for (const line of blocked) console.log(`  ${line}`);
}
