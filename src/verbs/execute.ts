import payload from "../../payload/execute.md" with { type: "text" };
import { requireDeck } from "../deck.ts";

export async function run(_args: string[], cwd: string): Promise<void> {
  await requireDeck(cwd);
  process.stdout.write(payload);
}
