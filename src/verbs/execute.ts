import payload from "../../payload/execute.md" with { type: "text" };
import { requireDeck } from "../deck.ts";
import { renderPayload, wrapPayload } from "../payload.ts";

export async function run(_args: string[], cwd: string): Promise<void> {
  const deck = await requireDeck(cwd);
  process.stdout.write(wrapPayload("execute", renderPayload(payload, deck.public)));
}
