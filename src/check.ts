import { openSync } from "node:fs";
import path from "node:path";
import prompt from "../payload/check.md" with { type: "text" };
import * as cards from "./cards.ts";
import { readDocument } from "./document.ts";
import { resolveCommit } from "./git.ts";
import { chooseHarness, type Harness } from "./harness.ts";
import { ensureBranch, holdWorktree } from "./landing.ts";
import { forOwner } from "./owner.ts";
import { fill, wrapPayload } from "./payload.ts";
import { bootId, type Context, listPlans, type Plan, writeRecord } from "./plan.ts";

const RUN = path.join(import.meta.dir, "run.ts");

/** The Check stage's prompt, which bare `card` prints for as long as the stage lasts. */
export async function printPrompt({ deck, plan, command }: Context): Promise<void> {
  // The Cards stage's `card done` refuses without a final card, so the list is never empty here.
  const values = {
    CARD: command,
    PLAN_DOCUMENT: plan.document,
    PLAN_CARDS: (await cards.planCards(deck, plan)).join("").trimEnd(),
  };
  process.stdout.write(wrapPayload(command, fill(prompt, values)));
}

/**
 * `card amend` in the Check stage: the check needs a card added or moved, so
 * the plan goes back to Cards, its cards kept, and that stage's prompt is
 * printed for the session to draft under.
 */
export async function amend(context: Context): Promise<void> {
  const { plan, command, args } = context;
  if (args.length > 0) throw new Error(`usage: ${command} amend`);
  await cards.printPrompt({ ...context, plan: await writeRecord(plan, { state: "Cards" }) });
}

/**
 * `card approve` in the Check stage: the owner's approval, which starts the
 * run. Everything that can refuse is checked before the run starts. The run
 * is detached, the leader of its own process group, and this returns at once
 * while it goes on.
 */
export async function approve({ deck, plan, command, args }: Context): Promise<void> {
  const usage = `usage: ${command} approve [--harness claude|pi]`;
  if (args.length !== 0 && !(args.length === 2 && args[0] === "--harness" && ["claude", "pi"].includes(args[1]!))) {
    throw new Error(usage);
  }
  // This plan is in Check, so a plan Running or Dead is another's.
  const live = (await listPlans(deck)).find(({ state }) => state === "Running" || state === "Dead");
  if (live !== undefined) {
    throw new Error(`\`${command} approve\` is refused while another plan's run is Running or Dead, and the plan \`${live.slug}\`'s run is ${live.state}`);
  }
  // A run carried on after `card amend` keeps the harness it recorded, unless `--harness` names one.
  const { harness, why } =
    args.length === 0 && plan.harness !== null
      ? { harness: plan.harness, why: "the run already ran on it" }
      : chooseHarness(args.length === 2 ? (args[1] as Harness) : null);

  // `card done` in the Document stage refused a document without either.
  const { fields } = readDocument(await Bun.file(plan.document).text());
  const branch = fields.get("branch")!;
  const startPoint = fields.get("start-point")!;
  const cwd = process.cwd();
  const start = await resolveCommit(startPoint, cwd);
  if (start === null) {
    throw new Error(`the plan document's start point \`${startPoint}\` is not a commit git can resolve; correct \`start-point:\` in ${plan.document}`);
  }
  await ensureBranch(branch, start, cwd);
  const tree = await holdWorktree(plan.slug, branch, cwd);
  const log = await startRun(plan, harness, tree, cwd);
  process.stdout.write(forOwner(`The plan \`${plan.slug}\` is running on ${harness}, since ${why}, in ${tree}; its log is ${log}.\n`));
}

/**
 * Starts the plan's run on `harness` in the worktree `tree`, detached, the
 * leader of its own process group, from `cwd`, so it resolves the deck as
 * this process did, and records it Running. Given `resuming`, the prompt
 * `card resume` built, the run resumes the bounced cycle's stopped role with
 * it before anything else. Returns the run's log.
 */
export async function startRun(plan: Plan, harness: Harness, tree: string, cwd: string, resuming: string | null = null): Promise<string> {
  const log = path.join(plan.dir, "run.log");
  const output = openSync(log, "a");
  const run = Bun.spawn([process.execPath, RUN, plan.slug, tree, ...(resuming === null ? [] : ["--resume"])], {
    cwd,
    env: process.env,
    detached: true,
    stdin: "pipe",
    stdout: output,
    stderr: output,
  });
  // The run waits for its stdin to close before it reads the plan, so this is
  // the record it reads, and it starts nothing unless the record names it.
  if (resuming !== null) run.stdin.write(resuming);
  await writeRecord(plan, { state: "Running", harness, run: { pid: run.pid, boot: await bootId() }, bounce: null });
  run.stdin.end();
  run.unref();
  return log;
}
