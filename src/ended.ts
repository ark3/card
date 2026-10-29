import { rm } from "node:fs/promises";
import prompt from "../payload/settle.md" with { type: "text" };
import { readCard } from "./cardfile.ts";
import type { Role } from "./cycle.ts";
import { type Deck, locate } from "./deck.ts";
import { readDocument } from "./document.ts";
import { holdWorktree, removeWorktree } from "./landing.ts";
import { forOwner } from "./owner.ts";
import { fill, wrapPayload } from "./payload.ts";
import type { Context, Plan } from "./plan.ts";
import { named } from "./reports.ts";

// What `closeCard` writes above a close note.
const CLOSE_NOTE = "\n## Close note\n\n";

/**
 * Each finding the run filed, with its headline and how the owner settled it:
 * left for later, or closed with its outcome; null while it is unsettled.
 */
async function findings(deck: Deck, plan: Plan): Promise<{ id: string; role: Role; headline: string; settled: string | null }[]> {
  return Promise.all(
    plan.findings.map(async ({ id, role }) => {
      const found = (await locate(deck, id))!;
      const card = await readCard(found.path);
      const settled = found.closed ? `closed ${card.closed}` : plan.later.includes(id) ? "left for later" : null;
      return { id, role, headline: card.headline, settled };
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
 * no command, since the owner has decided it already.
 */
export async function printPrompt({ deck, plan, command }: Context): Promise<void> {
  const final = plan.final!;
  // The last close note runs to the end of the card, since the close appended it.
  const text = await Bun.file((await locate(deck, final))!.path).text();
  const guide = text.slice(text.lastIndexOf(CLOSE_NOTE) + CLOSE_NOTE.length);
  const branch = await branchOf(plan);
  // `card approve` made the worktree, which is returned as it stands.
  const tree = await holdWorktree(plan.slug, branch, process.cwd());
  const listed = (await findings(deck, plan)).map(({ id, role, headline, settled }) =>
    settled === null
      ? `${id}  ${headline}\n  filed by the ${role}\n  ${command} later ${id}\n  ${command} decline ${id}\n`
      : `${id}  ${headline}\n  filed by the ${role}, ${settled}\n`,
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
