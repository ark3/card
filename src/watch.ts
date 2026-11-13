import { networkInterfaces } from "node:os";
import path from "node:path";
import { readCard } from "./cardfile.ts";
import { members } from "./cards.ts";
import { EXCHANGES, REVISION_ROUNDS, type Role } from "./cycle.ts";
import { CONFIG_NAME, type Deck, locate } from "./deck.ts";
import { listPlans, type Plan, type State } from "./plan.ts";

/**
 * Why the current card is flagged, each an early sign of a bounce: its
 * active time is over twice the landed cards' mean, it has had the last
 * revision round its cap allows, or it has begun the last exchange.
 */
export type Flag = "long" | "rounds" | "exchanges";

/**
 * The card a plan's cycle is at, whose commit has not landed: its id and
 * headline, its role, the revision rounds and exchanges it has had, its
 * active time so far in milliseconds, and its flags.
 */
export type Current = { id: string; headline: string; role: Role; rounds: number; exchanges: number; active: number; flags: Flag[] };

/**
 * What `card watch` shows of one plan, as data, for whatever reports it:
 * the plan's cards closed done out of its cards, as `members` counts them;
 * the run's active time in milliseconds; the time left, roughly, or null
 * with no landed card's time to go on; and the card the cycle is at, or
 * null between cards.
 */
export type Figures = {
  slug: string;
  state: State;
  closed: number;
  cards: number;
  elapsed: number;
  estimate: number | null;
  current: Current | null;
};

const sum = (values: number[]) => values.reduce((total, each) => total + each, 0);

/**
 * The figures of `plan` at `now`, as `Date.now()` gives it, read from the
 * deck and the plan's record and writing nothing. The current card's time so
 * far is its cycle's accumulated time, with the in-flight session's start
 * added only while the plan is Running, since a run killed mid-turn leaves
 * the start recorded; a cycle whose commit is set has none, since its time is
 * its card's `landed` entry. The estimate is the mean active time of the
 * landed cards that have one, times the cards not yet closed, the final card
 * among them.
 */
export async function figures(deck: Deck, plan: Plan, now: number): Promise<Figures> {
  const kept = await members(deck, plan);
  const closed = kept.filter(({ landed }) => landed).length;
  const times = plan.landed.flatMap(({ active }) => (active === undefined ? [] : [active]));
  const mean = times.length === 0 ? null : sum(times) / times.length;
  const { cycle } = plan;
  let current: Current | null = null;
  if (cycle !== null && cycle.commit === undefined) {
    const running = plan.state === "Running" && cycle.started !== undefined ? now - cycle.started : 0;
    const active = sum(Object.values(cycle.active ?? {})) + running;
    const flags: Flag[] = [];
    if (mean !== null && active > 2 * mean) flags.push("long");
    if (cycle.rounds >= REVISION_ROUNDS) flags.push("rounds");
    if (cycle.exchanges >= EXCHANGES) flags.push("exchanges");
    const { headline } = await readCard((await locate(deck, cycle.card))!.path);
    current = { id: cycle.card, headline, role: cycle.role, rounds: cycle.rounds, exchanges: cycle.exchanges, active, flags };
  }
  return {
    slug: plan.slug,
    state: plan.state,
    closed,
    cards: kept.length,
    elapsed: sum(times) + (current?.active ?? 0),
    estimate: mean === null ? null : mean * (kept.length - closed),
    current,
  };
}

/** A duration, roughly: seconds under a minute, minutes under an hour, hours and minutes beyond. */
function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

const FLAGS: Record<Flag, string> = {
  long: "over twice the landed mean",
  rounds: "at the last revision round",
  exchanges: "at the last exchange",
};

/** The lines `card watch` draws for one plan's figures. */
function draw(shown: Figures): string[] {
  const { slug, state, closed, cards, elapsed, estimate, current } = shown;
  const left = estimate === null ? "no estimate yet" : `about ${duration(estimate)} left`;
  const lines = [`${slug}  ${state}`, `  ${closed}/${cards} cards closed, ${duration(elapsed)} active, ${left}`];
  switch (state) {
    case "Running":
      if (current === null) {
        lines.push("  between cards");
        break;
      }
      lines.push(`  ${current.id}  ${current.headline}`);
      lines.push(
        `  ${current.role}, revisions ${current.rounds}/${REVISION_ROUNDS}, exchanges ${current.exchanges}/${EXCHANGES}, ${duration(current.active)} active`,
      );
      if (current.flags.length > 0) lines.push(`  ! ${current.flags.map((flag) => FLAGS[flag]).join("; ")}`);
      break;
    case "Dead":
      lines.push("  the run is dead; bare `card` carries it on");
      break;
    case "Bounced":
      lines.push("  the run bounced; bare `card` reports it");
      break;
    case "Stopped":
      lines.push("  the run is stopped; bare `card` reports it");
      break;
  }
  return lines;
}

/** One frame of `card watch`: every plan in progress, or that there is none. */
async function frame(deck: Deck): Promise<string> {
  const plans = await listPlans(deck);
  if (plans.length === 0) return "No plan is in progress.\n";
  const now = Date.now();
  const blocks = await Promise.all(plans.map(async (plan) => draw(await figures(deck, plan, now)).join("\n")));
  return `${blocks.join("\n\n")}\n`;
}

/** One frame's text, or why it could not be read, for the terminal and the page alike. */
async function view(deck: Deck): Promise<string> {
  try {
    return await frame(deck);
  } catch (error) {
    return `card: ${error instanceof Error ? error.message : String(error)}\n`;
  }
}

/**
 * A test's way to redraw faster than a person needs, in milliseconds. Inert
 * unless the test sets the variable.
 */
const EVERY = Number(process.env.CARD_WATCH_EVERY ?? 0) || 2000;

/** How often the page reloads itself, in seconds. */
const REFRESH = 3;

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** `text` made safe to place in HTML, since card headlines and slugs are arbitrary. */
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ENTITIES[char]!);

/** The page: the frame's text, escaped, reloading itself every few seconds. */
function page(text: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="${REFRESH}">
<title>card watch</title>
</head>
<body>
<pre>${escape(text)}</pre>
</body>
</html>
`;
}

/** The port `[watch] port` in the deck's config sets, or 0, for a free one, when it sets none. */
async function configuredPort(deck: Deck): Promise<number> {
  const configPath = path.join(deck.cardDir, CONFIG_NAME);
  const parsed = Bun.TOML.parse(await Bun.file(configPath).text()) as { watch?: { port?: unknown } };
  const port = parsed.watch?.port;
  if (port === undefined) return 0;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${configPath} sets [watch] port to ${JSON.stringify(port)}, which is not a port`);
  }
  return port;
}

/** The machine's first non-loopback IPv4 address, or null when it has none. */
function lanAddress(): string | null {
  for (const each of Object.values(networkInterfaces()).flat()) {
    if (each !== undefined && each.family === "IPv4" && !each.internal) return each.address;
  }
  return null;
}

/**
 * `card watch`: redraws every plan in progress in place, every couple of
 * seconds, until it is killed, writing nothing anywhere but the terminal. A
 * frame that cannot be read, as when a card moves between directories under
 * it, shows why, and the next frame tries again. While it runs it serves the
 * same view as a page, on 127.0.0.1 alone unless `network` is set, since the
 * page has no authentication, and every frame ends with the page's URL; the
 * server lives in this process, so killing it stops the page.
 */
export async function watch(deck: Deck, network: boolean): Promise<never> {
  const port = await configuredPort(deck);
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: network ? "0.0.0.0" : "127.0.0.1",
      port,
      async fetch(request) {
        if (new URL(request.url).pathname !== "/") return new Response("Not found\n", { status: 404 });
        return new Response(page(await view(deck)), { headers: { "content-type": "text/html; charset=utf-8" } });
      },
    });
  } catch (error) {
    if ((error as { code?: unknown }).code === "EADDRINUSE") throw new Error(`port ${port}, which [watch] port sets, is taken`);
    throw error;
  }
  // With no non-loopback address, the page is still reachable on this machine.
  const host = network ? (lanAddress() ?? "127.0.0.1") : "127.0.0.1";
  const url = `http://${host}:${server.port}/`;
  for (;;) {
    let text = `${await view(deck)}\nServed at ${url}\n`;
    const width = process.stdout.columns;
    if (width !== undefined) text = text.split("\n").map((line) => line.slice(0, width)).join("\n");
    // Home and clear to the end, so each frame replaces the last.
    process.stdout.write(`\x1b[H\x1b[J${text}`);
    await Bun.sleep(EVERY);
  }
}
