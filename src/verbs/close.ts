import type { Outcome } from "../cardfile.ts";
import { requireDeck } from "../deck.ts";
import { closeCard } from "../operations.ts";

const USAGE = "usage: deck close <id> --done|--promoted|--declined|--moot, close note on stdin";
const FLAGS = ["--done", "--promoted", "--declined", "--moot"];

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

  const explanation = (await Bun.stdin.text()).trim();
  if (explanation === "") {
    throw new Error(
      `${id} needs a close note on stdin, written for the next authoring session sweeping closed cards for prior art`,
    );
  }

  const { dependents, heldShut, warnings } = await closeCard(deck, id, outcome.slice(2) as Outcome, explanation);

  console.log(`closed ${id}`);
  for (const warning of warnings) console.error(`deck: ${warning}`);

  const named = (cards: typeof dependents) => cards.map((card) => `  ${card.id}  ${card.headline}`);
  // Silence here reads as the scan never having run, so an empty list says so
  // — and says which empty it is, since a dependent every one of whose other
  // blockers is still open would otherwise vanish behind "nothing was
  // waiting" and never reach the owner.
  if (dependents.length === 0) {
    if (heldShut.length === 0) {
      console.log(`nothing was waiting on it.`);
      return;
    }
    console.log(`nothing came free: other open blockers still hold shut everything waiting on it:`);
    for (const line of named(heldShut)) console.log(line);
    return;
  }

  console.log(
    workDone
      ? `its work is at rest, and these were waiting on it:`
      : `its work never happened, and these are about to look ready and are not:`,
  );
  for (const line of named(dependents)) console.log(line);
  // Only `--done` fills this list. Dropped here, a co-blocked dependent would
  // vanish behind the freed list exactly as it would behind "nothing was
  // waiting", so it prints too — under wording that keeps it off the freed
  // list, which is the readiness cue this verb must not overstate.
  if (heldShut.length > 0) {
    console.log(`other open blockers still hold shut the rest of what was waiting on it:`);
    for (const line of named(heldShut)) console.log(line);
  }
}
