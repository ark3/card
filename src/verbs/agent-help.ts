import payload from "../../payload/agent-help.md" with { type: "text" };
import { wrapPayload } from "../payload.ts";

export async function run(args: string[], _cwd: string): Promise<void> {
  if (args.length > 0) throw new Error("usage: deck agent-help");
  // Conventions, not the state of any deck, so this prints where there is none.
  process.stdout.write(wrapPayload("deck agent-help", payload));
}
