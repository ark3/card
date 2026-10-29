/** The harnesses card knows how to start a session in. */
export type Harness = "claude" | "pi";

/** The harness a session starts in, and why that one. */
export type Choice = { harness: Harness; why: string };

/**
 * Claude Code where it is installed, else Pi, unless `named` (from `--harness`)
 * names one, which then has to be installed too. Nothing here wraps the
 * harness: card leaves sandboxing to the environment the owner runs it in.
 * `Bun.which` is handed PATH because it otherwise reads the PATH the process
 * started with.
 */
export function chooseHarness(named: Harness | null): Choice {
  const onPath = (name: string) => Bun.which(name, { PATH: process.env.PATH ?? "" }) !== null;
  if (named !== null) {
    if (!onPath(named)) throw new Error(`--harness names ${named}, but ${named} is not on PATH`);
    return { harness: named, why: "--harness named it" };
  }
  if (onPath("claude")) return { harness: "claude", why: "claude is on PATH" };
  if (onPath("pi")) return { harness: "pi", why: "pi is on PATH and claude is not" };
  throw new Error("neither claude nor pi is on PATH, so there is no harness to start a session with");
}
