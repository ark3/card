import { readCard } from "./cardfile.ts";
import { type Deck, locate } from "./deck.ts";
import { readDocument } from "./document.ts";
import { resumeCommand } from "./harness.ts";
import { holdWorktree } from "./landing.ts";
import { forOwner } from "./owner.ts";
import type { Context } from "./plan.ts";

/** The card `id` as the owner's listings show one: its id and its headline. */
async function named(deck: Deck, id: string): Promise<string> {
  return `${id}  ${(await readCard((await locate(deck, id))!.path)).headline}`;
}

/** Bare `card` in Running: the card in flight with its role, and the cards the run has closed. */
export async function running({ deck, plan }: Context): Promise<void> {
  const { cycle } = plan;
  // No cycle yet, or the last one's commit has landed and the next card's cycle has not started.
  const now =
    cycle === null || cycle.commit !== undefined
      ? "between cards.\n"
      : `at this card, with the ${cycle.role}:\n\n${await named(deck, cycle.card)}\n`;
  const closed = await Promise.all(plan.landed.map(async ({ card }) => `${await named(deck, card)}\n`));
  const count = `${closed.length} of the plan's ${plan.cards.length} cards have closed`;
  process.stdout.write(
    forOwner(`The plan \`${plan.slug}\`'s run is ${now}\n${count}${closed.length > 0 ? `:\n\n${closed.join("")}` : ".\n"}`),
  );
}

/** Bare `card` in Bounced: the role that stopped the run, its cause and any question, and how to resume its session. */
export async function bounced({ deck, plan }: Context): Promise<void> {
  const { role, session, cause, question } = plan.bounce!;
  process.stdout.write(
    forOwner(
      `The plan \`${plan.slug}\`'s run bounced at this card, where the ${role} stopped it:\n\n${await named(deck, plan.cycle!.card)}\n\n` +
        `The cause recorded for it:\n\n${cause}\n\n` +
        (question === undefined ? "" : `The question it asks:\n\n${question}\n\n`) +
        `To resume the ${role}'s session at a terminal, run this from the plan's worktree:\n\n  ${resumeCommand(session)}\n`,
    ),
  );
}

// What `closeCard` writes above a close note.
const CLOSE_NOTE = "\n## Close note\n\n";

/** Bare `card` in Ended: the plan's branch and worktree, and the final card's close note as the owner's guide. */
export async function ended({ deck, plan }: Context): Promise<void> {
  const final = plan.final!;
  // The last close note runs to the end of the card, since the close appended it.
  const text = await Bun.file((await locate(deck, final))!.path).text();
  const guide = text.slice(text.lastIndexOf(CLOSE_NOTE) + CLOSE_NOTE.length);
  const branch = readDocument(await Bun.file(plan.document).text()).fields.get("branch")!;
  // `card approve` made the worktree, which is returned as it stands.
  const tree = await holdWorktree(plan.slug, branch, process.cwd());
  process.stdout.write(
    forOwner(
      `The plan \`${plan.slug}\`'s run has ended, with every card closed.\n\n` +
        `Its branch is \`${branch}\`, checked out in the worktree ${tree}.\n\n` +
        `The final card, ${await named(deck, final)}, closed with this note, which is the guide to the plan's work:\n\n${guide}`,
    ),
  );
}
