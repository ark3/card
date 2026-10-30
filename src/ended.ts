import { rm } from "node:fs/promises";
import prompt from "../payload/settle.md" with { type: "text" };
import { readCard } from "./cardfile.ts";
import { settling } from "./cards.ts";
import type { Role } from "./cycle.ts";
import { endRun, settle } from "./dead.ts";
import { type Deck, locate } from "./deck.ts";
import { readDocument } from "./document.ts";
import { holdWorktree, removeWorktree } from "./landing.ts";
import { closeCard, reopenCard } from "./operations.ts";
import { forOwner } from "./owner.ts";
import { fill, wrapPayload } from "./payload.ts";
import { type Context, listPlans, type Plan, type Standing, standing, writeRecord } from "./plan.ts";
import { named } from "./reports.ts";

// What `closeCard` writes above a close note.
const CLOSE_NOTE = "\n## Close note\n\n";

/**
 * Each finding the run filed, with its headline, how the owner settled it,
 * null while it is unsettled, and the commands open on it, as `standing`
 * has them for this plan.
 */
async function findings(deck: Deck, plan: Plan): Promise<({ id: string; role: Role; headline: string } & Standing)[]> {
  const plans = await listPlans(deck);
  return Promise.all(
    plan.findings.map(async ({ id, role }) => {
      const card = await readCard((await locate(deck, id))!.path);
      return { id, role, headline: card.headline, ...standing(id, card, plans, plan) };
    }),
  );
}

/** The plan's branch, which `card done` in the Document stage refused a document without. */
async function branchOf(plan: Plan): Promise<string> {
  return readDocument(await Bun.file(plan.document).text()).fields.get("branch")!;
}

/**
 * Bare `card` in Ended: for the owner, the plan's branch and worktree, the
 * findings the run filed, and the final card's close note as the guide to
 * the plan's work, then the settling prompt. An unsettled finding is listed
 * with the commands that settle it, and a settled one with how it was, and
 * no command, since the owner has decided it already, but for one awaiting
 * its key, which is listed with the command that records it.
 */
export async function printPrompt({ deck, plan, command }: Context): Promise<void> {
  const final = plan.final!;
  // The last close note runs to the end of the card, since the close appended it.
  const text = await Bun.file((await locate(deck, final))!.path).text();
  const guide = text.slice(text.lastIndexOf(CLOSE_NOTE) + CLOSE_NOTE.length);
  const branch = await branchOf(plan);
  // `card approve` made the worktree, which is returned as it stands.
  const tree = await holdWorktree(plan.slug, branch, process.cwd());
  const listed = (await findings(deck, plan)).map(
    ({ id, role, headline, settled, commands }) =>
      `${id}  ${headline}\n  filed by the ${role}${settled === null ? "" : `, ${settled}`}\n${commands.map((words) => `  ${command} ${words}\n`).join("")}`,
  );
  const filed =
    listed.length > 0
      ? `The run filed these findings, each a waiting card until the owner settles it:\n\n${listed.join("\n")}`
      : "The run filed no findings.\n";
  // The guide goes last, so that headings in it head nothing of the tool's.
  process.stdout.write(
    forOwner(
      `The plan \`${plan.slug}\`'s run has ended, with every card closed.\n\n` +
        `Its branch is \`${branch}\`, checked out in the worktree ${tree}.\n\n` +
        `${filed}\nOnce every finding is settled, this ends the plan, removing the worktree and keeping the branch:\n\n  ${command} finish\n\n` +
        `The final card, ${await named(deck, final)}, closed with this note, which is the guide to the plan's work:\n\n${guide}`,
    ),
  );
  process.stdout.write(wrapPayload(command, fill(prompt, { CARD: command, PLAN_DOCUMENT: plan.document })));
}

/**
 * `card join <id>` in Ended: the owner takes a finding into the plan at its
 * end. The final card is reopened in place, so from here the plan is not
 * done until it closes done again, and it is the first card not closed done,
 * which the next take-in puts the finding ahead of. The plan goes back to the
 * Cards stage, where a fresh session rewrites the finding as a card.
 */
export async function join(context: Context): Promise<void> {
  const { deck, plan, command } = context;
  const { id, card } = await settling(context, "join");
  const final = plan.final!;
  // Reopened first and recorded second, so a death between the two leaves
  // the plan in Ended with its final card open, which every verb's dispatch
  // puts back closed done before it acts, a retried join among them.
  // Recorded first instead, a death would leave the plan in Cards with its
  // final card closed, and the next take-in would place the finding after it.
  await reopenCard(deck, final);
  await writeRecord(plan, { state: "Cards", joins: [...plan.joins, id], later: plan.later.filter((other) => other !== id) });
  console.log(
    `${id} has joined the plan \`${plan.slug}\`, whose final card is reopened; the plan is back in the Cards stage, which a fresh session takes up by running \`${command}\`: ${card.headline}`,
  );
}

/**
 * `card finish` in Ended: the owner's word that the plan is over. Refused
 * while a finding is unsettled; otherwise the worktree goes, the branch stays
 * for the owner to land, and the plan's directory goes with its record, so no
 * listing finds the plan and its slug is free for the next.
 */
export async function finish({ deck, plan, command, args }: Context): Promise<void> {
  if (args.length > 0) throw new Error(`usage: ${command} finish`);
  const unsettled = (await findings(deck, plan)).filter(({ settled }) => settled === null);
  if (unsettled.length > 0) {
    const lines = unsettled.map(({ id, headline }) => `  ${id}  ${headline}`).join("\n");
    throw new Error(`\`${command} finish\` is refused while a finding is unsettled, and these are:\n${lines}`);
  }
  const branch = await branchOf(plan);
  const tree = await holdWorktree(plan.slug, branch, process.cwd());
  // Not forced: work the owner left in the tree while trying the plan is
  // theirs, and git's refusal to remove it is the owner's to settle.
  try {
    await removeWorktree(tree);
  } catch (error) {
    throw new Error(`the plan is not finished, since git would not remove its worktree: ${(error as Error).message}`);
  }
  await rm(plan.dir, { recursive: true });
  process.stdout.write(
    forOwner(`The plan \`${plan.slug}\` is finished: its worktree ${tree} is removed, and its branch \`${branch}\` is kept, for the owner to land.\n`),
  );
}

/**
 * `card drop`, in any state: the owner gives the plan up. A live run ends,
 * with its role and every process the role started that still runs, as
 * `card stop` ends one, and a card the run left in flight is settled, its
 * work discarded.
 * Then the worktree goes and the branch stays, with the plan's landed
 * commits; every card of the plan not closed, a joined card not yet taken
 * in among them, closes declined under one note; and the plan's directory
 * goes, as `card finish` removes it. Waiting cards, the run's findings
 * among them, stay waiting.
 */
export async function drop({ deck, plan, command, args }: Context): Promise<void> {
  if (args.length > 0) throw new Error(`usage: ${command} drop`);
  const live = plan.state === "Running" || plan.state === "Dead";
  // Dead is read, never written, so a record the settling writes says Stopped, as the run now is.
  let dropped: Plan = live ? { ...(await endRun(deck, plan)), state: "Stopped" } : plan;
  let gone = "";
  // The first `card approve` made the branch and the worktree, and nothing before it does.
  if (dropped.run !== null) {
    if (live || plan.state === "Bounced") dropped = (await settle(deck, dropped)).plan;
    const branch = await branchOf(dropped);
    const tree = await holdWorktree(dropped.slug, branch, process.cwd());
    // Not forced, as `card finish` does not force it: the run's work is
    // discarded above, so what git would lose is work the owner left in the
    // tree, which is theirs to settle.
    try {
      await removeWorktree(tree);
    } catch (error) {
      throw new Error(`the plan is not dropped, since git would not remove its worktree: ${(error as Error).message}`);
    }
    gone = `: its worktree ${tree} is removed, and its branch \`${branch}\` is kept`;
  }
  const note = `Dropped with the plan \`${plan.slug}\`, which the owner gave up.`;
  const closed: string[] = [];
  for (const id of [...dropped.cards, ...dropped.joins]) {
    if ((await locate(deck, id))!.closed) continue;
    await closeCard(deck, id, "declined", note);
    closed.push(`${await named(deck, id)}\n`);
  }
  await rm(plan.dir, { recursive: true });
  const cards = closed.length > 0 ? `These cards of the plan are closed declined:\n\n${closed.join("")}` : "No card of the plan was left open to close.\n";
  process.stdout.write(forOwner(`The plan \`${plan.slug}\` is dropped${gone}.\n\n${cards}`));
}
