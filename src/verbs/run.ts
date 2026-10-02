import { mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readCard } from "../cardfile.ts";
import { CONFIG_NAME, type Deck, requireDeck } from "../deck.ts";
import { git } from "../git.ts";
import { locate } from "./show.ts";
import { mainCheckout } from "./worktree.ts";

const USAGE = "usage: card run [--harness claude|pi] [--no-sbox] <id>...";

/** The harnesses the verb knows, which take `-p`, `--session-id` and `--name` alike. */
type Harness = "claude" | "pi";

/** What every session in the run starts under, and why that harness. */
type Launch = { harness: Harness; sbox: boolean; why: string };

/** One card's line in the report, whether a session ran for it or not. */
type Section = {
  id: string;
  state: string;
  sessionId: string | null;
  output: string;
};

/**
 * Refuses a `[run]` section left from when the verb read one, rather than
 * ignoring it, so the owner never believes a launch command, a model or a
 * commit message there still applies. Read here and not in `resolveDeck`: no
 * other verb ever read the section, so none of them refuses a deck for it.
 */
async function refuseRunSection(deck: Deck): Promise<void> {
  const configPath = path.join(deck.cardDir, CONFIG_NAME);
  const parsed = Bun.TOML.parse(await Bun.file(configPath).text()) as { run?: unknown };
  if (parsed.run !== undefined) {
    throw new Error(
      `${configPath} carries a [run] section, which card run no longer reads, since it knows its harnesses in code and leaves the model to each harness's own settings; delete [run] from that file`,
    );
  }
}

/**
 * Claude Code where it is installed, else Pi, unless `--harness` names one.
 * `sbox` wraps every session unless `--no-sbox` skips it, and skipping it adds
 * no permission flag, since the owner configures the harness for any unwrapped
 * use. `Bun.which` is handed PATH because it otherwise reads the PATH the
 * process started with.
 */
function chooseLaunch(named: Harness | null, noSbox: boolean): Launch {
  const onPath = (name: string) => Bun.which(name, { PATH: process.env.PATH ?? "" }) !== null;
  let harness: Harness;
  let why: string;
  if (named !== null) {
    // Checked here, since under sbox a missing harness ends the card open with
    // a resume command for a session that never existed.
    if (!onPath(named)) throw new Error(`--harness names ${named}, but ${named} is not on PATH`);
    harness = named;
    why = "--harness named it";
  } else if (onPath("claude")) {
    harness = "claude";
    why = "claude is on PATH";
  } else if (onPath("pi")) {
    harness = "pi";
    why = "pi is on PATH and claude is not";
  } else {
    throw new Error("neither claude nor pi is on PATH, so there is no harness to start a session with");
  }
  if (!noSbox && !onPath("sbox")) {
    throw new Error(`sbox is not on PATH, so ${harness} would run unsandboxed; pass --no-sbox to run it without sbox`);
  }
  return { harness, sbox: !noSbox, why };
}

/** What ran and why, as the stage lines and the report name it. */
function describe(launch: Launch): string {
  const wrapper = launch.sbox ? "under sbox" : "without sbox, as --no-sbox asked";
  return `${launch.harness} ${wrapper}, chosen because ${launch.why}`;
}

async function stateOf(deck: Deck, id: string): Promise<string> {
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  return (await readCard(found.path)).closed ?? "open";
}

async function openIds(deck: Deck): Promise<Set<string>> {
  const entries = await readdir(deck.openDir);
  return new Set(entries.filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3)));
}

/** Every path `git status` reports, absolute, so it can be read against the deck. */
async function dirtyPaths(root: string): Promise<string[]> {
  const status = await git(["status", "--porcelain"], root);
  if (!status.ok) throw new Error(status.stderr.trim() || `git could not read the status of ${root}`);
  return status.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    // A rename reports `old -> new`; the new path is the one that is there.
    .map((line) => path.resolve(root, line.slice(3).split(" -> ").pop()!.replace(/^"|"$/g, "")));
}

/** Anything a temporary tree left behind, which is a session that did not finish. */
async function standingTrees(root: string): Promise<string[]> {
  try {
    return (await readdir(path.join(root, ".worktrees"))).filter((name) => name !== ".gitignore");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Why the checkout is not fit to start a card in, or null when it is. */
async function whyNotClean(root: string): Promise<string | null> {
  const dirty = await dirtyPaths(root);
  if (dirty.length > 0) return `${root} is dirty: ${dirty.join(", ")}`;
  const trees = await standingTrees(root);
  if (trees.length > 0) return `${path.join(root, ".worktrees")} still holds ${trees.join(", ")}`;
  return null;
}

/**
 * Lands the dirt a close leaves on a deck git manages, and null says the
 * checkout is clean again. Dirt outside the deck is never committed: that is a
 * session that forgot to land its work, and the owner has to see it. Nor is a
 * deck that is not public, since the message cites the card's id.
 */
async function settle(root: string, deck: Deck, id: string): Promise<string | null> {
  const dirty = await dirtyPaths(root);
  if (dirty.length === 0) return null;
  const outside = dirty.filter((file) => !file.startsWith(`${deck.deckDir}${path.sep}`));
  if (outside.length > 0) return `${root} is dirty outside the deck after ${id}: ${outside.join(", ")}`;
  if (!deck.public) {
    return `${root} is dirty after ${id}, and only a public deck has its close committed, since the message cites the id: ${dirty.join(", ")}`;
  }
  const staged = await git(["add", "--", ...dirty], root);
  if (!staged.ok) return staged.stderr.trim() || `git could not stage the deck after ${id}`;
  const committed = await git(["commit", "-q", "-m", `chore: close ${id}`], root);
  if (!committed.ok) return committed.stderr.trim() || `git could not commit the deck after ${id}`;
  return null;
}

/**
 * The session's own output, verbatim, which is also all `<id>.log` holds. No
 * `--model`: each harness's own configured model and effort apply. The session
 * gets this process's environment, so it is found on, and inherits, the PATH
 * its harness was chosen from.
 */
async function session(
  launch: Launch,
  sessionId: string,
  id: string,
  root: string,
  logPath: string,
): Promise<string> {
  const argv = [
    ...(launch.sbox ? ["sbox"] : []),
    launch.harness,
    "-p",
    "--session-id",
    sessionId,
    "--name",
    `card run ${id}`,
    `Please execute the card ${id}`,
  ];
  const proc = Bun.spawn(argv, { cwd: root, env: process.env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const output = stdout + stderr;
  await writeFile(logPath, output);
  return output;
}

/**
 * The command that reopens a session this verb chose the id of, under the
 * wrapper it ran in and from the main checkout, since both harnesses look a
 * session up by the project it ran in.
 */
function resumeCommand(launch: Launch, sessionId: string, root: string): string {
  const resume = launch.harness === "claude" ? `claude --resume ${sessionId}` : `pi --session ${sessionId}`;
  return `cd ${root} && ${launch.sbox ? "sbox " : ""}${resume}`;
}

function report(
  stamp: string,
  launch: Launch,
  root: string,
  lead: string,
  sections: Section[],
  filed: string[],
): string {
  const parts = [`# card run ${stamp}`, "", `Sessions ran ${describe(launch)}.`, "", lead, ""];
  for (const section of sections) {
    parts.push(
      `## ${section.id}`,
      "",
      `state: ${section.state}`,
      `resume: ${section.sessionId === null ? "no session ran" : resumeCommand(launch, section.sessionId, root)}`,
      "",
      section.output === "" ? "No session output." : section.output.replace(/\n*$/, ""),
      "",
    );
  }
  parts.push("## Cards filed during the run", "");
  parts.push(filed.length === 0 ? "None." : filed.map((id) => `- ${id}`).join("\n"), "");
  return `${parts.join("\n").replace(/\n*$/, "")}\n`;
}

/** The local wall-clock time to the second, its date and time joined by `sep`. */
function localTime(sep: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${date}${sep}${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** A stage line, so a run reports progress before it ends. */
function stage(line: string): void {
  console.log(`[${localTime(" ")}] ${line}`);
}

export async function run(args: string[], cwd: string): Promise<void> {
  const ids: string[] = [];
  let named: Harness | null = null;
  let noSbox = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--harness") {
      const value = args[++i];
      if (value !== "claude" && value !== "pi") throw new Error(`--harness takes claude or pi\n${USAGE}`);
      named = value;
    } else if (arg === "--no-sbox") {
      noSbox = true;
    } else if (arg.startsWith("-")) {
      throw new Error(USAGE);
    } else {
      ids.push(arg);
    }
  }
  if (ids.length === 0) throw new Error(USAGE);

  const deck = await requireDeck(cwd);
  await refuseRunSection(deck);
  const launch = chooseLaunch(named, noSbox);
  // Every session commits on the base branch of the main checkout, so the run
  // works there, one card at a time: two at once would collide.
  const { root } = await mainCheckout(cwd);

  const stamp = localTime("T").replaceAll(":", "-");
  const runDir = path.join(tmpdir(), "card-run", stamp);
  await mkdir(runDir, { recursive: true });

  const before = await openIds(deck);
  const sections: Section[] = [];
  let stopped: { id: string; reason: string; sessionId: string | null } | null = null;

  for (const id of ids) {
    const start = await stateOf(deck, id);
    // The owner re-runs the same command after resolving a card by hand, and
    // the resolved card must not run again.
    if (start !== "open") {
      stage(`${id} closed ${start} before the run began, so it is skipped`);
      sections.push({ id, state: start, sessionId: null, output: "" });
      continue;
    }

    const unclean = await whyNotClean(root);
    if (unclean !== null) {
      stopped = { id, reason: `nothing was launched for ${id}: ${unclean}`, sessionId: null };
      break;
    }

    const sessionId = crypto.randomUUID();
    const logPath = path.join(runDir, `${id}.log`);
    stage(`${id} starting: ${describe(launch)}; logging to ${logPath}`);
    const output = await session(launch, sessionId, id, root, logPath);

    const end = await stateOf(deck, id);
    stage(`${id} ended ${end}`);
    sections.push({ id, state: end, sessionId, output });
    if (end !== "done") {
      // An open card is a session that handed back for the owner's input, and
      // resuming it by id is how the owner gives it; that is why the run
      // chooses the session id rather than letting the harness draw one.
      stopped = { id, reason: `${id} ended ${end} rather than done`, sessionId };
      break;
    }

    const unsettled = await settle(root, deck, id);
    if (unsettled !== null) {
      stopped = { id, reason: unsettled, sessionId };
      break;
    }
  }

  const filed = [...(await openIds(deck))].filter((open) => !before.has(open)).sort();
  const lead =
    stopped === null
      ? `Finished: every card in the series is closed done.`
      : `Stopped at ${stopped.id}: ${stopped.reason}.${stopped.sessionId === null ? "" : `\nResume that session with: ${resumeCommand(launch, stopped.sessionId, root)}`}`;
  const reportPath = path.join(runDir, "REPORT.md");
  await writeFile(reportPath, report(stamp, launch, root, lead, sections, filed));

  stage(stopped === null ? "the run finished" : `the run stopped at ${stopped.id}`);
  console.log(reportPath);
  if (stopped !== null) throw new Error(`${stopped.reason}; the report is at ${reportPath}`);
}
