#!/usr/bin/env bun
import * as bounced from "./bounced.ts";
import { createDeck, type Deck, DEFAULT_PREFIX, requireDeck, resolveDeck } from "./deck.ts";
import * as cards from "./cards.ts";
import * as check from "./check.ts";
import * as dead from "./dead.ts";
import * as document from "./document.ts";
import * as ended from "./ended.ts";
import { forOwner } from "./owner.ts";
import { type Context, listPlans, listWaiting, type Pending, type Plan, refuseSlug, startPlan, type State, sweepRemoved, waitingCards } from "./plan.ts";
import * as reports from "./reports.ts";
import * as stopped from "./stopped.ts";

type Handler = (context: Context) => Promise<void>;
/** A verb's code, and the arguments every printed command shows it with. */
type Verb = { run: Handler; args?: string };

/**
 * Every verb of `BRIEF.md`'s surface but bare `card`, named from the start:
 * a verb whose code has not landed is open in no state yet, so it refuses as
 * not open there rather than as unknown, and anything else is unknown.
 */
const VERBS = [
  "done",
  "approve",
  "amend",
  "stop",
  "ask",
  "resume",
  "join",
  "later",
  "decline",
  "promote",
  "finish",
  "drop",
] as const;
type VerbName = (typeof VERBS)[number];

/** `card drop`, which every row of the table opens. */
const DROP: Verb = { run: ended.drop };

/**
 * The table under "The plan's states and the verb surface": what bare `card`
 * does in each state, and the verbs open there with the code each runs. Both
 * dispatch and every printed list of open commands read it, so a session is
 * never shown a command that would be refused, nor refused one it was shown.
 * `decline` and `promote` are in no row: they are open in every state and
 * with no plan at all, so `main` runs them ahead of the table, and they are
 * printed only beside the waiting cards they settle. `drop` is in every row,
 * since it is open in every state but needs a plan.
 */
const TABLE: Record<State, { bare: Handler; open: Partial<Record<VerbName, Verb>> }> = {
  Document: { bare: document.printPrompt, open: { done: { run: document.done }, drop: DROP } },
  Cards: {
    bare: cards.printPrompt,
    open: { done: { run: cards.done }, join: { run: cards.join, args: "<id>" }, later: { run: cards.later, args: "<id>" }, drop: DROP },
  },
  Check: { bare: check.printPrompt, open: { approve: { run: check.approve }, amend: { run: check.amend }, drop: DROP } },
  Running: { bare: reports.running, open: { stop: { run: stopped.stop }, drop: DROP } },
  Bounced: {
    bare: reports.bounced,
    open: { ask: { run: bounced.ask }, resume: { run: bounced.resume }, amend: { run: stopped.amend }, drop: DROP },
  },
  Stopped: { bare: reports.stopped, open: { resume: { run: stopped.resume }, amend: { run: stopped.amend }, drop: DROP } },
  Dead: { bare: dead.carryOn, open: { stop: { run: stopped.stop }, drop: DROP } },
  Ended: {
    bare: ended.printPrompt,
    open: { join: { run: ended.join, args: "<id>" }, later: { run: cards.later, args: "<id>" }, finish: { run: ended.finish }, drop: DROP },
  },
};

const USAGE = `usage: card [<verb>] [--plan <slug>]

  ${VERBS.join("  ")}`;

/** `card`, or with more than one plan in progress, `card --plan <slug>`: how this plan's every command starts. */
function commandFor(plan: Plan, many: boolean): string {
  return many ? `card --plan ${plan.slug}` : "card";
}

/** The commands open in the plan's state, bare `card` first, one per line. */
function openCommands(plan: Plan, command: string): string {
  const verbs = Object.entries(TABLE[plan.state].open).map(([name, verb]) => `${command} ${name}${verb.args ? ` ${verb.args}` : ""}`);
  return [command, ...verbs].map((line) => `  ${line}\n`).join("");
}

/**
 * The waiting cards, for the owner, when there are any. A card awaiting its
 * promotion's key is listed with the command that records it alone, since the
 * owner has settled it already.
 */
async function printWaiting(deck: Deck, command: string): Promise<void> {
  const listed = await waitingCards(deck);
  if (listed.length === 0) return;
  process.stdout.write(forOwner(listWaiting(listed, command)));
}

/**
 * Every plan in progress, each with any verb its record holds pending
 * finished first. A verb that writes more than once records what it is
 * doing, with what finishing it needs, before its first other write, and
 * every step after is safe to run again, so one that died partway is
 * finished here, once, before any verb or bare `card` acts on the plan, and
 * the invocation goes on from where the verb would have left it; a plan the
 * finished verb removed is not in the list. What a plan removal left is
 * removed first. Done here rather than in `listPlans`, which reads, so that
 * no read path writes, and no run of another plan, which lists the plans
 * too, finishes a verb still in flight.
 *
 * A step can refuse as well as die, as git refuses to remove a locked
 * worktree, and then the verb stays recorded and its plan is listed still
 * holding it, which `held` refuses every verb on, so one plan's refusal
 * stops no other plan and no verb that needs none.
 */
async function plansIn(deck: Deck): Promise<Plan[]> {
  await sweepRemoved(deck);
  const plans: Plan[] = [];
  for (const plan of await listPlans(deck)) {
    if (plan.pending === null) {
      plans.push(plan);
      continue;
    }
    const recorded = `\`card ${plan.pending.verb}\` on the plan \`${plan.slug}\` is recorded but did not finish`;
    let finished: Plan | null;
    try {
      finished = await finish(deck, plan, plan.pending);
    } catch (error) {
      console.error(`card: ${recorded}, and finishing it failed: ${error instanceof Error ? error.message : String(error)}`);
      plans.push(plan);
      continue;
    }
    console.error(`card: ${recorded}, and is finished now, before anything else runs`);
    if (finished !== null) plans.push(finished);
  }
  return plans;
}

/** Refuses to act on `plan` while it holds a recorded verb that could not finish, which the next run of `card` tries again. */
function held(plan: Plan): void {
  if (plan.pending === null) return;
  throw new Error(`the plan \`${plan.slug}\` is held until its recorded \`card ${plan.pending.verb}\` finishes, which the next run of card tries again once what stopped it, above, is put right`);
}

/** Finishes the verb `pending` records on `plan`, returning the plan as the verb leaves it, or null where it removed the plan. */
async function finish(deck: Deck, plan: Plan, pending: Pending): Promise<Plan | null> {
  switch (pending.verb) {
    case "done":
      return cards.finishDone(deck, plan, pending);
    case "join":
      return ended.finishJoin(deck, plan, pending.id);
    case "amend":
      return stopped.finishAmend(deck, plan);
    case "drop":
      await ended.finishDrop(deck, plan, pending.settles);
      return null;
  }
}

/** Starts a plan, under `slug` or a placeholder, and prints what a start prints. */
async function start(deck: Deck, slug: string | null, many: boolean): Promise<void> {
  const plan = await startPlan(deck, slug);
  const command = commandFor(plan, many);
  await printWaiting(deck, command);
  await TABLE[plan.state].bare({ deck, plan, command, args: [], openCommands });
}

/** Bare `card`: the next thing, or where things stand. */
async function bare(slug: string | null, cwd: string): Promise<void> {
  // A plan is about to start or already exists, and either way it needs a deck.
  const deck = (await resolveDeck(cwd)) ?? (await createDeck(cwd, DEFAULT_PREFIX));
  const plans = await plansIn(deck);
  const many = plans.length > 1;

  if (slug !== null) {
    const named = plans.find((plan) => plan.slug === slug);
    if (named !== undefined) {
      held(named);
      return TABLE[named.state].bare({ deck, plan: named, command: commandFor(named, many), args: [], openCommands });
    }
    // The one place a slug no plan has starts something.
    refuseSlug(slug);
    return start(deck, slug, plans.length > 0);
  }
  if (plans.length === 0) return start(deck, null, false);
  if (!many) {
    held(plans[0]!);
    return TABLE[plans[0]!.state].bare({ deck, plan: plans[0]!, command: "card", args: [], openCommands });
  }

  // Where things stand is the owner's; the commands are the session's menu,
  // and a held plan has none open.
  const states = plans
    .map((plan) => `${plan.slug}  ${plan.state}${plan.pending === null ? "" : `, held until its recorded \`card ${plan.pending.verb}\` finishes`}\n`)
    .join("");
  const commands = plans
    .filter((plan) => plan.pending === null)
    .map((plan) => openCommands(plan, commandFor(plan, true)))
    .join("\n");
  process.stdout.write(`${forOwner(`More than one plan is in progress:\n\n${states}`)}\nThe commands open in each plan, every one naming its plan:\n\n${commands}`);
}

/** The plan a verb other than bare `card` means, which must already be in progress. */
function pick(plans: Plan[], slug: string | null, verb: string): Plan {
  if (slug !== null) {
    const named = plans.find((plan) => plan.slug === slug);
    if (named !== undefined) return named;
    // Refused rather than started, so a typo in a slug starts nothing, and the
    // refusal names no command that would start one under the typo.
    const known = plans.length === 0 ? "no plan is" : `the plans in progress are ${plans.map((plan) => `\`${plan.slug}\``).join(", ")}`;
    throw new Error(`no plan \`${slug}\` is in progress, and ${known}`);
  }
  if (plans.length === 0) throw new Error("no plan is in progress; bare `card` starts one");
  if (plans.length > 1) {
    const commands = plans
      .filter((plan) => plan.pending === null)
      .map((plan) => `  card --plan ${plan.slug} ${verb}\n`)
      .join("");
    throw new Error(`more than one plan is in progress, so name the one you mean:\n${commands.trimEnd()}`);
  }
  return plans[0]!;
}

/** Takes `--plan <slug>` out of the arguments wherever it sits, leaving the verb and its own arguments. */
function parse(argv: string[]): { slug: string | null; name: string | undefined; args: string[] } {
  let slug: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--plan") {
      rest.push(argv[i]!);
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`--plan needs a slug\n${USAGE}`);
    if (slug !== null) throw new Error(`--plan names one plan, and this names \`${slug}\` and \`${value}\``);
    slug = value;
  }
  return { slug, name: rest[0], args: rest.slice(1) };
}

async function main(argv: string[], cwd: string): Promise<void> {
  const { slug, name, args } = parse(argv);
  if (name === undefined) return bare(slug, cwd);
  if (!(VERBS as readonly string[]).includes(name)) throw new Error(`no such verb as \`${name}\`\n${USAGE}`);

  const deck = await requireDeck(cwd);
  const plans = await plansIn(deck);
  if (name === "decline" || name === "promote") {
    // A slug it is given must still name a plan, so a typo is refused here as everywhere.
    if (slug !== null) pick(plans, slug, name);
    return cards[name](deck, args);
  }
  const plan = pick(plans, slug, name);
  held(plan);
  const command = commandFor(plan, plans.length > 1);
  const verb = TABLE[plan.state].open[name as VerbName];
  if (verb === undefined) {
    throw new Error(
      `\`${command} ${name}\` is not open while the plan \`${plan.slug}\` is in ${plan.state}, where these commands are open:\n${openCommands(plan, command).trimEnd()}`,
    );
  }
  await verb.run({ deck, plan, command, args, openCommands });
}

try {
  await main(process.argv.slice(2), process.cwd());
} catch (error) {
  console.error(`card: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
