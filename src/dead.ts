import { readdir, readFile } from "node:fs/promises";
import { startRun } from "./check.ts";
import { type Deck, locate } from "./deck.ts";
import { readDocument } from "./document.ts";
import { discard, holdWorktree } from "./landing.ts";
import { closeCard } from "./operations.ts";
import { forOwner } from "./owner.ts";
import { bootId, type Context, listPlans, type Plan, RUN_MARK, runMark, writeRecord } from "./plan.ts";

/** Sends `signal` to `pid`, a group if negative, and returns whether it named anything. */
function kill(pid: number, signal: "SIGKILL" | 0): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return false;
  }
}

/**
 * Every process whose environment holds `entry`, but this one, which holds it
 * when a role ran it. An environment that cannot be read is no match: a
 * process that has gone, a zombie, which runs nothing, or another user's,
 * which this process could not kill.
 */
async function marked(entry: string): Promise<number[]> {
  const pids: number[] = [];
  for (const name of await readdir("/proc")) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    try {
      if ((await readFile(`/proc/${pid}/environ`, "utf8")).split("\0").includes(entry)) pids.push(pid);
    } catch {}
  }
  return pids;
}

/**
 * Ends the plan's run and what is left of it: a run that died alone leaves
 * its role, and the role's own processes, still writing in the worktree. The
 * run and its roles are in the group the run led, but both harnesses start
 * each command a role runs in a session of its own, and a command can leave
 * what it starts orphaned at once, so neither the group nor the run's
 * descendants hold those processes; their environment holds RUN_MARK.
 * Returns once the group is gone and no marked process still runs, with the
 * plan as its state file then stands, which nothing writes again, since while
 * the run lives it alone writes it. After a reboot the pid names nothing of
 * the run's.
 */
export async function endRun(deck: Deck, plan: Plan): Promise<Plan> {
  const { pid, boot } = plan.run!;
  if (boot === (await bootId())) {
    kill(-pid, "SIGKILL");
    // A signal is sent, not yet acted on, so a process can still finish a
    // write, or start another, which inherits the mark; the group is gone once
    // its last process has been reaped.
    const entry = `${RUN_MARK}=${runMark(plan.run!)}`;
    for (let left = await marked(entry); left.length > 0 || kill(-pid, 0); left = await marked(entry)) {
      for (const each of left) kill(each, "SIGKILL");
      await Bun.sleep(10);
    }
  }
  return (await listPlans(deck)).find(({ slug }) => slug === plan.slug)!;
}

/**
 * Settles the card that was in flight when the run ended, from what the state
 * records, and returns the plan, with any record written under the state it
 * holds, and the worktree it holds.
 */
export async function settle(deck: Deck, plan: Plan): Promise<{ plan: Plan; tree: string }> {
  // `card approve` made the branch and the worktree, which is returned as it stands.
  const { fields } = readDocument(await Bun.file(plan.document).text());
  const tree = await holdWorktree(plan.slug, fields.get("branch")!, process.cwd());

  // Back to the last commit the state records, so a commit no record names,
  // the tool's own made before its record or a role's, goes with the work of
  // the card in flight, which reruns from the start of its cycle.
  const { cycle } = plan;
  await discard(tree, cycle?.commit ?? cycle?.base);
  // By its commit, since a final card reopened by a join has landed once already.
  if (cycle?.commit !== undefined && !plan.landed.some(({ commit }) => commit === cycle.commit)) {
    // Its commit landed, so it closes from the reviewer's note, never committed again.
    if (!(await locate(deck, cycle.card))!.closed) await closeCard(deck, cycle.card, "done", cycle.note!);
    plan = await writeRecord(plan, { landed: [...plan.landed, { card: cycle.card, commit: cycle.commit }] });
  }
  return { plan, tree };
}

/**
 * Bare `card` in Dead: carries the dead run on. It ends what is left of the
 * run, settles the card that was in flight from what the state records, and
 * starts a new run from the last card closed, as `card approve` starts one.
 */
export async function carryOn({ deck, plan }: Context): Promise<void> {
  // Dead is read, never written, so every write below records Running.
  const { plan: settled, tree } = await settle(deck, { ...(await endRun(deck, plan)), state: "Running" });
  const log = await startRun(settled, settled.harness!, tree, process.cwd());
  process.stdout.write(forOwner(`The plan \`${settled.slug}\`'s run had died; it is carried on, on ${settled.harness}, in ${tree}; its log is ${log}.\n`));
}
