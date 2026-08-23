import { requireDeck } from "../deck.ts";

export async function run(args: string[], cwd: string): Promise<void> {
  // The `--` is documented and normally present, but bun eats a `--` in some
  // argv positions, so its absence is not worth failing over.
  const command = args[0] === "--" ? args.slice(1) : args;
  if (command.length === 0) throw new Error("usage: card cmd -- <command> [args...]");

  const deck = await requireDeck(cwd);

  let exited: number;
  try {
    // Inherited, not captured: a command that paginates, colours by tty or
    // streams has to behave as it would if it had been run in the deck by hand.
    const proc = Bun.spawn(command, {
      cwd: deck.deckDir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    exited = await proc.exited;
  } catch (error) {
    console.error(`card: ${error instanceof Error ? error.message : String(error)}`);
    // What a shell reports for a command it could not run.
    exited = 127;
  }

  // Not a throw: `card` maps any throw to exit 1, which would swallow the
  // command's own status, and passing that status through is the whole point.
  process.exit(exited);
}
