import { startRun } from "./check.ts";
import { type Deck, locate } from "./deck.ts";
import { readDocument } from "./document.ts";
import { discard, holdWorktree } from "./landing.ts";
import { closeCard } from "./operations.ts";
import { forOwner } from "./owner.ts";
import { bootId, type Context, listPlans, type Plan, writeRecord } from "./plan.ts";

/**
 * Ends the plan's run and what is left of it: a run that died alone leaves
 * its role, and the role's own processes, still writing in the worktree, all
 * in the group the run led. Returns once the group is gone, with the plan as
 * its state file then stands, which nothing writes again, since while the run
 * lives it alone writes it. After a reboot the pid names nothing of the run's.
 */
export async function endRun(deck: Deck, plan: Plan): Promise<Plan> {
  const { pid, boot } = plan.run!;
  if (boot === (await bootId())) {
    try {
      process.kill(-pid, "SIGKILL");
      // The signal is sent, not yet acted on, so a process can still finish a
      // write; the group is gone once its last process has been reaped.
      for (;;) {
        await Bun.sleep(10);
        process.kill(-pid, 0);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
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
