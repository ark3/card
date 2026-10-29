import prompt from "../payload/check.md" with { type: "text" };
import * as cards from "./cards.ts";
import { fill, wrapPayload } from "./payload.ts";
import { type Context, writeRecord } from "./plan.ts";

/** The Check stage's prompt, which bare `card` prints for as long as the stage lasts. */
export async function printPrompt({ deck, plan, command }: Context): Promise<void> {
  // The Cards stage's `card done` refuses without a final card, so the list is never empty here.
  const values = {
    CARD: command,
    PLAN_DOCUMENT: plan.document,
    PLAN_CARDS: (await cards.planCards(deck, plan)).join("").trimEnd(),
  };
  process.stdout.write(wrapPayload(command, fill(prompt, values)));
}

/**
 * `card amend` in the Check stage: the check needs a card added or moved, so
 * the plan goes back to Cards, its cards kept, and that stage's prompt is
 * printed for the session to draft under.
 */
export async function amend(context: Context): Promise<void> {
  const { plan, command, args } = context;
  if (args.length > 0) throw new Error(`usage: ${command} amend`);
  await cards.printPrompt({ ...context, plan: await writeRecord(plan, { state: "Cards" }) });
}
