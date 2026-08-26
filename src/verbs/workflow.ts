import payload from "../../payload/workflow.md" with { type: "text" };
import { requireDeck } from "../deck.ts";
import { renderPayload, wrapPayload } from "../payload.ts";

export async function run(_args: string[], cwd: string): Promise<void> {
  // The chapter states the deck's deltas from an ordinary tracker, so it only
  // makes sense against a deck, rendered for that deck's privacy.
  const deck = await requireDeck(cwd);
  process.stdout.write(wrapPayload("workflow", renderPayload(payload, deck.public)));
}
