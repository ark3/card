import prompt from "../payload/settle.md" with { type: "text" };
import { readCard } from "./cardfile.ts";
import { settling } from "./cards.ts";
import type { Role } from "./cycle.ts";
import { endRun, settle } from "./dead.ts";
import { type Deck, locate } from "./deck.ts";
import { readDocument } from "./document.ts";
import { holdWorktree, removeWorktree, unremovable, worktreeOf } from "./landing.ts";
import { closeCard, recordSections, reopenCard } from "./operations.ts";
import { forOwner } from "./owner.ts";
import { fill, wrapPayload } from "./payload.ts";
import { type Context, listPlans, type Plan, removePlan, type Standing, standing, writeRecord } from "./plan.ts";
import { named } from "./reports.ts";

// What `closeCard` writes above a close note, from its heading.
const CLOSE_NOTE = "## Close note\n\n";

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
  const last = recordSections(text).findLast(({ heading }) => heading === "Close note")!;
  const guide = text.slice(last.index + CLOSE_NOTE.length);
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
  await finishJoin(deck, await writeRecord(plan, { pending: { verb: "join", id } }), id);
  console.log(
    `${id} has joined the plan \`${plan.slug}\`, whose final card is reopened; the plan is back in the Cards stage, which a fresh session takes up by running \`${command}\`: ${card.headline}`,
  );
}

/**
 * Finishes `card join <id>` at Ended from what its record holds: the final
 * card is reopened, then the plan is recorded in Cards with the finding
 * joined. Recorded last, so the plan is never in Cards with its final card
 * closed, where the next take-in would place the finding after it.
 */
export async function finishJoin(deck: Deck, plan: Plan, id: string): Promise<Plan> {
  await reopenCard(deck, plan.final!);
  return writeRecord(plan, { state: "Cards", joins: [...plan.joins, id], later: plan.later.filter((other) => other !== id), pending: null });
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
  await removePlan(deck, plan);
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
 * among them, stay waiting. The drop is recorded once the run is gone, which
 * alone writes the record while it lives, and before anything else is
 * written, so `finishDrop` can finish a drop that died partway.
 */
export async function drop({ deck, plan, command, args }: Context): Promise<void> {
  if (args.length > 0) throw new Error(`usage: ${command} drop`);
  const live = plan.state === "Running" || plan.state === "Dead";
  // Dead is read, never written, so the record says Stopped, as the run now is.
  const dropped: Plan = live ? { ...(await endRun(deck, plan)), state: "Stopped" } : plan;
  const settles = live || plan.state === "Bounced";
  // What can refuse is met here, before anything is written. A settling
  // needs the worktree, which git can refuse to give back, so it is held
  // now. One not settled goes as it stands, not forced, as `card finish`
  // does not force it, so work the owner left in it, which is theirs to
  // settle, refuses the drop.
  if (dropped.run !== null) {
    const branch = await branchOf(plan);
    const tree = settles ? await holdWorktree(plan.slug, branch, process.cwd()) : await worktreeOf(plan.slug, branch, process.cwd());
    const lost = tree === null || settles ? "" : await unremovable(tree);
    if (lost !== "") {
      throw new Error(`the plan is not dropped, since git would not remove its worktree: it holds modified or untracked files:\n${lost.trimEnd()}`);
    }
  }
  const { removed, closed } = await finishDrop(deck, await writeRecord(dropped, { pending: { verb: "drop", settles } }), settles);
  const gone = removed === null ? "" : `: its worktree ${removed.tree} is removed, and its branch \`${removed.branch}\` is kept`;
  const cards =
    closed.length > 0
      ? `These cards of the plan are closed declined:\n\n${(await Promise.all(closed.map(async (id) => `${await named(deck, id)}\n`))).join("")}`
      : "No card of the plan was left open to close.\n";
  process.stdout.write(forOwner(`The plan \`${plan.slug}\` is dropped${gone}.\n\n${cards}`));
}

/**
 * Finishes `card drop` from what its record holds: the card in flight is
 * settled where `settles` says, its work discarded, the worktree removed,
 * every card of the plan not closed closed declined, and last the plan's
 * directory removed, its record with it. Each step is safe to run again: a
 * worktree a settling needs is held again where it is gone, so the
 * settling always has a tree to run in, one not settled is removed only
 * where it stands, and a card already closed is passed over. Returns the
 * worktree removed, if there was one, and the cards closed.
 */
export async function finishDrop(
  deck: Deck,
  plan: Plan,
  settles: boolean,
): Promise<{ removed: { tree: string; branch: string } | null; closed: string[] }> {
  let dropped = plan;
  let removed = null;
  // The first `card approve` made the branch and the worktree, and nothing before it does.
  if (dropped.run !== null) {
    const branch = await branchOf(dropped);
    const tree = settles ? await holdWorktree(dropped.slug, branch, process.cwd()) : await worktreeOf(dropped.slug, branch, process.cwd());
    if (tree !== null) {
      if (settles) dropped = (await settle(deck, dropped)).plan;
      // Forced: work the owner left in the tree refused the drop before it
      // was recorded, so what the tree holds now was written after the
      // owner decided, and goes with the plan. A lock, the owner's own
      // explicit act, still refuses.
      try {
        await removeWorktree(tree, { force: true });
      } catch (error) {
        throw new Error(
          `the drop of the plan \`${plan.slug}\` is recorded, but git would not remove its worktree: ${(error as Error).message}\nOnce git can remove it, the next run of card finishes the drop.`,
        );
      }
      removed = { tree, branch };
    }
  }
  const note = `Dropped with the plan \`${plan.slug}\`, which the owner gave up.`;
  const closed: string[] = [];
  for (const id of [...dropped.cards, ...dropped.joins]) {
    if ((await locate(deck, id))!.closed) continue;
    await closeCard(deck, id, "declined", note);
    closed.push(id);
  }
  await removePlan(deck, plan);
  return { removed, closed };
}
