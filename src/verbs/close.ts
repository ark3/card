import { readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { readCard } from "../cardfile.ts";
import { requireDeck } from "../deck.ts";
import { locate } from "./show.ts";

const USAGE = "usage: card close <id> --work-done|--work-not-done, explanation on stdin";

export async function run(args: string[], cwd: string): Promise<void> {
  let workDone: boolean | undefined;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === "--work-done" || arg === "--work-not-done") {
      if (workDone !== undefined) throw new Error(`pass one of --work-done or --work-not-done\n${USAGE}`);
      workDone = arg === "--work-done";
    } else if (arg.startsWith("--")) {
      throw new Error(`no such option as \`${arg}\`\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  const id = positional[0];
  if (id === undefined || positional.length > 1) throw new Error(USAGE);
  if (workDone === undefined) {
    throw new Error(
      `whether the work got done is what says which cards to warn about\n${USAGE}`,
    );
  }

  const deck = await requireDeck(cwd);
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  if (found.closed) throw new Error(`${id} is already closed`);

  const explanation = (await Bun.stdin.text()).trim();
  if (explanation === "") {
    throw new Error(
      `${id} needs an explanation on stdin, written for the next authoring session sweeping closed cards for prior art`,
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
  if (workDone) return;

  const blocked: string[] = [];
  for (const entry of (await readdir(deck.openDir)).sort()) {
    if (!entry.endsWith(".md")) continue;
    const card = await readCard(path.join(deck.openDir, entry));
    if (card.blockedBy.includes(id)) blocked.push(`${entry.slice(0, -3)}  ${card.headline}`);
  }
  if (blocked.length === 0) return;

  console.log(`its work never happened, and these are about to look ready and are not:`);
  for (const line of blocked) console.log(`  ${line}`);
}
