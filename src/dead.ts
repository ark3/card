import { startRun } from "./check.ts";
import { locate } from "./deck.ts";
import { readDocument } from "./document.ts";
import { discard, holdWorktree } from "./landing.ts";
import { closeCard } from "./operations.ts";
import { bootId, type Context, writeRecord } from "./plan.ts";

/**
 * Bare `card` in Dead: carries the dead run on. It ends what is left of the
 * run, settles the card that was in flight from what the state records, and
 * starts a new run from the last card closed, as `card approve` starts one.
 */
export async function carryOn({ deck, plan }: Context): Promise<void> {
  const { pid, boot } = plan.run!;
  // A run that died alone leaves its role, and the role's own processes,
  // still writing in the worktree, all in the group the run led. After a
  // reboot the pid names nothing of the run's.
  if (boot === (await bootId())) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  // Dead is read, never written, so every write below records Running.
  plan = { ...plan, state: "Running" };

  // `card approve` made the branch and the worktree, which is returned as it stands.
  const { fields } = readDocument(await Bun.file(plan.document).text());
  const cwd = process.cwd();
  const tree = await holdWorktree(plan.slug, fields.get("branch")!, cwd);

  // Back to the last commit the state records, so a commit no record names,
  // the tool's own made before its record or a role's, goes with the work of
  // the card in flight, which reruns from the start of its cycle.
  const { cycle } = plan;
  await discard(tree, cycle?.commit ?? cycle?.base);
  if (cycle?.commit !== undefined && !plan.landed.some(({ card }) => card === cycle.card)) {
    // Its commit landed, so it closes from the reviewer's note, never committed again.
    if (!(await locate(deck, cycle.card))!.closed) await closeCard(deck, cycle.card, "done", cycle.note!);
    plan = await writeRecord(plan, { landed: [...plan.landed, { card: cycle.card, commit: cycle.commit }] });
  }

  const log = await startRun(plan, plan.harness!, tree, cwd);
  console.log(`The plan \`${plan.slug}\`'s run had died; it is carried on, on ${plan.harness}, in ${tree}; its log is ${log}.`);
}
