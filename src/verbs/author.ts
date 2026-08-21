import payload from "../../payload/author.md" with { type: "text" };
import { requireDeck } from "../deck.ts";

export async function run(_args: string[], cwd: string): Promise<void> {
  // Every line of the procedure is an instruction to run a verb against a deck.
  await requireDeck(cwd);
  process.stdout.write(payload);
}
