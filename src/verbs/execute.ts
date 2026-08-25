import payload from "../../payload/execute.md" with { type: "text" };
import { requireDeck } from "../deck.ts";
import { renderPayload } from "../payload.ts";

export async function run(_args: string[], cwd: string): Promise<void> {
  const deck = await requireDeck(cwd);
  process.stdout.write(renderPayload(payload, deck.public));
}
