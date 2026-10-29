import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Cycle, Role } from "./cycle.ts";
import type { Deck } from "./deck.ts";
import type { Harness, Session } from "./harness.ts";
import { drawId } from "./id.ts";
import { type Listed, listCards } from "./operations.ts";

/**
 * The rows of `BRIEF.md`'s table under "The plan's states and the verb
 * surface". Dead is Running with its process gone, which the tool detects
 * rather than records, but it is a row of the table all the same.
 */
export const STATES = ["Document", "Cards", "Check", "Running", "Bounced", "Stopped", "Dead", "Ended"] as const;
export type State = (typeof STATES)[number];

/** What a plan's state file holds, written whole on every change. */
export type PlanRecord = {
  state: State;
  /**
   * Whether the plan's slug was drawn for want of a name, so that the end of
   * the Document stage replaces it with one made from the headline. A plan
   * started under `--plan <slug>` keeps the name it was given.
   */
  placeholder: boolean;
  /**
   * The plan's cards, by id, in the order the run takes them, as the Cards
   * stage's `card done` last set it. A card closed done keeps its place; one
   * closed any other way stays listed until the next take-in drops it.
   */
  cards: string[];
  /** The card that checks the whole plan, which runs last; null until the first take-in. */
  final: string | null;
  /** Waiting cards `card join` took into the plan, in join order, which the next take-in places. */
  joins: string[];
  /**
   * Waiting cards `card later` left outside this plan. They stay waiting for
   * every other plan; this plan's Cards stage no longer asks about them.
   */
  later: string[];
  /**
   * The card cycle the run is in or last ran, as the cycle records it at each
   * step; null until the first one starts.
   */
  cycle: Cycle | null;
  /** The harness `card approve` chose for the run, which every launch and resume of the run uses; null until then. */
  harness: Harness | null;
  /**
   * The run's process, with the kernel's boot id at its start, since a pid
   * alone can name an unrelated live process after a reboot; null until the
   * first `card approve`.
   */
  run: { pid: number; boot: string } | null;
  /** Every card the run has closed done, with its commit, in the order it closed them. */
  landed: { card: string; commit: string }[];
  /**
   * Every finding the run has filed, in the order it filed them: the id of the
   * waiting card it was filed as, the role that filed it and the card it was
   * found under, for the end of the plan to hand back.
   */
  findings: { id: string; role: Role; card: string }[];
  /**
   * The role that stopped the run, its session and the cause, while the plan
   * is Bounced, with the question for the owner of a reconciler that stopped
   * it, and the gap where it stopped the final card for one, or the last
   * feedback of a reviewer that asked for a revision past the cap; a role
   * that failed asks none.
   */
  bounce: { role: Role; session: Session; cause: string; question?: string; feedback?: string; gap?: string } | null;
};

/** What a state file written before a field existed reads as for that field. */
const EMPTY: Omit<PlanRecord, "state" | "placeholder"> = {
  cards: [],
  final: null,
  joins: [],
  later: [],
  cycle: null,
  harness: null,
  run: null,
  landed: [],
  findings: [],
  bounce: null,
};

export type Plan = PlanRecord & {
  slug: string;
  /** `<card-dir>/plans/<slug>`. */
  dir: string;
  /** The plan document, which the Document stage's session writes. */
  document: string;
  /** Where the Cards stage's session drafts the cards. */
  cardsDir: string;
};

/**
 * What a verb acting on one plan is handed. `command` is how every printed
 * command starts: `card`, or `card --plan <slug>` while more than one plan is
 * in progress.
 */
export type Context = { deck: Deck; plan: Plan; command: string; args: string[] };

const STATE_FILE = "state.json";
// What `slugify` makes: lowercase letters and digits in runs joined by single
// hyphens. Anything else must never be joined onto the plans directory.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function plansDir(deck: Deck): string {
  return path.join(deck.cardDir, "plans");
}

function plan(deck: Deck, slug: string, record: PlanRecord): Plan {
  const dir = path.join(plansDir(deck), slug);
  return { ...record, slug, dir, document: path.join(dir, "plan.md"), cardsDir: path.join(dir, "cards") };
}

/**
 * A headline made a slug: lowercased, every character but a letter, a digit,
 * a space or a hyphen dropped, and each run of spaces and hyphens made one
 * hyphen. Dropped rather than made hyphens, so `Configure src/db.clj` becomes
 * `configure-srcdbclj`, with a hyphen only where the headline has a word
 * break. Empty when the headline has no letter or digit in it.
 */
export function slugify(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function refuseSlug(slug: string): void {
  if (!SLUG.test(slug)) {
    throw new Error(`\`${slug}\` is not a plan slug: lowercase letters and digits, joined by single hyphens`);
  }
}

/**
 * Whether the run a Running plan records has died: its pid is gone, or the
 * kernel has booted since it started, when the pid names nothing of the run's.
 */
async function died({ pid, boot }: { pid: number; boot: string }): Promise<boolean> {
  if (boot !== (await bootId())) return true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    // EPERM is a live process another user owns.
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
  return false;
}

/**
 * Every plan in progress, by slug. A plan is a directory under `plans/` with a
 * state file; one without, a start that stopped before its record was
 * written, is not a plan. A Running plan whose run has died reads as Dead,
 * which is never written.
 */
export async function listPlans(deck: Deck): Promise<Plan[]> {
  let names: string[];
  try {
    names = (await readdir(plansDir(deck))).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const plans: Plan[] = [];
  for (const slug of names) {
    const file = Bun.file(path.join(plansDir(deck), slug, STATE_FILE));
    if (!(await file.exists())) continue;
    const record: PlanRecord = { ...EMPTY, ...((await file.json()) as PlanRecord) };
    // `card approve` records the run with the state that names it.
    if (record.state === "Running" && (await died(record.run!))) record.state = "Dead";
    plans.push(plan(deck, slug, record));
  }
  return plans;
}

/**
 * Writes the plan's state file whole, `changes` over what the plan already
 * records, staged and renamed so no reader sees half of one.
 */
export async function writeRecord(target: Plan, changes: Partial<PlanRecord>): Promise<Plan> {
  const { state, placeholder, cards, final, joins, later, cycle, harness, run, landed, findings, bounce } = { ...target, ...changes };
  const record: PlanRecord = { state, placeholder, cards, final, joins, later, cycle, harness, run, landed, findings, bounce };
  const staging = path.join(target.dir, `.${STATE_FILE}.writing`);
  await writeFile(staging, `${JSON.stringify(record)}\n`);
  await rename(staging, path.join(target.dir, STATE_FILE));
  return { ...target, ...record };
}

/**
 * Starts a plan in the Document stage, under `slug`, or under a placeholder
 * drawn here when `slug` is null. The plan document is not written: the
 * Document stage's session writes it.
 */
export async function startPlan(deck: Deck, slug: string | null): Promise<Plan> {
  await mkdir(plansDir(deck), { recursive: true });
  // The id alphabet's syllables, so the placeholder is short enough to type
  // in `--plan`, and a drawn slug is never handed to a second plan, as a
  // counter's next number would be once its plan took a headline's name.
  const record: PlanRecord = { ...EMPTY, state: "Document", placeholder: slug === null };
  const started = plan(deck, slug ?? drawId("draft"), record);
  // Not recursive, so a slug already taken fails here rather than sharing a
  // directory; a drawn one collides once in 729,000, and a rerun draws again.
  await mkdir(started.dir);
  await mkdir(started.cardsDir);
  return writeRecord(started, record);
}

/** The kernel's boot id, which changes at every boot. */
export async function bootId(): Promise<string> {
  return (await Bun.file("/proc/sys/kernel/random/boot_id").text()).trim();
}

/** Moves the plan, everything in its directory with it, to `slug`. */
export async function renamePlan(deck: Deck, from: Plan, slug: string): Promise<Plan> {
  const moved = plan(deck, slug, from);
  await rename(from.dir, moved.dir);
  return moved;
}

/**
 * The waiting cards: every card in `open/` that no plan's order lists and no
 * plan has joined, since a join is the owner's decision already made, and
 * listing its card as waiting would offer it to a second plan. Cards in
 * `except` are left out as well. Prints the deck's disrepair to stderr.
 */
export async function waitingCards(deck: Deck, except: string[] = []): Promise<Listed[]> {
  const { listed, warnings } = await listCards(deck, "open", []);
  for (const warning of warnings) console.error(`card: ${warning}`);
  const taken = new Set(except);
  for (const other of await listPlans(deck)) for (const id of [...other.cards, ...other.joins]) taken.add(id);
  return listed.filter(({ id }) => !taken.has(id));
}

/** The waiting cards for the owner, each with its id and headline and the commands that settle it beside it. */
export function listWaiting(listed: Listed[], command: string, verbs: string[]): string {
  const lines = listed.map(({ id, card }) => `${id}  ${card.headline}\n${verbs.map((verb) => `  ${command} ${verb} ${id}\n`).join("")}`);
  return `Cards waiting in no plan, which no run picks up:\n\n${lines.join("\n")}`;
}
