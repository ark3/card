import { readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Card, Outcome } from "./cardfile.ts";
import { createCard, readCard, refuseHeadlines } from "./cardfile.ts";
import { type Deck, locate, stagedId, stagingName } from "./deck.ts";
import { citedIds, drawId } from "./id.ts";

// Ninety ids per syllable cubed. Ten collisions in a row is not a deck that
// happens to be full; it is something wrong worth stopping on.
const DRAWS = 10;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Draws an id and files `card` in `open/` under it as one act, and returns the id. */
export async function fileCard(deck: Deck, card: Omit<Card, "closed">): Promise<string> {
  // Validated before any id is drawn, so a refused filing leaves no file behind.
  for (const blocker of card.blockedBy) {
    if (await Bun.file(path.join(deck.openDir, `${blocker}.md`)).exists()) continue;
    if (await Bun.file(path.join(deck.closedDir, `${blocker}.md`)).exists()) {
      // Blocking new work on finished work means the card is born ready with a
      // dead blocked-by line — almost certainly a typo for a different id — so
      // refuse loudly rather than guess. Finished work worth referencing is
      // cited by id in the card body instead.
      throw new Error(`blocked-by ${blocker}: that card is already closed; cite it in the body instead`);
    }
    throw new Error(`blocked-by ${blocker}: no such card in the deck`);
  }

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
    return id;
  }

  throw new Error(`drew ${DRAWS} ids and every one was taken; look at the deck at ${deck.deckDir}`);
}

export type Listing = "open" | "ready" | "closed";

export type Listed = {
  id: string;
  card: Card;
  /** The blockers this card still waits on; always empty in a closed listing. */
  waiting: string[];
};

/**
 * The ids in a directory, from the `<id>.md` filenames, most recently updated
 * first, with the id breaking a tie so a listing is deterministic.
 */
async function ids(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".md"));
  const entries = await Promise.all(
    names.map(async (name) => ({
      id: name.slice(0, -3),
      mtime: (await stat(path.join(dir, name))).mtimeMs,
    })),
  );
  return entries.sort((a, b) => b.mtime - a.mtime || a.id.localeCompare(b.id)).map((entry) => entry.id);
}

/**
 * The cards of one listing that carry every label in `labels`. `blocked`
 * counts the matching cards still waiting on a blocker, which a ready listing
 * leaves out; `warnings` are the deck's disrepair, one line each.
 */
export async function listCards(
  deck: Deck,
  listing: Listing,
  labels: string[],
): Promise<{ listed: Listed[]; blocked: number; warnings: string[] }> {
  const wantsClosed = listing === "closed";
  const warnings: string[] = [];
  // `close` stages under a name no listing shows, so a close that died between
  // its write and its rename leaves a file that is otherwise invisible to every
  // verb, for good. This is where a deck says it happened, beside the other
  // reports of a deck in disrepair, since a leftover is not a card. Named,
  // never removed: the file is the only copy of a close note somebody typed,
  // and unlinking one under a close still in flight would take out the rename
  // that makes a close atomic.
  for (const name of (await readdir(deck.closedDir)).sort()) {
    const id = stagedId(name);
    if (id === null) continue;
    warnings.push(
      `${path.join(deck.closedDir, name)} is a close that stopped before its rename, so ${id} is still open and its close note is in that file alone; close ${id} again to replace it, or delete it`,
    );
  }
  const dir = wantsClosed ? deck.closedDir : deck.openDir;
  const listedIds = await ids(dir);
  // A closed card's blockers are history, so only an open listing pays for the
  // other directory.
  const open = wantsClosed ? new Set<string>() : new Set(listedIds);
  const closed = wantsClosed ? new Set<string>() : new Set(await ids(deck.closedDir));

  const listed: Listed[] = [];
  let blocked = 0;
  for (const id of listedIds) {
    let card: Card;
    try {
      card = await readCard(path.join(dir, `${id}.md`));
    } catch (error) {
      // One bad file must not take down the listing, and passing over it in
      // silence is the failure the strict parser exists to prevent.
      warnings.push(`skipped ${message(error)}`);
      continue;
    }
    if (!labels.every((label) => card.labels.includes(label))) continue;

    // An open card whose frontmatter says closed is as wrong as a dangling
    // blocker, and passing over it in silence is the same failure.
    if (!wantsClosed && card.closed !== undefined) {
      warnings.push(`${id} is in open/ but its frontmatter says closed: ${card.closed}`);
    }

    const waiting = wantsClosed ? [] : card.blockedBy.filter((blocker) => !closed.has(blocker));
    for (const blocker of waiting) {
      if (!open.has(blocker)) {
        warnings.push(`${id} is blocked by ${blocker}, which is in neither open/ nor closed/`);
      }
    }
    if (waiting.length > 0) {
      blocked++;
      if (listing === "ready") continue;
    }
    listed.push({ id, card, waiting });
  }

  return { listed, blocked, warnings };
}

/**
 * The card's own text with `closed: <outcome>` inserted into its frontmatter,
 * opening a frontmatter block if the card has none. Textual rather than
 * `formatCard`, for the reason the write in `closeCard` gives, and it refuses
 * a card whose frontmatter already says closed: the directory says open, and
 * the two must never disagree.
 */
function recordOutcome(id: string, text: string, outcome: string): string {
  if (!text.startsWith("---\n")) return `---\nclosed: ${outcome}\n---\n\n${text}`;
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) throw new Error(`${id}: frontmatter is never closed`);
  const head = text.slice(0, end + 1);
  for (const line of head.slice(4).split("\n")) {
    const colon = line.indexOf(":");
    if (colon !== -1 && line.slice(0, colon).trim() === "closed") {
      throw new Error(
        `${id} is in open/ but its frontmatter already says closed; fix the card by hand before closing it`,
      );
    }
  }
  return `${head}closed: ${outcome}\n${text.slice(end + 1)}`;
}

/** The headings a record section can carry, all of them written by the tool. */
const RECORD_HEADINGS = ["Account", "Review feedback", "Gap", "Close note", "Promotion"] as const;
export type RecordHeading = (typeof RECORD_HEADINGS)[number];
const RECORD_SECTION = new RegExp(`^## (${RECORD_HEADINGS.join("|")})$`, "gm");

/** The card text's frontmatter block, empty where it has none, and its record sections in order, each from its heading. */
function toolWritten(text: string): { frontmatter: string; record: string[] } {
  const end = text.startsWith("---\n") ? text.indexOf("\n---\n", 3) + 5 : 0;
  const sections = [...text.matchAll(RECORD_SECTION)];
  return {
    frontmatter: text.slice(0, end),
    record: sections.map((section, index) => text.slice(section.index, sections[index + 1]?.index ?? text.length)),
  };
}

/**
 * The parts of a card the tool alone writes, its frontmatter and its record
 * sections, that differ byte for byte between its text `before` and `after`,
 * each record section named by its place and its heading.
 */
export function toolWrittenChanges(before: string, after: string): string[] {
  const was = toolWritten(before);
  const is = toolWritten(after);
  const changes = was.frontmatter === is.frontmatter ? [] : ["frontmatter"];
  for (let index = 0; index < Math.max(was.record.length, is.record.length); index++) {
    const section = is.record[index] ?? was.record[index]!;
    if (was.record[index] !== is.record[index]) changes.push(`record section ${index + 1} (${section.split("\n", 1)[0]})`);
  }
  return changes;
}

/**
 * `text` with a record section appended: `heading`, then `body`. The heading
 * is what says where the card's contract ends and the record begins; nothing
 * else marks the seam.
 */
function withRecord(text: string, heading: RecordHeading, body: string): string {
  refuseHeadlines(`the ${heading} section`, body);
  return `${text.replace(/\n*$/, "\n")}\n## ${heading}\n\n${body.replace(/\n*$/, "\n")}`;
}

/**
 * Appends a record section to the card `id`, open or closed, below its
 * contract and any record already there.
 */
export async function appendRecord(deck: Deck, id: string, heading: RecordHeading, text: string): Promise<void> {
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  const appended = withRecord(await Bun.file(found.path).text(), heading, text);
  // Staged and renamed over the card, so no interruption leaves it with half a
  // section. The staged name is hidden and does not end `.md`, so no listing
  // shows one left behind, and the card it was for is still whole.
  const staging = path.join(path.dirname(found.path), `.${id}.md.appending`);
  await writeFile(staging, appended);
  await rename(staging, found.path);
}

/**
 * Removes from the open card `id` the `## Account` and `## Review feedback`
 * sections of every cycle of it that did not land, keeping the rest of its
 * text as it was. A cycle that lands closes the card under `## Close note`,
 * so those are the sections below its last close note, or every one where it
 * has none. A `## Gap` among them is kept, since a gap stop appends it for the
 * roles that run the card again to read.
 */
export async function dropUnlanded(deck: Deck, id: string): Promise<void> {
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  const text = await Bun.file(found.path).text();
  const sections = [...text.matchAll(RECORD_SECTION)];
  const landed = sections.findLastIndex(([, heading]) => heading === "Close note");
  let dropped = text;
  // From the end, so the offsets of the sections still to look at hold.
  for (let index = sections.length - 1; index > landed; index--) {
    const [, heading] = sections[index]!;
    if (heading !== "Account" && heading !== "Review feedback") continue;
    dropped = dropped.slice(0, sections[index]!.index) + dropped.slice(sections[index + 1]?.index ?? text.length);
  }
  if (dropped === text) return;
  // Staged and renamed over the card, as `appendRecord` writes it.
  const staging = path.join(path.dirname(found.path), `.${id}.md.dropping`);
  await writeFile(staging, dropped.replace(/\n*$/, "\n"));
  await rename(staging, found.path);
}

/**
 * The card's own text with its `closed:` line removed, and with it the
 * frontmatter block when that was its last field, since a card with no fields
 * has no frontmatter. Everything below the frontmatter is kept as it was.
 */
function removeOutcome(id: string, text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) throw new Error(`${id}: frontmatter is never closed`);
  const fields = text.slice(4, end + 1).replace(/^closed:.*\n/gm, "");
  const below = text.slice(end + 5);
  // The blank line that set the block off goes with it, as `close` added it.
  if (fields.trim() === "") return below.replace(/^\n+/, "");
  return `---\n${fields}---\n${below}`;
}

/**
 * Moves the closed card `id` back to `open/` and removes its `closed:` line,
 * keeping its close notes and everything else below its frontmatter.
 */
export async function reopenCard(deck: Deck, id: string): Promise<void> {
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  if (!found.closed) throw new Error(`${id} is already open`);

  const staging = path.join(deck.openDir, `.${id}.md.reopening`);
  await writeFile(staging, removeOutcome(id, await Bun.file(found.path).text()));
  // Into `open/` in one rename, and only then out of `closed/`, so no
  // interruption loses the card or leaves it half-written. One between the
  // two leaves it whole in both, where `locate` finds it open, and its next
  // close renames over the copy left in `closed/`. A staged copy left behind
  // is invisible to every listing and holds nothing the closed card lacks.
  await rename(staging, path.join(deck.openDir, `${id}.md`));
  await unlink(found.path);
}

export type Dependent = { id: string; headline: string };

export type CloseReport = {
  /**
   * The open cards the closed card was blocking. On `done`, less those another
   * open blocker still holds shut, which are in `heldShut`, so this is what
   * came free; on any other outcome, every one of them.
   */
  dependents: Dependent[];
  /** Filled on `done` alone. */
  heldShut: Dependent[];
  /** What the scan of `open/` could not settle, one line each. */
  warnings: string[];
};

/**
 * Moves the open card `id` to `closed/`, writes `outcome` as `closed:` and
 * appends `note` under `## Close note`, as one act, and reports the cards it
 * was blocking.
 */
export async function closeCard(deck: Deck, id: string, outcome: Outcome, note: string): Promise<CloseReport> {
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  if (found.closed) throw new Error(`${id} is already closed`);
  // On every deck: a close note travels into the card's commit, and nothing
  // public ever cites a card id.
  const cited = citedIds(note, deck.prefix);
  if (cited.length > 0) {
    throw new Error(`${id}'s close note must cite no card id, and it cites ${cited.join(", ")}`);
  }

  // Appended to the card's own text rather than reformatted through
  // `formatCard`, which would rewrite frontmatter the owner hand-wrote.
  const text = await Bun.file(found.path).text();
  const recorded = withRecord(recordOutcome(id, text, outcome), "Close note", note);
  const staging = path.join(deck.closedDir, stagingName(id));
  await writeFile(staging, recorded);
  // The card arrives in `closed/` explanation and all, in one rename. Until
  // the unlink runs the open copy is still the card exactly as it was, so no
  // interruption leaves a closed card without its explanation or an
  // explanation on a card still open.
  await rename(staging, path.join(deck.closedDir, `${id}.md`));
  await unlink(found.path);

  const report: CloseReport = { dependents: [], heldShut: [], warnings: [] };
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
      // incomplete rather than failing the close; this line is what says so.
      report.warnings.push(`skipped ${message(error)}`);
      continue;
    }
    if (!card.blockedBy.includes(id)) continue;
    const dependent = { id: entry.slice(0, -3), headline: card.headline };
    // `done` says the work is at rest, which reads as a card having come
    // free, so a card another open blocker still holds shut stays off that
    // list. Only a blocker resolving to closed/ holds nothing shut: a blocker
    // in neither open/ nor closed/ means a typo in a hand-edit or a
    // hand-deleted file — something genuinely wrong a human should look at —
    // and wrongly withholding a card from the readiness cue costs less than
    // wrongly releasing one, which a session would pick up here and then
    // `list --ready` would refuse to show. `list` counts it as blocking too.
    // The other outcomes only warn that a card is about to look ready, which
    // is true of a co-blocked card too, so they name every dependent.
    if (outcome === "done") {
      let held = false;
      for (const blocker of card.blockedBy) {
        if (blocker === id || closed.has(blocker)) continue;
        if (!stillOpen.has(blocker)) {
          report.warnings.push(`${dependent.id} is blocked by ${blocker}, which is in neither open/ nor closed/`);
        }
        held = true;
      }
      if (held) {
        report.heldShut.push(dependent);
        continue;
      }
    }
    report.dependents.push(dependent);
  }
  return report;
}
