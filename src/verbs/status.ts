import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import payload from "../../payload/status.md" with { type: "text" };
import { resolveDeck } from "../deck.ts";

const PROBE = ".card-sandbox-probe";

/**
 * Null when the sandbox is on, otherwise why the session has to stop. `$HOME`
 * always exists and is read-only whenever the sandbox is on, so a refused
 * write is the pass; anything else, including a probe that never lands, is
 * not one. The verdict is all card reports: describing the sandbox's mounts
 * would drift from the tool that makes them.
 */
export async function probeSandbox(): Promise<string | null> {
  const home = process.env.HOME;
  if (home === undefined || home === "") {
    return "the sandbox cannot be verified: HOME is unset, so there is nowhere to probe. Stop, and tell the owner.";
  }
  const probe = path.join(home, PROBE);
  try {
    await writeFile(probe, "");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EACCES") return null;
    return `the sandbox cannot be verified: writing ${probe} failed with ${code ?? String(error)}. Stop, and tell the owner.`;
  }
  await rm(probe, { force: true });
  return `the sandbox is off: ${probe} was writable. Stop, and tell the owner.`;
}

/** Null when the directory is not there, which a broken redirect can do. */
async function count(dir: string): Promise<number | null> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith(".md")).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function run(_args: string[], cwd: string): Promise<void> {
  const warning = await probeSandbox();
  if (warning !== null) throw new Error(warning);

  const deck = await resolveDeck(cwd);
  if (deck === null) {
    // Not one word about cards where there is no deck: that is what makes this
    // command safe to run unconditionally in a project that never adopts it.
    console.log("No card deck for this project.");
    return;
  }

  const [open, closed] = await Promise.all([count(deck.openDir), count(deck.closedDir)]);
  // A deck missing a directory is broken, but this is the only command that
  // tells a session the workflow exists, so it says so and carries on.
  for (const [dir, found] of [[deck.openDir, open], [deck.closedDir, closed]] as const) {
    if (found === null) console.error(`card: ${dir} is not there, so this deck is incomplete`);
  }
  // CARD_ROOT beats the structural resolution silently, and only ever means
  // "somewhere else entirely", so the line that names the deck says so.
  const viaRoot = (process.env.CARD_ROOT ?? "") !== "";
  const values: Record<string, string> = {
    DECK: viaRoot ? `${deck.deckDir} (from CARD_ROOT)` : deck.deckDir,
    OPEN: open === null ? "?" : String(open),
    CLOSED: closed === null ? "?" : String(closed),
  };
  process.stdout.write(payload.replace(/\{\{(DECK|OPEN|CLOSED)\}\}/g, (_match, name: string) => values[name] ?? ""));
}
