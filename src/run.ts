/**
 * A plan's run, which `card approve` starts detached as
 * `run.ts <slug> <worktree>`, its output going to the run's log. It runs the
 * plan's cards not yet closed, in the plan's order, each through one cycle in
 * the worktree, and writes the plan's state after every card, so a run that
 * dies leaves the last card closed recorded. While it lives, it alone writes
 * the plan's state. `card resume` starts it with `--resume` after them and the
 * resume prompt on stdin, and its first card's cycle then carries on from the
 * step that bounced it rather than starting afresh.
 */
import { type CycleEnd, resumeCard, runCard } from "./cycle.ts";
import { locate, requireDeck } from "./deck.ts";
import { listPlans, writeRecord } from "./plan.ts";

const [slug, tree, flag] = process.argv.slice(2) as [string, string, string?];
// The verb that starts the run closes stdin once its record names this
// process, after writing the resume prompt to it where there is one.
const input = await Bun.stdin.text();
let resuming = flag === "--resume" ? input : null;
const deck = await requireDeck(process.cwd());
let plan = (await listPlans(deck)).find((listed) => listed.slug === slug)!;
if (plan.run?.pid !== process.pid) {
  console.error(`card: the plan \`${slug}\` records no run as process ${process.pid}, so this one starts nothing`);
  process.exit(1);
}

for (const id of plan.cards) {
  // A card closed done has landed, and one closed any other way left the order.
  if ((await locate(deck, id))?.closed) continue;
  let ended: CycleEnd;
  try {
    // The bounced card is the first not closed, since every card before it closed done.
    ended =
      resuming === null ? await runCard(deck, plan, id, tree, plan.harness!) : await resumeCard(deck, plan, tree, plan.harness!, resuming);
  } catch (error) {
    // An error no role's failure is, such as a hook refusing the commit, stops
    // the run as a role that failed does, rather than leaving it to read as
    // Dead and rerun into the same error. The record is as the cycle last
    // wrote it, which `plan` predates.
    console.error(error);
    const cause = (error as Error).message;
    const current = (await listPlans(deck)).find((listed) => listed.slug === slug)!;
    if (resuming === null && Bun.deepEquals(current.cycle, plan.cycle)) {
      // Thrown before the card's cycle was recorded, so no session of it has
      // anything to answer, and the card reruns from a fresh reconciler.
      await writeRecord(current, { state: "Stopped" });
      console.log(`The run stopped before ${id}'s cycle started: ${cause}`);
      process.exit(0);
    }
    const { role, sessions } = current.cycle!;
    ended = { plan: current, outcome: "stopped", role, session: { harness: plan.harness!, id: sessions[role]!, dir: tree }, cause };
  }
  resuming = null;
  plan = ended.plan;
  if (ended.outcome === "stopped") {
    const { role, session, cause, question, feedback, gap } = ended;
    await writeRecord(plan, { state: "Bounced", bounce: { role, session, cause, question, feedback, gap } });
    console.log(`The run bounced at ${id}: the ${role} stopped it: ${cause}`);
    if (question !== undefined) console.log(`It asks the owner: ${question}`);
    process.exit(0);
  }
  plan = await writeRecord(plan, { landed: [...plan.landed, { card: id, commit: ended.sha }] });
  console.log(`${id} landed as ${ended.sha}.`);
}
await writeRecord(plan, { state: "Ended" });
console.log("The run ended after the plan's last card.");
