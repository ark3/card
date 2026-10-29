import repair from "../payload/repair.md" with { type: "text" };
import { type Answer, answerInstruction, type ObjectSchema, readAnswer } from "./answer.ts";
import { fill } from "./payload.ts";

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

/** How many repair prompts a malformed answer gets before the role has failed. */
export const REPAIR_PROMPTS = 2;

/**
 * A role session: the harness it runs in, the id the tool chose for it, and
 * the directory it runs in, which a resume has to share because both
 * harnesses look a session up by the directory it ran in.
 */
export type Session = { harness: Harness; id: string; dir: string };

/** A role that ended without a valid answer; the message is the cause. */
export class RoleFailure extends Error {}

/** Each harness's flags, spelled here and nowhere else. */
function command(harness: Harness, id: string, resuming: boolean): string[] {
  if (harness === "pi") return ["pi", "-p", "--session-id", id];
  const session = resuming ? "--resume" : "--session-id";
  return ["claude", "-p", "--output-format", "json", "--permission-mode", "bypassPermissions", session, id];
}

/**
 * The command that resumes `session` interactively at a terminal, from the
 * directory it ran in, quoted for a POSIX shell because the repository root
 * it sits under is wherever the owner cloned. Pi's `--session-id` takes the
 * exact id, as at launch, where its `--session` would also match a partial one.
 */
export function resumeCommand({ harness, id, dir }: Session): string {
  return `cd '${dir.replaceAll("'", "'\\''")}' && ${harness === "pi" ? `pi --session-id ${id}` : `claude --resume ${id}`}`;
}

/**
 * Runs one turn of `session` with `prompt` on stdin, which has no size limit
 * where an argument does, and returns the session's final text. The session
 * gets this process's environment, because Bun otherwise resolves the
 * executable on the PATH the process started with. Pi's `-p` prints the final
 * text alone; Claude Code's JSON carries it in `result` beside `is_error`.
 */
async function turn(session: Session, resuming: boolean, prompt: string): Promise<string> {
  const proc = Bun.spawn(command(session.harness, session.id, resuming), {
    cwd: session.dir,
    env: process.env,
    stdin: new Blob([prompt]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (status !== 0) {
    const ended = proc.signalCode !== null ? `was killed by ${proc.signalCode}` : `exited with status ${status}`;
    throw new RoleFailure(`${session.harness} ${ended}: ${(stderr + stdout).trim()}`);
  }
  if (session.harness === "pi") return stdout;

  let output: { is_error?: unknown; subtype?: unknown; result?: unknown };
  try {
    output = JSON.parse(stdout);
  } catch {
    throw new RoleFailure(`Claude Code's output is not JSON: ${stdout.trim()}`);
  }
  if (output.is_error === true) {
    throw new RoleFailure(`Claude Code reported an error (${output.subtype}): ${output.result}`);
  }
  if (typeof output.result !== "string") throw new RoleFailure(`Claude Code's output has no result: ${stdout.trim()}`);
  return output.result;
}

/**
 * What an answer has to meet beyond its schema, such as a field's shape the
 * schema cannot state: it throws an Error saying what is wrong, which the
 * repair prompt quotes as it quotes a schema mismatch.
 */
export type Check = (answer: Answer) => void;

/** The repair prompt for an answer that `invalid` says is wrong, restating `schema`. */
function repairPrompt(invalid: string, schema: ObjectSchema): string {
  return fill(repair, { VALIDATION_ERROR: invalid, ANSWER_INSTRUCTION: answerInstruction(schema) });
}

/**
 * Reads the answer in `text`, `session`'s final text. A malformed answer, one
 * `check` refuses included, gets a repair prompt by resuming the same session,
 * which keeps what the session knows of its work while the prompt fences the
 * work off, up to REPAIR_PROMPTS times.
 */
async function read(session: Session, text: string, schema: ObjectSchema, check: Check): Promise<Answer> {
  for (let repairs = 0; ; repairs++) {
    try {
      const answer = readAnswer(schema, text);
      check(answer);
      return answer;
    } catch (error) {
      const invalid = (error as Error).message;
      if (repairs === REPAIR_PROMPTS) {
        throw new RoleFailure(`the answer was still malformed after ${REPAIR_PROMPTS} repair prompts: ${invalid}`);
      }
      text = await turn(session, true, repairPrompt(invalid, schema));
    }
  }
}

/** Runs `prompt` with `schema`'s instruction appended and reads the answer. */
async function ask(session: Session, resuming: boolean, prompt: string, schema: ObjectSchema, check: Check): Promise<Answer> {
  return read(session, await turn(session, resuming, `${prompt}\n\n${answerInstruction(schema)}`), schema, check);
}

/** Starts `session` under the id it names, and returns its answer to `prompt`. */
export function launch(session: Session, prompt: string, schema: ObjectSchema, check: Check = () => {}): Promise<Answer> {
  return ask(session, false, prompt, schema, check);
}

/** Continues `session`, launched before in the same directory, and returns its answer to `prompt`. */
export function resume(session: Session, prompt: string, schema: ObjectSchema, check: Check = () => {}): Promise<Answer> {
  return ask(session, true, prompt, schema, check);
}

/**
 * Continues `session`, launched before in the same directory, with `prompt`,
 * and returns its final text as it stands, for a turn the tool reads no
 * answer from, so `prompt` carries no schema.
 */
export function question(session: Session, prompt: string): Promise<string> {
  return turn(session, true, prompt);
}

/**
 * Sends `session` the repair prompt for an answer it gave that met its schema
 * and check but that the caller refuses, `invalid` saying why, and returns the
 * corrected answer to `schema`. The correction gets REPAIR_PROMPTS repair
 * prompts of its own for a malformed answer, so a caller that counts its own
 * refusals counts them apart from those.
 */
export async function correct(session: Session, invalid: string, schema: ObjectSchema, check: Check = () => {}): Promise<Answer> {
  return read(session, await turn(session, true, repairPrompt(invalid, schema)), schema, check);
}
