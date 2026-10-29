import * as cards from "./cards.ts";
import { startRun } from "./check.ts";
import { endRun, settle } from "./dead.ts";
import { readDocument } from "./document.ts";
import { holdWorktree } from "./landing.ts";
import { forOwner } from "./owner.ts";
import { type Context, writeRecord } from "./plan.ts";
import * as reports from "./reports.ts";

/**
 * `card stop` in Running or Dead: ends the run, its role and every process
 * the role started, discards the in-flight card's work and leaves the card
 * open, and records the plan Stopped, reporting the card it stopped at. The
 * record is written only once the run is gone, so nothing writes over it.
 */
export async function stop(context: Context): Promise<void> {
  const { deck, plan, command, args } = context;
  if (args.length > 0) throw new Error(`usage: ${command} stop`);
  const ended = await endRun(deck, plan);
  // The run wrote a state of its own, a bounce or its end, before the kill reached it, and that state stands.
  if (ended.state !== "Dead") {
    process.stdout.write(forOwner(`The plan \`${plan.slug}\`'s run had already reached ${ended.state}, so there was no run to stop.\n`));
    return;
  }
  const { plan: settled } = await settle(deck, { ...ended, state: "Stopped" });
  await reports.stopped({ ...context, plan: await writeRecord(settled, { state: "Stopped" }) });
}

/**
 * `card resume` in Stopped: carries the run on as `card approve` starts one,
 * from the first card not closed, which reruns from a fresh reconciler on the
 * worktree `card stop` left clean. No session waits after a stop, so an
 * answer on stdin would reach no one, and is refused.
 */
export async function resume({ plan, command, args }: Context): Promise<void> {
  if (args.length > 0) throw new Error(`usage: ${command} resume, with nothing on stdin`);
  if ((await Bun.stdin.text()).trim() !== "") {
    throw new Error(`no session waits for an answer after \`${command} stop\`, so \`${command} resume\` takes nothing on stdin`);
  }
  // `card approve` made the branch and the worktree, which is returned as it stands.
  const { fields } = readDocument(await Bun.file(plan.document).text());
  const cwd = process.cwd();
  const tree = await holdWorktree(plan.slug, fields.get("branch")!, cwd);
  const log = await startRun(plan, plan.harness!, tree, cwd);
  process.stdout.write(forOwner(`The plan \`${plan.slug}\`'s run is carried on, on ${plan.harness}, in ${tree}; its log is ${log}.\n`));
}

/**
 * `card amend` in Bounced or Stopped: the plan goes back to the Cards stage
 * to be amended, its cards kept. The in-flight card's work is discarded back
 * to what the state records, as a stop discards it, so the card reruns from a
 * fresh reconciler on a clean worktree once `card approve` carries the run
 * on, and the bounced session, if any, is left behind.
 */
export async function amend(context: Context): Promise<void> {
  const { deck, plan, command, args } = context;
  if (args.length > 0) throw new Error(`usage: ${command} amend`);
  const { plan: settled } = await settle(deck, plan);
  await cards.printPrompt({ ...context, plan: await writeRecord(settled, { state: "Cards", bounce: null }) });
}
