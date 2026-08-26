import { readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Card } from "../cardfile.ts";
import { readCard } from "../cardfile.ts";
import { requireDeck, stagingName } from "../deck.ts";
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
  const staging = path.join(deck.closedDir, stagingName(id));
  await writeFile(staging, `${text.replace(/\n*$/, "\n")}\n${explanation}\n`);
  // The card arrives in `closed/` explanation and all, in one rename. Until
  // the unlink runs the open copy is still the card exactly as it was, so no
  // interruption leaves a closed card without its explanation or an
  // explanation on a card still open.
  await rename(staging, path.join(deck.closedDir, `${id}.md`));
  await unlink(found.path);

  console.log(`closed ${id}`);

  const blocked: string[] = [];
  const heldShut: string[] = [];
  const entries = (await readdir(deck.openDir)).sort();
  // The closing card's own file is gone by now, so it is not one of these.
  const stillOpen = new Set(
    entries.filter((entry) => entry.endsWith(".md")).map((entry) => entry.slice(0, -3)),
  );
  const closed = new Set(
    (await readdir(deck.closedDir))
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => entry.slice(0, -3)),
  );
  for (const entry of entries) {
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
    if (!card.blockedBy.includes(id)) continue;
    // `--done` says the work is at rest, which reads as a card having come
    // free, so a card another open blocker still holds shut stays off that
    // list. Only a blocker resolving to closed/ holds nothing shut: a blocker
    // in neither open/ nor closed/ means a typo in a hand-edit or a
    // hand-deleted file — something genuinely wrong a human should look at —
    // and wrongly withholding a card from the readiness cue costs less than
    // wrongly releasing one, which a session would pick up here and then
    // `list --ready` would refuse to show. `list` counts it as blocking too.
    // The other outcomes only warn that a card is about to look ready, which
    // is true of a co-blocked card too, so they name every dependent.
    if (workDone) {
      let held = false;
      for (const blocker of card.blockedBy) {
        if (blocker === id || closed.has(blocker)) continue;
        if (!stillOpen.has(blocker)) {
          console.error(
            `card: ${entry.slice(0, -3)} is blocked by ${blocker}, which is in neither open/ nor closed/`,
          );
        }
        held = true;
      }
      if (held) {
        heldShut.push(`${entry.slice(0, -3)}  ${card.headline}`);
        continue;
      }
    }
    blocked.push(`${entry.slice(0, -3)}  ${card.headline}`);
  }
  // Silence here reads as the scan never having run, so an empty list says so
  // — and says which empty it is, since a dependent every one of whose other
  // blockers is still open would otherwise vanish behind "nothing was
  // waiting" and never reach the owner.
  if (blocked.length === 0) {
    if (heldShut.length === 0) {
      console.log(`nothing was waiting on it.`);
      return;
    }
    console.log(`nothing came free: other open blockers still hold shut everything waiting on it:`);
    for (const line of heldShut) console.log(`  ${line}`);
    return;
  }

  console.log(
    workDone
      ? `its work is at rest, and these were waiting on it:`
      : `its work never happened, and these are about to look ready and are not:`,
  );
  for (const line of blocked) console.log(`  ${line}`);
  // Only `--done` fills this list. Dropped here, a co-blocked dependent would
  // vanish behind the freed list exactly as it would behind "nothing was
  // waiting", so it prints too — under wording that keeps it off the freed
  // list, which is the readiness cue this verb must not overstate.
  if (heldShut.length > 0) {
    console.log(`other open blockers still hold shut the rest of what was waiting on it:`);
    for (const line of heldShut) console.log(`  ${line}`);
  }
}
