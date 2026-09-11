import { mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readCard } from "../cardfile.ts";
import { CONFIG_NAME, type Deck, type RunConfig, requireDeck } from "../deck.ts";
import { git } from "../git.ts";
import { locate } from "./show.ts";
import { mainCheckout } from "./worktree.ts";

const USAGE = "usage: card run <id>...";

/** A card as the run reads it: how it ended, and what routes and warns. */
type State = { state: string; labels: string[]; body: string };

/** One card's line in the report, whether a session ran for it or not. */
type Section = {
  id: string;
  state: string;
  model: string | null;
  sessionId: string | null;
  output: string;
};

async function stateOf(deck: Deck, id: string): Promise<State> {
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  const card = await readCard(found.path);
  return { state: card.closed ?? "open", labels: card.labels, body: card.body };
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
 * checkout is clean again. Dirt outside the deck is never committed however
 * the config reads: that is a session that forgot to land its work, and the
 * owner has to see it.
 */
async function settle(root: string, deck: Deck, config: RunConfig, id: string): Promise<string | null> {
  const dirty = await dirtyPaths(root);
  if (dirty.length === 0) return null;
  const outside = dirty.filter((file) => !file.startsWith(`${deck.deckDir}${path.sep}`));
  if (outside.length > 0) return `${root} is dirty outside the deck after ${id}: ${outside.join(", ")}`;
  if (config.closeCommit === undefined) {
    return `${root} is dirty after ${id} and no close-commit template says how to land it: ${dirty.join(", ")}`;
  }
  const staged = await git(["add", "--", ...dirty], root);
  if (!staged.ok) return staged.stderr.trim() || `git could not stage the deck after ${id}`;
  const committed = await git(["commit", "-q", "-m", config.closeCommit.replaceAll("{id}", id)], root);
  if (!committed.ok) return committed.stderr.trim() || `git could not commit the deck after ${id}`;
  return null;
}

/** The model for a card: its first label the map names, else the deck's default. */
function modelFor(config: RunConfig, labels: string[]): string | null {
  for (const label of labels) {
    const model = config.models[label];
    if (model !== undefined) return model;
  }
  return config.models[""] ?? null;
}

/** The session's own output, verbatim, which is also all `<id>.log` holds. */
async function session(
  config: RunConfig,
  model: string | null,
  sessionId: string,
  id: string,
  root: string,
  logPath: string,
): Promise<string> {
  const argv = [
    ...config.launch,
    "-p",
    ...(model === null ? [] : ["--model", model]),
    "--session-id",
    sessionId,
    "--name",
    `card run ${id}`,
    `Please execute the card ${id}`,
  ];
  const proc = Bun.spawn(argv, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const output = stdout + stderr;
  await writeFile(logPath, output);
  return output;
}

function resumeCommand(sessionId: string): string {
  return `claude --resume ${sessionId}`;
}

/**
 * Why what has just surfaced makes a card still ahead unsafe to start cold, or
 * null when nothing does.
 */
function namesAhead(texts: { where: string; text: string }[], ahead: string[]): string | null {
  for (const { where, text } of texts) {
    for (const id of ahead) {
      if (text.includes(id)) return `${where} names ${id}, which is still ahead in this run`;
    }
  }
  return null;
}

function report(stamp: string, lead: string, sections: Section[], filed: string[]): string {
  const parts = [`# card run ${stamp}`, "", lead, ""];
  for (const section of sections) {
    parts.push(
      `## ${section.id}`,
      "",
      `state: ${section.state}`,
      `model: ${section.model ?? "none named"}`,
      `resume: ${section.sessionId === null ? "no session ran" : resumeCommand(section.sessionId)}`,
      "",
      section.output === "" ? "No session output." : section.output.replace(/\n*$/, ""),
      "",
    );
  }
  parts.push("## Cards filed during the run", "");
  parts.push(filed.length === 0 ? "None." : filed.map((id) => `- ${id}`).join("\n"), "");
  return `${parts.join("\n").replace(/\n*$/, "")}\n`;
}

/** A stage line, so a run reports progress before it ends. */
function stage(line: string): void {
  console.error(`[${new Date().toISOString()}] ${line}`);
}

export async function run(args: string[], cwd: string): Promise<void> {
  const ids = args;
  if (ids.length === 0 || ids.some((arg) => arg.startsWith("-"))) throw new Error(USAGE);

  const deck = await requireDeck(cwd);
  const config = deck.run;
  if (config === undefined) {
    throw new Error(
      `${path.join(deck.cardDir, CONFIG_NAME)} carries no [run] launch, so there is no command to start a session with`,
    );
  }
  // Every session commits on the base branch of the main checkout, so the run
  // works there, one card at a time: two at once would collide.
  const { root } = await mainCheckout(cwd);

  const stamp = new Date().toISOString().replace(/\..*$/, "").replaceAll(":", "-");
  const runDir = path.join(tmpdir(), "card-run", stamp);
  await mkdir(runDir, { recursive: true });

  const before = await openIds(deck);
  const sections: Section[] = [];
  let stopped: { id: string; reason: string; sessionId: string | null } | null = null;

  for (const [index, id] of ids.entries()) {
    const ahead = ids.slice(index + 1);
    const start = await stateOf(deck, id);
    // The owner re-runs the same command after resolving a card by hand, and
    // the resolved card must not run again.
    if (start.state !== "open") {
      stage(`${id} closed ${start.state} before the run began, so it is skipped`);
      sections.push({ id, state: start.state, model: null, sessionId: null, output: "" });
      continue;
    }

    const unclean = await whyNotClean(root);
    if (unclean !== null) {
      stopped = { id, reason: `nothing was launched for ${id}: ${unclean}`, sessionId: null };
      break;
    }

    const model = modelFor(config, start.labels);
    const sessionId = crypto.randomUUID();
    const logPath = path.join(runDir, `${id}.log`);
    stage(`${id} starting on ${model ?? "the launch command's own model"}, logging to ${logPath}`);
    const output = await session(config, model, sessionId, id, root, logPath);

    const end = await stateOf(deck, id);
    stage(`${id} ended ${end.state}`);
    sections.push({ id, state: end.state, model, sessionId, output });
    if (end.state !== "done") {
      // An open card is a session that handed back for the owner's input, and
      // resuming it by id is how the owner gives it; that is why the run
      // chooses the session id rather than letting the harness draw one.
      stopped = { id, reason: `${id} ended ${end.state} rather than done`, sessionId };
      break;
    }

    const unsettled = await settle(root, deck, config, id);
    if (unsettled !== null) {
      stopped = { id, reason: unsettled, sessionId };
      break;
    }

    const filed = [...(await openIds(deck))].filter((open) => !before.has(open)).sort();
    const texts = [{ where: `the hand-back of ${id}`, text: output }];
    for (const open of filed) {
      texts.push({ where: `${open}, filed during this run`, text: (await stateOf(deck, open)).body });
    }
    // A later card the surfacing work changed would start cold, so the owner
    // reads it before it runs.
    const warning = namesAhead(texts, ahead);
    if (warning !== null) {
      stopped = { id, reason: warning, sessionId };
      break;
    }
  }

  const filed = [...(await openIds(deck))].filter((open) => !before.has(open)).sort();
  const lead =
    stopped === null
      ? `Finished: every card in the series is closed done.`
      : `Stopped at ${stopped.id}: ${stopped.reason}.${stopped.sessionId === null ? "" : `\nResume that session with: ${resumeCommand(stopped.sessionId)}`}`;
  const reportPath = path.join(runDir, "REPORT.md");
  await writeFile(reportPath, report(stamp, lead, sections, filed));

  stage(stopped === null ? "the run finished" : `the run stopped at ${stopped.id}`);
  console.log(reportPath);
  if (stopped !== null) throw new Error(`${stopped.reason}; the report is at ${reportPath}`);
}
