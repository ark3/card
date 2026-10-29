import { requireDeck } from "../deck.ts";
import { refuseFromLinkedWorktree } from "../git.ts";
import { fileCard } from "../operations.ts";

const USAGE = "usage: deck new '<headline>' [--label L]... [--blocked-by <id>]..., body on stdin";

export async function run(args: string[], cwd: string): Promise<void> {
  const labels: string[] = [];
  const blockedBy: string[] = [];
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--label" || arg === "--blocked-by") {
      const value = args[++i];
      if (value === undefined) throw new Error(`${arg} needs a value\n${USAGE}`);
      (arg === "--label" ? labels : blockedBy).push(value);
    } else if (arg.startsWith("--")) {
      throw new Error(`no such option as \`${arg}\`\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  const headline = positional[0]?.trim();
  if (headline === undefined || positional.length > 1) throw new Error(USAGE);
  if (headline === "") throw new Error("a card needs a headline");
  if (headline.includes("\n")) throw new Error("a headline is one line and never wraps");

  await refuseFromLinkedWorktree("new", cwd);

  const deck = await requireDeck(cwd);

  const body = await Bun.stdin.text();
  if (body.trim() === "") {
    throw new Error("a card needs a body on stdin; a headline alone is the skeleton this verb replaces");
  }

  console.log(await fileCard(deck, { labels, blockedBy, headline, body }));
}
