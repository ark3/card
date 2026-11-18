import path from "node:path";
import { readCard } from "./cardfile.ts";
import type { Role } from "./cycle.ts";
import { CONFIG_NAME, type Deck, locate } from "./deck.ts";
import { kill, marked, type Plan } from "./plan.ts";
import { figures } from "./watch.ts";

/** What the run tells the owner's push command of. */
export type Event = "landed" | "bounced" | "stopped" | "ended";

/**
 * How long a push command has, in milliseconds. A one-line `curl` or `ntfy`
 * to a push service answers within a second or two; ten seconds leaves room
 * for a slow network, and bounds how long a card's next cycle, or the owner's
 * next command, waits on a push. A test's way to shorten it is the variable,
 * inert unless the test sets it.
 */
const NOTIFY_TIMEOUT_MS = Number(process.env.CARD_NOTIFY_TIMEOUT_MS ?? 0) || 10_000;

/**
 * The variable each push command is started with, set to a value of its own,
 * so a process it starts in a session of its own, which its process group
 * does not hold, is still found and ended on the timeout.
 */
const NOTIFY_MARK = "CARD_NOTIFY";

/** The command `[notify] command` in the deck's config sets, or null when it sets none. */
async function configuredCommand(deck: Deck): Promise<string | null> {
  const configPath = path.join(deck.cardDir, CONFIG_NAME);
  const parsed = Bun.TOML.parse(await Bun.file(configPath).text()) as { notify?: { command?: unknown } };
  const command = parsed.notify?.command;
  if (command === undefined) return null;
  if (typeof command !== "string") throw new Error(`${configPath} sets [notify] command to ${JSON.stringify(command)}, which is not a string`);
  return command;
}

/**
 * Calls the owner's push command, where the deck's config sets one, on
 * `event` of `plan` as its record now stands, at card `id` where there is
 * one, with the role and cause of a bounce. It runs as
 * `sh -c <command> card-notify <summary>`, the summary one line in `$1`,
 * with the event as one JSON object on its stdin, the counts and estimate
 * from `figures`, as `card watch` shows them. Its output goes to the run's
 * log, which its stdout and stderr are, so nothing waits on a pipe it holds
 * open; its exit status or its timeout follows. Nothing it does, nor any
 * failure here, reaches the run: every error is logged and swallowed, and on
 * the timeout the command and what it started are killed at once, since a
 * grace period would hold the run past the timeout.
 */
export async function notify(deck: Deck, plan: Plan, event: Event, id: string | null = null, bounce: { role: Role; cause: string } | null = null): Promise<void> {
  try {
    const command = await configuredCommand(deck);
    if (command === null) return;
    const headline = id === null ? null : (await readCard((await locate(deck, id))!.path)).headline;
    const { closed, cards, estimate } = await figures(deck, plan, Date.now());
    const summary = `${plan.slug}: ${event}${id === null ? "" : ` ${id}  ${headline}`}`;
    const payload = { plan: plan.slug, event, card: id === null ? null : { id, headline }, bounce, closed, cards, estimate };
    const value = crypto.randomUUID();
    const proc = Bun.spawn(["/bin/sh", "-c", command, "card-notify", summary], {
      env: { ...process.env, [NOTIFY_MARK]: value },
      // Its own process group, so the timeout ends whatever it started.
      detached: true,
      stdin: new Blob([JSON.stringify(payload)]),
      stdout: "inherit",
      stderr: "inherit",
    });
    let timer: Timer | undefined;
    const timedOut = await Promise.race([
      proc.exited.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), NOTIFY_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (timedOut) {
      const running = async () => [...(kill(-proc.pid, 0) ? [-proc.pid] : []), ...(await marked(`${NOTIFY_MARK}=${value}`))];
      for (let left = await running(); left.length > 0; left = await running()) {
        for (const each of left) kill(each, "SIGKILL");
        await Bun.sleep(10);
      }
      console.error(`card: the push command for ${event} timed out after ${NOTIFY_TIMEOUT_MS}ms and was killed`);
    } else if (proc.exitCode !== 0) {
      const ended = proc.signalCode !== null ? `was killed by ${proc.signalCode}` : `exited with status ${proc.exitCode}`;
      console.error(`card: the push command for ${event} ${ended}`);
    } else {
      console.log(`The push command for ${event} exited with status 0.`);
    }
  } catch (error) {
    console.error(`card: the push command for ${event} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
