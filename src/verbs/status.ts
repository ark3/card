import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import payload from "../../payload/status.md" with { type: "text" };
import { resolveDeck, stagedId } from "../deck.ts";

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
async function entries(dir: string): Promise<string[] | null> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function count(names: string[] | null): number | null {
  return names === null ? null : names.filter((name) => name.endsWith(".md")).length;
}

export async function run(_args: string[], cwd: string): Promise<void> {
  // The sandbox the probe looks for is one `sbox` makes, so where that binary
  // is not installed there is nothing to verify, and refusing would leave this
  // command undeliverable on that machine — it is the only thing that tells a
  // session the workflow exists. Naming the binary couples card to one
  // personal tool, which is the lighter coupling: describing its mounts
  // instead would drift from the tool that makes them. The notice goes to
  // stdout, where the session reading this output will see it. `Bun.which`
  // reads the process's own PATH unless handed one, and handing it one is what
  // puts this branch within reach of a test.
  if (Bun.which("sbox", { PATH: process.env.PATH ?? "" }) === null) {
    console.log("Sandbox check skipped: sbox is not on PATH, so there is nothing to probe. Take this session to be unsandboxed.");
  } else {
    const warning = await probeSandbox();
    if (warning !== null) throw new Error(warning);
  }

  const deck = await resolveDeck(cwd);
  if (deck === null) {
    // Not one word about cards where there is no deck: that is what makes this
    // command safe to run unconditionally in a project that never adopts it.
    console.log("No card deck for this project.");
    return;
  }

  const [openNames, closedNames] = await Promise.all([entries(deck.openDir), entries(deck.closedDir)]);
  const [open, closed] = [count(openNames), count(closedNames)];
  // A deck missing a directory is broken, but this is the only command that
  // tells a session the workflow exists, so it says so and carries on.
  for (const [dir, found] of [[deck.openDir, open], [deck.closedDir, closed]] as const) {
    if (found === null) console.error(`card: ${dir} is not there, so this deck is incomplete`);
  }
  // `close` stages under a name no listing shows and no count includes, so a
  // close that died between its write and its rename leaves a file that is
  // otherwise invisible to every verb, for good. This line is where a deck
  // says it happened, on stderr beside the other report of a deck in
  // disrepair; stdout is the payload a session reads as its instructions, and
  // a leftover is not one. Named, never removed: the file is the only copy of
  // a close note somebody typed, and unlinking one under a close still in
  // flight would take out the rename that makes a close atomic.
  for (const name of (closedNames ?? []).sort()) {
    const id = stagedId(name);
    if (id === null) continue;
    console.error(
      `card: ${path.join(deck.closedDir, name)} is a close that stopped before its rename, so ${id} is still open and its close note is in that file alone; close ${id} again to replace it, or delete it`,
    );
  }
  // CARD_ROOT beats the structural resolution silently, and only ever means
  // "somewhere else entirely", so the line that names the deck says so.
  const viaRoot = (process.env.CARD_ROOT ?? "") !== "";
  const values: Record<string, string> = {
    DECK: viaRoot ? `${deck.deckDir} (from CARD_ROOT)` : deck.deckDir,
    OPEN: open === null ? "?" : String(open),
    CLOSED: closed === null ? "?" : String(closed),
  };
  process.stdout.write(payload.replace(/\{\{(DECK|OPEN|CLOSED)\}\}/g, (_match: string, name: string) => values[name] ?? ""));
}
