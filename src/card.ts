#!/usr/bin/env bun
import { createDeck, type Deck, DEFAULT_PREFIX, requireDeck, resolveDeck } from "./deck.ts";
import * as document from "./document.ts";
import { listCards } from "./operations.ts";
import { forOwner } from "./owner.ts";
import { type Context, listPlans, type Plan, refuseSlug, startPlan, type State } from "./plan.ts";

type Handler = (context: Context) => Promise<void>;

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

/**
 * The table under "The plan's states and the verb surface": what bare `card`
 * does in each state, and the verbs open there with the code each runs. Both
 * dispatch and every printed list of open commands read it, so a session is
 * never shown a command that would be refused, nor refused one it was shown.
 */
const TABLE: Record<State, { bare: Handler; open: Partial<Record<VerbName, Handler>> }> = {
  Document: { bare: document.printPrompt, open: { done: document.done } },
  Cards: { bare: report, open: {} },
  Check: { bare: report, open: {} },
  Running: { bare: report, open: {} },
  Bounced: { bare: report, open: {} },
  Stopped: { bare: report, open: {} },
  Dead: { bare: report, open: {} },
  Ended: { bare: report, open: {} },
};

const USAGE = `usage: card [<verb>] [--plan <slug>]

  ${VERBS.join("  ")}`;

/** `card`, or with more than one plan in progress, `card --plan <slug>`: how this plan's every command starts. */
function commandFor(plan: Plan, many: boolean): string {
  return many ? `card --plan ${plan.slug}` : "card";
}

/** The commands open in the plan's state, bare `card` first, one per line. */
function openCommands(plan: Plan, command: string): string {
  const verbs = Object.keys(TABLE[plan.state].open);
  return [command, ...verbs.map((verb) => `${command} ${verb}`)].map((line) => `  ${line}\n`).join("");
}

/** Bare `card` in a state whose own printout is later work: where the plan stands, and what is open. */
async function report({ plan, command }: Context): Promise<void> {
  process.stdout.write(`The plan \`${plan.slug}\` is in ${plan.state}, where these commands are open:\n${openCommands(plan, command)}`);
}

/**
 * The waiting cards, for the owner: every open card no plan's order lists.
 * No plan records an order yet, so that is every card in `open/`.
 */
async function printWaiting(deck: Deck, command: string): Promise<void> {
  const { listed, warnings } = await listCards(deck, "open", []);
  for (const warning of warnings) console.error(`card: ${warning}`);
  if (listed.length === 0) return;
  const lines = listed.map(
    ({ id, card }) => `${id}  ${card.headline}\n  ${command} decline ${id}\n  ${command} promote ${id}\n`,
  );
  process.stdout.write(forOwner(`Cards waiting in no plan, which no run picks up:\n\n${lines.join("\n")}`));
}

/** Starts a plan, under `slug` or a placeholder, and prints what a start prints. */
async function start(deck: Deck, slug: string | null, many: boolean): Promise<void> {
  const plan = await startPlan(deck, slug);
  const command = commandFor(plan, many);
  await printWaiting(deck, command);
  await TABLE[plan.state].bare({ deck, plan, command, args: [] });
}

/** Bare `card`: the next thing, or where things stand. */
async function bare(slug: string | null, cwd: string): Promise<void> {
  // A plan is about to start or already exists, and either way it needs a deck.
  const deck = (await resolveDeck(cwd)) ?? (await createDeck(cwd, DEFAULT_PREFIX));
  const plans = await listPlans(deck);
  const many = plans.length > 1;

  if (slug !== null) {
    const named = plans.find((plan) => plan.slug === slug);
    if (named !== undefined) return TABLE[named.state].bare({ deck, plan: named, command: commandFor(named, many), args: [] });
    // The one place a slug no plan has starts something.
    refuseSlug(slug);
    return start(deck, slug, plans.length > 0);
  }
  if (plans.length === 0) return start(deck, null, false);
  if (!many) return TABLE[plans[0]!.state].bare({ deck, plan: plans[0]!, command: "card", args: [] });

  const listing = plans.map((plan) => `${plan.slug}  ${plan.state}\n${openCommands(plan, commandFor(plan, true))}`);
  process.stdout.write(`More than one plan is in progress, so every command names its plan:\n\n${listing.join("\n")}`);
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
    const commands = plans.map((plan) => `  card --plan ${plan.slug} ${verb}\n`).join("");
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
  const plans = await listPlans(deck);
  const plan = pick(plans, slug, name);
  const command = commandFor(plan, plans.length > 1);
  const handler = TABLE[plan.state].open[name as VerbName];
  if (handler === undefined) {
    throw new Error(
      `\`${command} ${name}\` is not open while the plan \`${plan.slug}\` is in ${plan.state}, where these commands are open:\n${openCommands(plan, command).trimEnd()}`,
    );
  }
  await handler({ deck, plan, command, args });
}

try {
  await main(process.argv.slice(2), process.cwd());
} catch (error) {
  console.error(`card: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
