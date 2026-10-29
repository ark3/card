import asking from "../payload/ask.md" with { type: "text" };
import resuming from "../payload/resume.md" with { type: "text" };
import { startRun } from "./check.ts";
import { restartCap } from "./cycle.ts";
import { readDocument } from "./document.ts";
import { question } from "./harness.ts";
import { holdWorktree } from "./landing.ts";
import { forOwner } from "./owner.ts";
import { fill } from "./payload.ts";
import type { Context } from "./plan.ts";

/**
 * `card ask` in Bounced: the owner's question, on stdin, put to the session
 * whose answer stopped the run, by resuming it under its recorded id from the
 * directory it ran in, and its response printed for the owner. The tool
 * writes nothing, and the plan stays Bounced.
 */
export async function ask({ plan, command, args }: Context): Promise<void> {
  if (args.length > 0) throw new Error(`usage: ${command} ask, with the owner's question on stdin`);
  const asked = (await Bun.stdin.text()).trimEnd();
  if (asked.trim() === "") throw new Error(`\`${command} ask\` needs the owner's question on stdin`);
  const { role, session } = plan.bounce!;
  const response = await question(session, fill(asking, { QUESTION: asked }));
  process.stdout.write(forOwner(`The ${role}'s response:\n\n${response}`));
}

/**
 * `card resume` in Bounced: the owner's answer, on stdin, or nothing, carried
 * to the session whose answer stopped the run by a run started as
 * `card approve` starts one, which resumes that session first and carries the
 * card's cycle on from the step that stopped. The resumed role may work as
 * long as any role, so this returns at once.
 */
export async function resume({ plan, command, args }: Context): Promise<void> {
  if (args.length > 0) throw new Error(`usage: ${command} resume, with the owner's answer on stdin or nothing`);
  const answer = (await Bun.stdin.text()).trimEnd();
  const { role, cause } = plan.bounce!;
  const cycle = restartCap(plan.cycle!, plan.bounce!);
  const prompt = fill(resuming, { CAUSE: cause.trimEnd(), ANSWER: answer.trim() === "" ? "(none)" : answer });

  // `card approve` made the branch and the worktree, which is returned as it stands.
  const { fields } = readDocument(await Bun.file(plan.document).text());
  const cwd = process.cwd();
  const tree = await holdWorktree(plan.slug, fields.get("branch")!, cwd);
  // `startRun` writes the restarted count with the rest of the record.
  const log = await startRun({ ...plan, cycle }, plan.harness!, tree, cwd, prompt);
  process.stdout.write(forOwner(`The plan \`${plan.slug}\`'s run is resuming the ${role}'s session on ${plan.harness}, in ${tree}; its log is ${log}.\n`));
}
