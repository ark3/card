import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Deck } from "./deck.ts";
import { drawId } from "./id.ts";

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
 * Every plan in progress, by slug. A plan is a directory under `plans/` with a
 * state file; one without, a start that stopped before its record was
 * written, is not a plan.
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
    plans.push(plan(deck, slug, (await file.json()) as PlanRecord));
  }
  return plans;
}

/** Writes the plan's state file whole, staged and renamed so no reader sees half of one. */
export async function writeRecord(target: Plan, record: PlanRecord): Promise<Plan> {
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
  const record: PlanRecord = { state: "Document", placeholder: slug === null };
  const started = plan(deck, slug ?? drawId("draft"), record);
  // Not recursive, so a slug already taken fails here rather than sharing a
  // directory; a drawn one collides once in 729,000, and a rerun draws again.
  await mkdir(started.dir);
  await mkdir(started.cardsDir);
  return writeRecord(started, record);
}

/** Moves the plan, everything in its directory with it, to `slug`. */
export async function renamePlan(deck: Deck, from: Plan, slug: string): Promise<Plan> {
  const moved = plan(deck, slug, from);
  await rename(from.dir, moved.dir);
  return moved;
}
