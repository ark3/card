import { readCard } from "./cardfile.ts";
import { members } from "./cards.ts";
import { type Deck, locate } from "./deck.ts";
import { resumeCommand } from "./harness.ts";
import { forOwner } from "./owner.ts";
import type { Context } from "./plan.ts";

/** The card `id` as the owner's listings show one: its id and its headline. */
export async function named(deck: Deck, id: string): Promise<string> {
  return `${id}  ${(await readCard((await locate(deck, id))!.path)).headline}`;
}

/** The close of a report bare `card` makes: the commands open in the plan's state. */
function listed({ plan, command, openCommands }: Context): string {
  return `\nThe commands open while the plan is in ${plan.state}:\n\n${openCommands(plan, command)}`;
}

/** Bare `card` in Running: the card in flight with its role, and the cards the run has closed. */
export async function running({ deck, plan }: Context): Promise<void> {
  const { cycle } = plan;
  // No cycle yet, or the last one's commit has landed and the next card's cycle has not started.
  const now =
    cycle === null || cycle.commit !== undefined
      ? "between cards.\n"
      : `at this card, with the ${cycle.role}:\n\n${await named(deck, cycle.card)}\n`;
  const closed = (await members(deck, plan)).filter(({ landed }) => landed).map(({ id, card }) => `${id}  ${card.headline}\n`);
  const count = `${closed.length} of the plan's ${plan.cards.length} cards have closed`;
  process.stdout.write(
    forOwner(`The plan \`${plan.slug}\`'s run is ${now}\n${count}${closed.length > 0 ? `:\n\n${closed.join("")}` : ".\n"}`),
  );
}

/** Bare `card` in Stopped: the card the run stopped at, which resuming reruns from its reconciler, and the commands open. */
export async function stopped(context: Context): Promise<void> {
  const { deck, plan } = context;
  const { cycle } = plan;
  // No cycle yet, or the last one's commit has landed and the next card's cycle had not started.
  const at =
    cycle === null || cycle.commit !== undefined
      ? "between cards, and the next card not closed runs from a fresh reconciler when the run is resumed.\n"
      : `at this card, which reruns from a fresh reconciler when the run is resumed:\n\n${await named(deck, cycle.card)}\n`;
  process.stdout.write(forOwner(`The plan \`${plan.slug}\`'s run is stopped ${at}${listed(context)}`));
}

/**
 * Bare `card` in Bounced: the role that stopped the run, its cause, any gap
 * the final card found, any question or last revision feedback, how to
 * resume its session, and the commands open.
 */
export async function bounced(context: Context): Promise<void> {
  const { deck, plan } = context;
  const { role, session, cause, question, feedback, gap } = plan.bounce!;
  process.stdout.write(
    forOwner(
      `The plan \`${plan.slug}\`'s run bounced at this card, where the ${role} stopped it:\n\n${await named(deck, plan.cycle!.card)}\n\n` +
        `The cause recorded for it:\n\n${cause}\n\n` +
        (gap === undefined ? "" : `The gap the final card found:\n\n${gap}\n\n`) +
        (question === undefined ? "" : `The question it asks:\n\n${question}\n\n`) +
        (feedback === undefined ? "" : `The revision it last asked for:\n\n${feedback}\n\n`) +
        `To resume the ${role}'s session at a terminal, run this from the plan's worktree:\n\n  ${resumeCommand(session)}\n` +
        listed(context),
    ),
  );
}
