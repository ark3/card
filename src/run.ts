/**
 * A plan's run, which `card approve` starts detached as
 * `run.ts <slug> <worktree>`, its output going to the run's log. It runs the
 * plan's cards not yet closed, in the plan's order, each through one cycle in
 * the worktree, and writes the plan's state after every card, so a run that
 * dies leaves the last card closed recorded. While it lives, it alone writes
 * the plan's state.
 */
import { runCard } from "./cycle.ts";
import { locate, requireDeck } from "./deck.ts";
import { listPlans, writeRecord } from "./plan.ts";

const [slug, tree] = process.argv.slice(2) as [string, string];
// `card approve` closes stdin once its record names this process.
await Bun.stdin.text();
const deck = await requireDeck(process.cwd());
let plan = (await listPlans(deck)).find((listed) => listed.slug === slug)!;
if (plan.run?.pid !== process.pid) {
  console.error(`card: the plan \`${slug}\` records no run as process ${process.pid}, so this one starts nothing`);
  process.exit(1);
}

for (const id of plan.cards) {
  // A card closed done has landed, and one closed any other way left the order.
  if ((await locate(deck, id))?.closed) continue;
  const ended = await runCard(deck, plan, id, tree, plan.harness!);
  plan = ended.plan;
  if (ended.outcome === "stopped") {
    const { role, session, cause, question } = ended;
    await writeRecord(plan, { state: "Bounced", bounce: { role, session, cause, question } });
    console.log(`The run bounced at ${id}: the ${role} stopped it: ${cause}`);
    if (question !== undefined) console.log(`It asks the owner: ${question}`);
    process.exit(0);
  }
  plan = await writeRecord(plan, { landed: [...plan.landed, { card: id, commit: ended.sha }] });
  console.log(`${id} landed as ${ended.sha}.`);
}
await writeRecord(plan, { state: "Ended" });
console.log("The run ended after the plan's last card.");
