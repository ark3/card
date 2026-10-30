import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import prompt from "../payload/cards.md" with { type: "text" };
import { type Card, demoteHeadlines, formatCard, readCard } from "./cardfile.ts";
import { type Deck, locate } from "./deck.ts";
import { wrote } from "./dying.ts";
import { citedIds } from "./id.ts";
import { appendRecord, closeCard, drawIds, fileCardAs } from "./operations.ts";
import { forOwner } from "./owner.ts";
import { fill, wrapPayload } from "./payload.ts";
import { awaitingKey, type Context, listPlans, listWaiting, type Pending, type Plan, waitingCards, writeRecord } from "./plan.ts";

type Member = { id: string; path: string; landed: boolean; card: Card };

/**
 * The plan's cards in its order, less every card closed other than done,
 * which leaves the order. `landed` is a card closed done.
 */
export async function members(deck: Deck, plan: Plan): Promise<Member[]> {
  const kept: Member[] = [];
  for (const id of plan.cards) {
    const found = await locate(deck, id);
    if (found === null) throw new Error(`the plan's card ${id} is in neither open/ nor closed/ of ${deck.deckDir}`);
    const card = await readCard(found.path);
    if (found.closed && card.closed !== "done") continue;
    kept.push({ id, path: found.path, landed: found.closed, card });
  }
  return kept;
}

/** The plan's cards in its order, each its id, headline and marks, and its path on the next line. */
export async function planCards(deck: Deck, plan: Plan): Promise<string[]> {
  return (await members(deck, plan)).map(({ id, path: file, landed, card }) => {
    const marks = [landed ? "landed" : null, id === plan.final ? "final card" : null].filter((mark) => mark !== null);
    return `${id}  ${card.headline}${marks.length > 0 ? `  (${marks.join(", ")})` : ""}\n  ${file}\n`;
  });
}

/** The Cards stage's prompt, which bare `card` prints for as long as the stage lasts. */
export async function printPrompt({ deck, plan, command }: Context): Promise<void> {
  // A card the owner put off for later is still waiting, for every other
  // plan, but this plan's sessions have the owner's answer already. One the
  // owner drafted for promotion is settled too, and lists only the command
  // that records its key, even if this plan left it for later first.
  const waiting = await waitingCards(deck, plan);
  const joined = await Promise.all(
    plan.joins.map(async (id) => {
      const file = path.join(deck.openDir, `${id}.md`);
      return `${id}  ${(await readCard(file)).headline}\n  ${file}\n`;
    }),
  );
  const cards = await planCards(deck, plan);

  const values = {
    CARD: command,
    PLAN_DOCUMENT: plan.document,
    DRAFTING_DIR: plan.cardsDir,
    DECK: deck.deckDir,
    WAITING_CARDS: forOwner(
      waiting.length > 0
        ? listWaiting(waiting, command)
        : "No waiting card is left for this plan to settle.\n",
    ).trimEnd(),
    JOINED_FINDINGS: joined.length > 0 ? joined.join("").trimEnd() : "No finding has joined this plan.",
    PLAN_CARDS: cards.length > 0 ? cards.join("").trimEnd() : "The plan holds no cards yet: this is its first pass through this stage.",
  };
  process.stdout.write(wrapPayload(command, fill(prompt, values)));
}

/**
 * `card done` in the Cards stage: the owner has agreed the cards, so the
 * drafted files are filed, the order recorded, and the plan moves to Check.
 * Everything that can refuse is checked before anything is written, and the
 * ids are drawn and recorded with the order before the first card is filed,
 * so `finishDone` can finish a `card done` that died partway.
 */
export async function done({ deck, plan, command, args }: Context): Promise<void> {
  if (args.length > 0) throw new Error(`usage: ${command} done`);

  const names = (await readdir(plan.cardsDir)).filter((name) => name.endsWith(".md") && !name.startsWith(".")).sort();
  const drafted: { file: string; card: Card }[] = [];
  for (const name of names) {
    const file = path.join(plan.cardsDir, name);
    const card = await readCard(file);
    // Nothing reads `blocked-by` after take-in, so on a drafted card it would
    // be a promise the run never keeps.
    if (card.blockedBy.length > 0) {
      throw new Error(`${file}: a drafted card carries no blocked-by, since the run takes the plan's cards in the order this stage sets`);
    }
    if (card.closed !== undefined) throw new Error(`${file}: a drafted card carries no closed:, which only \`deck close\` writes`);
    // Filed from the record once it is written, so a card the filing would
    // refuse is refused here, while the draft can still be fixed.
    try {
      formatCard(card);
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`);
    }
    drafted.push({ file, card });
  }

  // The order, with a drafted file standing as its index until it has an id.
  const kept = await members(deck, plan);
  const keepsFinal = plan.final !== null && kept.some(({ id }) => id === plan.final);
  if (!keepsFinal && drafted.length === 0) {
    throw new Error(`the plan has no final card yet, and the last file drafted in ${plan.cardsDir} becomes it; there is none`);
  }
  const indices = drafted.map((_, index) => index);
  // Without a final card, the last drafted file is it, and it stands after
  // everything else, so the files ahead of it and the joins go ahead of it.
  const ahead = keepsFinal ? indices : indices.slice(0, -1);
  const rest: (string | number)[] = [...kept.map(({ id }) => id), ...(keepsFinal ? [] : [indices.at(-1)!])];
  const landed = new Set(kept.filter((member) => member.landed).map(({ id }) => id));
  const first = rest.findIndex((slot) => typeof slot === "number" || !landed.has(slot));
  const at = first === -1 ? rest.length : first;
  const order = [...rest.slice(0, at), ...ahead, ...plan.joins, ...rest.slice(at)];

  for (const id of plan.joins) {
    const found = await locate(deck, id);
    if (found === null || found.closed) throw new Error(`${id} joined the plan but is no longer in ${deck.openDir}`);
    const position = order.indexOf(id);
    for (const blocker of (await readCard(found.path)).blockedBy) {
      const place = order.indexOf(blocker);
      if (place !== -1) {
        if (place >= position) throw new Error(`${id} is blocked by ${blocker}, and would run ahead of it in the plan's order`);
        continue;
      }
      const where = await locate(deck, blocker);
      if (where === null) throw new Error(`${id} is blocked by ${blocker}, which is in neither open/ nor closed/`);
      const outcome = where.closed ? (await readCard(where.path)).closed : undefined;
      if (outcome !== "done") {
        throw new Error(
          `${id} is blocked by ${blocker}, a card outside the plan that ${outcome === undefined ? "is still open" : `closed ${outcome}`}; a joined card waits only on cards ahead of it in the plan or closed done`,
        );
      }
    }
  }

  const ids = await drawIds(deck, drafted.length);
  const cards = order.map((slot) => (typeof slot === "number" ? ids[slot]! : slot));
  const final = keepsFinal ? plan.final! : ids.at(-1)!;
  const drafts = drafted.map(({ file, card }, index) => ({ name: path.basename(file), id: ids[index]!, card }));
  const pending: Pending = { verb: "done", drafts, cards, final };
  const moved = await finishDone(deck, await writeRecord(plan, { pending }), pending);
  console.log(
    `Took in ${drafted.length} drafted and ${plan.joins.length} joined cards; the Cards stage is done, and the plan \`${moved.slug}\` is in the Check stage.`,
  );
}

/**
 * Finishes `card done` in the Cards stage from what its record holds: each
 * drafted card is filed under the id drawn for it, from the record rather
 * than its file, which a session may change or remove after a death, and
 * its file removed; last the order is recorded, moving the plan to Check.
 * A card already filed, kept as it stands though edited since, and a file
 * already gone are passed over, so every step is safe to run again.
 */
export async function finishDone(deck: Deck, plan: Plan, { drafts, cards, final }: Extract<Pending, { verb: "done" }>): Promise<Plan> {
  for (const { name, id, card } of drafts) {
    await fileCardAs(deck, id, card);
    // The next pass through this stage takes in whatever this directory
    // holds, so no file stays behind once its card is filed.
    try {
      await unlink(path.join(plan.cardsDir, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      continue;
    }
    wrote();
  }
  return writeRecord(plan, { state: "Check", cards, final, joins: [], pending: null });
}

/**
 * The waiting card `join` or `later` names: an open card no other plan holds,
 * none of this plan's cards, and none awaiting its promotion's key, which the
 * owner has settled already and `promote --key` alone takes, so a join would
 * keep the key from being recorded.
 */
export async function settling({ deck, plan, command, args }: Context, verb: string): Promise<{ id: string; card: Card }> {
  if (args.length !== 1) throw new Error(`usage: ${command} ${verb} <id>`);
  const id = args[0]!;
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  if (found.closed) throw new Error(`${id} is closed, so it is not waiting`);
  for (const other of await listPlans(deck)) {
    if (other.slug === plan.slug) {
      if (other.cards.includes(id)) throw new Error(`${id} is already one of this plan's cards`);
    } else if (other.cards.includes(id) || other.joins.includes(id)) {
      throw new Error(`${id} belongs to the plan \`${other.slug}\`, so it is not waiting`);
    }
  }
  const card = await readCard(found.path);
  if (awaitingKey(card)) throw new Error(`${id} is drafted for promotion, awaiting its key, which \`${command} promote ${id} --key <KEY>\` records`);
  return { id, card };
}

/**
 * `card join <id>`: the owner takes a waiting card into the plan, and the
 * next `card done` places it. A later decision on the same card is replaced.
 */
export async function join(context: Context): Promise<void> {
  const { plan, command } = context;
  const { id, card } = await settling(context, "join");
  const joins = plan.joins.includes(id) ? plan.joins : [...plan.joins, id];
  await writeRecord(plan, { joins, later: plan.later.filter((other) => other !== id) });
  console.log(`${id} has joined the plan \`${plan.slug}\`, and \`${command} done\` places it: ${card.headline}`);
}

/**
 * `card later <id>`: the owner leaves a waiting card for a later plan. It
 * stays waiting; the plan records the decision so its own Cards stage stops
 * asking. A join of the same card not yet taken in is withdrawn.
 */
export async function later(context: Context): Promise<void> {
  const { plan } = context;
  const { id, card } = await settling(context, "later");
  const later = plan.later.includes(id) ? plan.later : [...plan.later, id];
  await writeRecord(plan, { joins: plan.joins.filter((other) => other !== id), later });
  console.log(`${id} stays waiting, outside the plan \`${plan.slug}\`, for a later plan to take up: ${card.headline}`);
}

/**
 * The waiting card `decline` or `promote` names: an open card in no plan's
 * order and joined to none, or, where `closedAs` is given, the card already
 * closed with that text, which a run that died after closing it left.
 */
async function waitingCard(deck: Deck, id: string, closedAs?: string): Promise<Card> {
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  if (found.closed) {
    if (closedAs !== undefined && (await Bun.file(found.path).text()).endsWith(closedAs)) return readCard(found.path);
    throw new Error(`${id} is closed, so it is not waiting`);
  }
  for (const plan of await listPlans(deck)) {
    if (plan.cards.includes(id)) throw new Error(`${id} is one of the plan \`${plan.slug}\`'s cards, so it is not waiting`);
    if (plan.joins.includes(id)) throw new Error(`${id} has joined the plan \`${plan.slug}\`, so it is not waiting`);
  }
  return readCard(found.path);
}

/**
 * `card decline <id>`, with the owner's reason on stdin: closes a waiting card
 * declined, the reason its close note. A waiting card belongs to no plan, so
 * this needs none, and writes no plan's record, which a run going on
 * meanwhile writes whole and would write over.
 */
export async function decline(deck: Deck, args: string[]): Promise<void> {
  if (args.length !== 1) throw new Error("usage: card decline <id>, with the owner's reason on stdin");
  const id = args[0]!;
  const { headline } = await waitingCard(deck, id);
  const reason = (await Bun.stdin.text()).trim();
  if (reason === "") throw new Error(`\`card decline ${id}\` needs the owner's reason on stdin, which becomes its close note`);
  await closeCard(deck, id, "declined", reason);
  console.log(`${id} is closed declined: ${headline}`);
}

const PROMOTE_USAGE = "usage: card promote <id>..., with the session's draft on stdin, then card promote <id>... --key <KEY>";

/**
 * `card promote <id>...`, with the session's draft of a ticket on stdin: the
 * draft, checked for card ids as a close note is, since it goes to a tracker
 * outside the deck, is printed for the owner to post and appended to each
 * card's record as `## Promotion`, which marks the card awaiting a key.
 * `card promote <id>... --key <KEY>`: the owner posted it, and each card
 * closes promoted, the key in its close note. Like `decline`, it needs no
 * plan and writes no plan's record, and it refuses before marking any card.
 * Having no record to finish from, it is safe to run again instead: a card
 * an earlier run of the same invocation already closed under the key, or
 * marked with the same draft, is passed over, and the rest are done.
 */
export async function promote(deck: Deck, args: string[]): Promise<void> {
  const at = args.indexOf("--key");
  const key = at === -1 ? null : args[at + 1];
  const ids = at === -1 ? args : [...args.slice(0, at), ...args.slice(at + 2)];
  if (ids.length === 0 || key === undefined || ids.includes("--key")) throw new Error(PROMOTE_USAGE);
  const note = `Promoted to ${key}.`;
  const cards = await Promise.all(ids.map((id) => waitingCard(deck, id, key === null ? undefined : `\n## Close note\n\n${note}\n`)));

  if (key !== null) {
    for (const [index, id] of ids.entries()) {
      if (cards[index]!.closed === undefined) await closeCard(deck, id, "promoted", note);
      console.log(`${id} is closed promoted, as ${key}: ${cards[index]!.headline}`);
    }
    return;
  }
  const draft = await Bun.stdin.text();
  if (draft.trim() === "") {
    throw new Error(`\`card promote ${ids.join(" ")}\` needs the session's draft on stdin, which is printed for the owner to post`);
  }
  const cited = citedIds(draft, deck.prefix);
  if (cited.length > 0) throw new Error(`the draft must cite no card id, and it cites ${cited.join(", ")}`);
  const section = `\n## Promotion\n\n${demoteHeadlines(draft).replace(/\n*$/, "\n")}`;
  for (const id of ids) {
    if (!(await Bun.file((await locate(deck, id))!.path).text()).endsWith(section)) await appendRecord(deck, id, "Promotion", draft);
  }
  process.stdout.write(forOwner(draft));
  console.log(
    `Marked awaiting the ticket's key: ${ids.join(", ")}. Once the owner posts the draft and gives back its key, run \`card promote ${ids.join(" ")} --key <KEY>\`.`,
  );
}
