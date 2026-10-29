import converse from "../payload/converse.md" with { type: "text" };
import finalImplement from "../payload/final-implement.md" with { type: "text" };
import finalReview from "../payload/final-review.md" with { type: "text" };
import finalRevise from "../payload/final-revise.md" with { type: "text" };
import hookRefused from "../payload/hook-refused.md" with { type: "text" };
import implement from "../payload/implement.md" with { type: "text" };
import reconcile from "../payload/reconcile.md" with { type: "text" };
import reply from "../payload/reply.md" with { type: "text" };
import review from "../payload/review.md" with { type: "text" };
import revise from "../payload/revise.md" with { type: "text" };
import stripIds from "../payload/strip-ids.md" with { type: "text" };
import type { Answer, ObjectSchema, Schema } from "./answer.ts";
import { refuseHeadline, refuseHeadlines } from "./cardfile.ts";
import { type Deck, locate } from "./deck.ts";
import { readDocument } from "./document.ts";
import { headSha } from "./git.ts";
import { type Check, correct, type Harness, launch, resume, RoleFailure, type Session } from "./harness.ts";
import { citedIds } from "./id.ts";
import { addedLines, changedSince, CommitRefused, discard, land, snapshot, uncommittedDiff, undoMovedHead } from "./landing.ts";
import { appendRecord, closeCard, dropUnlanded, fileCard, toolWrittenChanges } from "./operations.ts";
import { fill } from "./payload.ts";
import { type Plan, writeRecord } from "./plan.ts";

/** The roles of one card's cycle. */
export type Role = "reconciler" | "implementer" | "reviewer";

/**
 * Where a cycle is: the reconciler's turn, the implementer's, the reviewer's,
 * or landing the reviewer's answer, which is under the reviewer because its
 * subject and note are what lands; or the reconciler resumed to answer an
 * implementer's blocking finding, which is conversing.
 */
export type Step = "reconcile" | "converse" | "implement" | "review" | "land";

/**
 * A card's cycle as the plan's record holds it, written before each step
 * starts, so a role that fails leaves its role, step and session recorded.
 * It stays after the card closes, until the next card's cycle replaces it; a
 * card closed done is what says its cycle ended.
 */
export type Cycle = {
  card: string;
  /** The worktree's HEAD when the cycle started, which every role's own commits are undone back to. */
  base: string;
  role: Role;
  step: Step;
  /**
   * Each role's session id, recorded before the session is launched: the
   * reviewer's is the latest revision round's, since each round has a fresh
   * one, and the implementer's the latest amendment's, since each amendment
   * has a fresh one, which is resumed under the id it was launched with, as
   * the reconciler is.
   */
  sessions: Partial<Record<Role, string>>;
  /**
   * The revision rounds and the exchanges the cycle has had, each counted
   * against its cap, recorded with each step so a resumed cycle carries them
   * on from the step it resumes.
   */
  rounds: number;
  exchanges: number;
  /**
   * The reviewer's subject and close note, recorded with step land once they
   * and the diff cite no card id, so a card whose commit lands and whose run
   * dies before it closes closes from them.
   */
  subject?: string;
  note?: string;
  /** The card's commit, recorded once it lands and before the card closes. */
  commit?: string;
  /**
   * The implementer's latest blocking finding, recorded with step converse,
   * which a stop for a gap appends to the card's record, a resumed
   * reconciler's included.
   */
  finding?: string;
};

/**
 * How a cycle ended, and the plan as it then stands. A reconciler that stops
 * the run asks the owner `question`, and one that stops it for a gap names
 * the `gap`; a reviewer that asks for a revision past the cap leaves its
 * `feedback`; a role that fails asks nothing.
 */
export type CycleEnd = { plan: Plan } & (
  | { outcome: "landed"; sha: string }
  | { outcome: "stopped"; role: Role; session: Session; cause: string; question?: string; feedback?: string; gap?: string }
);

/** How many revision rounds a card's cycle gets before a reviewer asking for another stops the run. */
export const REVISION_ROUNDS = 3;

/**
 * How many exchanges a card's cycle gets, each an implementer's blocking
 * finding and the reconciler's reply or amendment answering it, before a
 * blocking finding past them gets the reconciler's stop for disagreement
 * alone.
 */
export const EXCHANGES = 3;

/**
 * How many times a card's landing sends the reviewer back for a card id
 * before a third failure has the reviewer failed: the subject and close note
 * get this many returns, and the lines the diff adds as many again, each
 * counted apart from the other and from the repair prompts of a malformed
 * answer. A commit the host repository's hook refuses gets as many returns
 * again, counted apart from those.
 */
export const ID_RETURNS = 2;

/**
 * The findings every role's answer may carry, each something outside the
 * card's contract that the role must not act on, which the tool files as a
 * waiting card: its headline, and its body.
 */
const FINDINGS: Schema = {
  type: "array",
  items: {
    type: "object",
    properties: { headline: { type: "string" }, body: { type: "string" } },
    required: ["headline", "body"],
  },
};

/**
 * The reconciler's answer. Which fields go with which outcome, a schema of
 * this subset cannot state, so `carried` checks it.
 */
export const RECONCILER: ObjectSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["proceed", "stop"] },
    amended: { type: "string" },
    cause: { type: "string", enum: ["intent", "order"] },
    question: { type: "string" },
    findings: FINDINGS,
  },
  required: ["outcome"],
};

/**
 * The reconciler's answer to an implementer's blocking finding, within the
 * exchanges a cycle gets, its stop for a cause among `causes`; `carried`
 * checks its fields by outcome.
 */
function conversing(causes: string[]): ObjectSchema {
  return {
    type: "object",
    properties: {
      outcome: { type: "string", enum: ["amended", "reply", "stop"] },
      amended: { type: "string" },
      reply: { type: "string" },
      cause: { type: "string", enum: causes },
      question: { type: "string" },
      findings: FINDINGS,
    },
    required: ["outcome"],
  };
}

/**
 * The reconciler's answer to a blocking finding past the exchanges a cycle
 * gets: a stop, for a cause among `causes`.
 */
function disagreeing(causes: string[]): ObjectSchema {
  return {
    type: "object",
    properties: {
      outcome: { type: "string", enum: ["stop"] },
      cause: { type: "string", enum: causes },
      question: { type: "string" },
      findings: FINDINGS,
    },
    required: ["outcome", "cause", "question"],
  };
}

/**
 * The reconciler's answers to a blocking finding. On the plan's final card a
 * blocking finding can be a gap in the plan, which only that card verifies,
 * so the cause `gap` is offered there alone and `order` is not, since work
 * no earlier card landed is what a gap is; past the exchanges the stop for
 * disagreement is offered beside it. Which cause a finding is, the
 * reconciler judges, and the tool routes on it.
 */
const CONVERSE = conversing(["intent", "order"]);
const DISAGREEMENT = disagreeing(["disagreement"]);
const FINAL_CONVERSE = conversing(["intent", "gap"]);
const FINAL_DISAGREEMENT = disagreeing(["disagreement", "gap"]);

/**
 * The fields each role's outcomes carry. No two roles share an outcome word,
 * so one table serves them all.
 */
const CARRIES: Record<string, string[]> = {
  proceed: ["amended"],
  stop: ["cause", "question"],
  amended: ["amended"],
  reply: ["reply"],
  done: ["account"],
  blocked: ["finding"],
  approved: ["subject", "close_note"],
  fixed: ["subject", "close_note"],
  revision: ["feedback"],
};

/** Refuses an answer that lacks a field its outcome carries. */
const carried: Check = (answer: Answer) => {
  for (const field of CARRIES[answer.outcome as string]!) {
    if (field in answer) continue;
    throw new Error(`answer lacks the field ${JSON.stringify(field)}, which outcome ${JSON.stringify(answer.outcome)} carries`);
  }
};

type Finding = { headline: string; body: string };

/**
 * Refuses an answer holding a finding the tool could not file as a card, a
 * headline that is empty or wraps or a body with a line starting `# `, while
 * the role can still repair it.
 */
const fileable: Check = (answer: Answer) => {
  for (const [index, { headline, body }] of ((answer.findings ?? []) as Finding[]).entries()) {
    try {
      refuseHeadline(headline);
    } catch (error) {
      throw new Error(`answer.findings[${index}].headline: ${(error as Error).message}`);
    }
    refuseHeadlines(`answer.findings[${index}].body`, body);
  }
};

/** Refuses an answer that lacks a field its outcome carries, or holds a finding the tool could not file. */
const answered: Check = (answer: Answer) => {
  carried(answer);
  fileable(answer);
};

/** Each cause a reconciler stops on, as the owner reads it. */
const CAUSES: Record<string, string> = {
  intent: "the card's intent itself is wrong, which only the owner can change",
  order: "the card depends on work no earlier card has landed, a problem of order for authoring to fix",
  disagreement: `the reconciler and the implementer had not agreed after ${EXCHANGES} exchanges, the most a card gets`,
  gap: "the final card found an acceptance criterion of the plan document that does not hold on the plan's branch, a gap in the plan for authoring to close with cards ahead of the final card",
};

/** The implementer's answer, whose fields by outcome `carried` checks, as it does the reconciler's. */
const IMPLEMENTER: ObjectSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["done", "blocked"] },
    account: { type: "string" },
    finding: { type: "string" },
    findings: FINDINGS,
  },
  required: ["outcome"],
};

/** The reviewer's answer, whose fields by outcome `carried` checks, as it does the reconciler's. */
const REVIEWER: ObjectSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["approved", "fixed", "revision"] },
    subject: { type: "string" },
    close_note: { type: "string" },
    feedback: { type: "string" },
    findings: FINDINGS,
  },
  required: ["outcome"],
};

/**
 * Refuses an answer whose `fields`, those it holds, hold a line starting
 * `# `, while the role can still repair it, rather than when the text is
 * written into the card after the role has ended.
 */
function noHeadlines(...fields: string[]): Check {
  return (answer: Answer) => {
    for (const field of fields) if (field in answer) refuseHeadlines(`answer.${field}`, answer[field] as string);
  };
}

/** Refuses an implementer's answer that `answered` refuses, or that holds a headline in its account. */
const implemented: Check = (answer: Answer) => {
  answered(answer);
  noHeadlines("account")(answer);
};

/**
 * Refuses an answer whose subject, where it holds one, is empty or spans
 * more than one line, while the reviewer can still repair it, rather than
 * when the card's commit lands with a malformed first line.
 */
const oneLineSubject: Check = (answer: Answer) => {
  if (!("subject" in answer)) return;
  const subject = answer.subject as string;
  if (subject.trim() === "") throw new Error("answer.subject is empty");
  if (subject.includes("\n")) throw new Error("answer.subject spans more than one line, and a commit's subject is one line");
};

/**
 * Refuses a reviewer's answer that `answered` refuses, that holds a headline
 * in a field its outcome carries, or whose subject is not one line.
 */
const reviewed: Check = (answer: Answer) => {
  answered(answer);
  noHeadlines("subject", "close_note", "feedback")(answer);
  oneLineSubject(answer);
};

/**
 * The reviewer's answer when the landing sends it back for a card id or a
 * hook's refusal, or when a cycle that stopped at the land step is resumed:
 * its whole report again, under an outcome that lands, findings included,
 * since the answer that lands is the one whose findings are filed.
 */
const LANDING: ObjectSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["approved", "fixed"] },
    subject: { type: "string" },
    close_note: { type: "string" },
    findings: FINDINGS,
  },
  required: ["outcome", "subject", "close_note"],
};

/**
 * What the one-way reference rule finds wrong with the subject and close note
 * of `answer`, naming each card id of the `prefix` deck they cite, or null
 * where they cite none.
 */
function messageCites(answer: Answer, prefix: string): string | null {
  const cites = ["subject", "close_note"].flatMap((field) => {
    const ids = citedIds(answer[field] as string, prefix);
    return ids.length === 0 ? [] : [`answer.${field} cites ${ids.join(", ")}`];
  });
  if (cites.length === 0) return null;
  return `${cites.join(", and ")}: the subject and close note go public as the card's commit message, so neither may cite a card id`;
}

/**
 * Holds the reviewer's landing answer to the one-way reference rule before
 * the card's commit is made, and returns the answer that passes. Its subject
 * and close note are checked for the deck's card ids, then the lines the
 * worktree's diff adds. A message citing one goes back to the reviewer by the
 * repair prompt, scoped to the message alone; a diff citing one resumes the
 * reviewer under strip-ids.md with the offending lines quoted, to remove each
 * id as a small fix, and both checks run again on its answer. Each check
 * sends the reviewer back ID_RETURNS times, and its next failure throws
 * RoleFailure, quoting what still cites an id.
 */
async function referenceChecked(deck: Deck, reviewer: Session, tree: string, base: string, answer: Answer): Promise<Answer> {
  let messageReturns = 0;
  let diffReturns = 0;
  for (;;) {
    const cited = messageCites(answer, deck.prefix);
    if (cited !== null) {
      if (messageReturns === ID_RETURNS) {
        throw new RoleFailure(`the subject and close note still cited a card id after ${ID_RETURNS} returns: ${cited}`);
      }
      messageReturns++;
      answer = await correct(reviewer, cited, LANDING, reviewed);
      continue;
    }
    // A reviewer committing its fixes would otherwise hide them from the
    // diff, and give the card two commits.
    await undoMovedHead(base, tree);
    const lines = (await addedLines(tree)).filter((line) => citedIds(line, deck.prefix).length > 0);
    if (lines.length === 0) return answer;
    if (diffReturns === ID_RETURNS) {
      const quoted = lines.map((line) => JSON.stringify(line)).join(", ");
      throw new RoleFailure(`the lines the card's diff adds still cited a card id after ${ID_RETURNS} returns: ${quoted}`);
    }
    diffReturns++;
    const ids = [...new Set(lines.flatMap((line) => citedIds(line, deck.prefix)))];
    const stripping = fill(stripIds, { LINES: lines.join("\n"), IDS: ids.map((id) => `\`${id}\``).join(", ") });
    answer = await resume(reviewer, stripping, LANDING, reviewed);
  }
}

/**
 * Files each finding in `answer`, from the role `role` working the card
 * `card`, through deck's filing function: into `open/` and in no plan's
 * order, so it waits and no run picks it up, with the role, the card and the
 * plan on its body's first line. Each is recorded in the plan's state as it
 * is filed, for the end of the plan.
 */
async function fileFindings(deck: Deck, plan: Plan, role: Role, card: string, answer: Answer): Promise<Plan> {
  for (const { headline, body } of (answer.findings ?? []) as Finding[]) {
    const filed = `Filed by the ${role} of ${card}, in the plan ${plan.slug}.\n\n${body}`;
    const id = await fileCard(deck, { labels: [], blockedBy: [], headline, body: filed });
    plan = await writeRecord(plan, { findings: [...plan.findings, { id, role, card }] });
  }
  return plan;
}

async function cardPath(deck: Deck, id: string): Promise<string> {
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  return found.path;
}

async function cardText(deck: Deck, id: string): Promise<string> {
  return (await Bun.file(await cardPath(deck, id)).text()).trimEnd();
}

/**
 * The reconciler's prompt, but for the answer's instruction, which `launch`
 * appends: the card and the plan document, each with the absolute path the
 * reconciler edits it at, since both live outside the worktree it runs in,
 * and whether the card is the plan's final card, where `final` says so.
 */
export function reconcilerPrompt(card: { path: string; text: string }, document: { path: string; text: string }, final: boolean): string {
  return fill(reconcile, {
    CARD_PATH: card.path,
    CARD_TEXT: card.text,
    DOCUMENT_PATH: document.path,
    DOCUMENT_TEXT: document.text.trimEnd(),
    FINAL: final ? "the plan's final card" : "not the plan's final card",
  });
}

/**
 * Runs the card `id` through one cycle in the plan's worktree `tree`: a fresh
 * reconciler, which reads the plan document and may amend it and the card in
 * place or stop the run, then a fresh implementer, whose account is appended
 * to the card, then a fresh reviewer, whose subject and close note land the
 * worktree as the card's one commit before the card closes done. A reviewer
 * may instead ask for a revision: its feedback is appended to the card, the
 * same implementer is resumed with it, and its account of the revision goes
 * to a fresh reviewer, for up to REVISION_ROUNDS rounds. An implementer may
 * instead answer that the card cannot be built as written: the reconciler is
 * resumed with its blocking finding, and either replies, and the
 * implementer is resumed with the reply, or amends the card, and the worktree
 * goes back to the cycle's base and the card's record drops the discarded
 * work's accounts and feedback for a fresh implementer, for up to EXCHANGES
 * exchanges, after which a blocking finding gets the reconciler's stop for
 * disagreement alone. Neither the implementer nor the reviewer is shown the
 * plan document, and the reviewer gets its commit convention alone, except on
 * the plan's final card, which verifies the plan's acceptance criteria: its
 * implementer, a revision of it and its reviewer each get a prompt of their
 * own with the plan document beside the card, and a blocking finding there
 * may be a gap in the plan, which the reconciler stops the run for and the
 * tool appends to the card's record under `## Gap`. Nothing is
 * committed until the reviewer's subject and close note, and the lines the
 * diff adds, cite no card id of the deck, as `referenceChecked` holds them.
 * A commit the host repository's hook refuses resumes the reviewer under
 * hook-refused.md with git's output quoted, to fix what the hook refused as a
 * small fix, and its answer goes through the id checks and the commit again,
 * for up to ID_RETURNS returns, after which the reviewer has failed; no hook
 * is ever bypassed. Every answer's findings are filed as waiting cards as the
 * answer is read, whatever its outcome, but for a reviewer's `approved` or
 * `fixed`: each answer the landing sends back, for a card id or a hook, is
 * replaced by the reviewer's next, which restates the whole report, so the
 * findings filed are those of the answer that lands, filed once its commit is
 * made and before the commit is recorded, and a reviewer that fails at its
 * last return files none. A reconciler that proceeds, or amends the card after
 * a blocking finding, having changed the worktree, or the card's frontmatter
 * or record, has failed, and the change is left in place, the implementer's
 * work beside it, undiscarded. A reconciler that stops, a reviewer asking for
 * a revision past the cap, or a role that fails, ends the cycle stopped, with
 * its cause and session.
 */
export async function runCard(deck: Deck, plan: Plan, id: string, tree: string, harness: Harness): Promise<CycleEnd> {
  const base = await headSha(tree);
  // Every cycle starts here, a rerun's included, so no role of it reads an
  // account of work a discarded cycle left in no worktree.
  await dropUnlanded(deck, id);
  const cycle: Cycle = {
    card: id,
    base,
    role: "reconciler",
    step: "reconcile",
    sessions: { reconciler: crypto.randomUUID() },
    rounds: 0,
    exchanges: 0,
  };
  plan = await writeRecord(plan, { cycle });

  const card = { path: await cardPath(deck, id), text: await cardText(deck, id) };
  const reconciling = reconcilerPrompt(card, { path: plan.document, text: await Bun.file(plan.document).text() }, id === plan.final);
  return cycleFrom(deck, plan, tree, harness, reconciling, launch);
}

/**
 * Carries on the cycle that stopped the run, from the step the plan's record
 * holds and with the counts it holds, by resuming the session of the role
 * that stopped it with `prompt` and that step's schema, and then as `runCard`
 * goes on from there. The worktree is as the role left it. At the land step
 * that is the reviewer's landing answer, which lands as a review's approval
 * does, id checks and hook returns included.
 */
export function resumeCard(deck: Deck, plan: Plan, tree: string, harness: Harness, prompt: string): Promise<CycleEnd> {
  return cycleFrom(deck, plan, tree, harness, prompt, resume);
}

/**
 * The cycle `card resume` carries on from the bounced `cycle`, which `bounce`
 * stopped: a cap's stop has reached the owner, which is what the cap is for,
 * so the count of the cap that stopped the run starts again, and every other
 * bounce carries the counts on as recorded. After the revision rounds, a
 * revision the resumed reviewer asks for is the first round of the new count;
 * after a stop for disagreement, which only a blocking finding past the
 * exchanges gets, the blocking finding the resumed reconciler answers is the
 * first exchange of it.
 */
export function restartCap(cycle: Cycle, { question, feedback }: { question?: string; feedback?: string }): Cycle {
  if (feedback !== undefined) return { ...cycle, rounds: 0 };
  if (question !== undefined && cycle.exchanges > EXCHANGES) return { ...cycle, exchanges: 1 };
  return cycle;
}

/**
 * The answer each step asks of its role, on the plan's final card where
 * `final`, and what the answer has to meet beyond it. At the land step, which
 * only a resumed cycle starts from, it is the reviewer's landing answer.
 */
function asked(step: Step, exchanges: number, final: boolean): [ObjectSchema, Check] {
  switch (step) {
    case "reconcile":
      return [RECONCILER, answered];
    case "converse":
      if (exchanges > EXCHANGES) return [final ? FINAL_DISAGREEMENT : DISAGREEMENT, answered];
      return [final ? FINAL_CONVERSE : CONVERSE, answered];
    case "implement":
      return [IMPLEMENTER, implemented];
    case "review":
      return [REVIEWER, reviewed];
    case "land":
      return [LANDING, reviewed];
  }
}

/**
 * The cycle recorded in `plan`, from its step on: the step's role is handed
 * `prompt` by `answering`, and each answer records and prompts the next step,
 * until the card lands or the cycle stops, as `runCard` sets out.
 */
async function cycleFrom(
  deck: Deck,
  plan: Plan,
  tree: string,
  harness: Harness,
  prompt: string,
  answering: typeof launch,
): Promise<CycleEnd> {
  let cycle = plan.cycle!;
  const { card: id, base } = cycle;
  const final = id === plan.final;
  const session = (role: Role): Session => ({ harness, id: cycle.sessions[role]!, dir: tree });
  const documentText = async () => (await Bun.file(plan.document).text()).trimEnd();
  /**
   * The prompt that launches an implementer on the card as its file then
   * stands, so a reconciler's amendments reach it, with the plan document
   * beside the card on the final card.
   */
  const implementing = async () =>
    final
      ? fill(finalImplement, { CARD_TEXT: await cardText(deck, id), DOCUMENT_TEXT: await documentText() })
      : fill(implement, { CARD_TEXT: await cardText(deck, id) });
  let { rounds, exchanges } = cycle;
  /**
   * The card's file and the worktree as the reconciler is handed them at
   * `step`, whose frontmatter, record and files it may not change: at the
   * reconcile step the worktree is the cycle's base, and conversing, it holds
   * the implementer's uncommitted work, which a cycle resumed conversing takes
   * as it finds it.
   */
  const handed = async (step: Step) => ({
    card: await Bun.file(await cardPath(deck, id)).text(),
    tree: step === "converse" ? await snapshot(tree, base) : new Map(),
  });
  let reconciledFrom = await handed(cycle.step);
  /** Records the cycle at `role`'s `step`, with the counts, under a fresh session where `fresh`, before the role is called. */
  const enter = async (role: Role, step: Step, fresh = false) => {
    const sessions = fresh ? { ...cycle.sessions, [role]: crypto.randomUUID() } : cycle.sessions;
    cycle = { ...cycle, role, step, sessions, rounds, exchanges };
    plan = await writeRecord(plan, { cycle });
  };

  for (;;) {
    const { role, step } = cycle;
    let answer: Answer;
    // The card's commit, once a reviewer's answer has landed.
    let sha = "";
    try {
      answer = await answering(session(role), prompt, ...asked(step, exchanges, final));
      // A cycle resumed at the land step lands its reviewer's landing answer here too.
      for (let hookReturns = 0; (step === "review" || step === "land") && answer.outcome !== "revision"; hookReturns++) {
        answer = await referenceChecked(deck, session(role), tree, base, answer);
        const { subject, close_note: note } = answer as { subject: string; close_note: string };
        cycle = { ...cycle, step: "land", subject, note };
        plan = await writeRecord(plan, { cycle });
        try {
          // `referenceChecked` undid any commit of the reviewer's before it read the diff.
          sha = await land(subject, note, tree);
          break;
        } catch (error) {
          // The tool never passes --no-verify: the host repository's rules are not its to waive.
          if (!(error instanceof CommitRefused)) throw error;
          if (hookReturns === ID_RETURNS) {
            throw new RoleFailure(`the host repository's hook still refused the commit after ${ID_RETURNS} returns: ${error.message}`);
          }
          answer = await resume(session(role), fill(hookRefused, { OUTPUT: error.message }), LANDING, reviewed);
        }
      }
    } catch (error) {
      if (!(error instanceof RoleFailure)) throw error;
      return { plan, outcome: "stopped", role, session: session(role), cause: error.message };
    }
    // For a reviewer, from the answer that landed, which restates its whole
    // report, and before its commit is recorded, so a run dying between the
    // two reruns the card rather than losing them.
    plan = await fileFindings(deck, plan, role, id, answer);

    if (answer.outcome === "stop") {
      const { cause, question } = answer as { cause: string; question: string };
      const stopped = { plan, outcome: "stopped", role, session: session(role), cause: CAUSES[cause]!, question } as const;
      if (cause !== "gap") return stopped;
      // Only a conversing reconciler on the final card is offered `gap`, and the converse step records the finding.
      const gap = cycle.finding!;
      // In the record, so the roles that run the final card again read what this run found.
      await appendRecord(deck, id, "Gap", gap);
      return { ...stopped, gap };
    }

    if (step === "converse" && answer.outcome === "reply") {
      await enter("implementer", "implement");
      prompt = fill(reply, { REPLY: (answer.reply as string).trimEnd() });
      // A reply resumes the implementer on the work as it left it.
      answering = resume;
    } else if (step === "reconcile" || step === "converse") {
      // Every fresh implementer within a cycle starts here, after a reconciler's proceed or its amendment alike.
      const did = step === "reconcile" ? "proceeded" : "amended the card";
      const paths = await changedSince(tree, base, reconciledFrom.tree);
      const parts = toolWrittenChanges(reconciledFrom.card, await Bun.file(await cardPath(deck, id)).text());
      if (paths.length > 0 || parts.length > 0) {
        const changed = [
          ...(paths.length > 0 ? [`${paths.join(", ")} in the worktree`] : []),
          ...(parts.length > 0 ? [`the card's ${parts.join(", ")}`] : []),
        ];
        // Left in place, since a reconciler that changes these is a bug in it or its prompt for the owner to find.
        const cause = `the reconciler ${did} having changed ${changed.join(" and ")}, which a reconciler may not change; the change is left in place for the owner to look at`;
        return { plan, outcome: "stopped", role, session: session(role), cause };
      }
      // The run's log, where the owner reads what the reconciler changed.
      console.log(`${id}: the reconciler ${did}: ${answer.amended}`);
      // Discarded, so an amendment owes nothing to the work it replaces, and
      // that work's account and feedback dropped with it, as a rerun drops
      // them; after a proceed there is neither.
      await discard(tree, base);
      await dropUnlanded(deck, id);
      await enter("implementer", "implement", true);
      // Read after the reconciler has ended, so its amendments reach the implementer.
      prompt = await implementing();
      answering = launch;
    } else if (step === "implement" && answer.outcome === "blocked") {
      exchanges++;
      // Before the reconciler converses, so HEAD is the branch it amends the card to and the work is uncommitted.
      await undoMovedHead(base, tree);
      reconciledFrom = await handed("converse");
      cycle = { ...cycle, finding: answer.finding as string };
      await enter("reconciler", "converse");
      prompt = fill(converse, {
        FINDING: (answer.finding as string).trimEnd(),
        NUMBER: String(exchanges),
        FINAL: final ? "the plan's final card" : "not the plan's final card",
      });
      answering = resume;
    } else if (step === "implement") {
      // Before the diff is taken, so the reviewer sees committed work as uncommitted.
      await undoMovedHead(base, tree);
      await appendRecord(deck, id, "Account", answer.account as string);
      await enter("reviewer", "review", true);
      // The card's record holds every account and every earlier round's feedback.
      const { fields } = readDocument(await Bun.file(plan.document).text());
      const reviewing = {
        CARD_TEXT: await cardText(deck, id),
        DIFF: (await uncommittedDiff(tree)).trimEnd(),
        COMMIT_CONVENTION: fields.get("commit-convention") || "(none)",
      };
      prompt = final ? fill(finalReview, { ...reviewing, DOCUMENT_TEXT: await documentText() }) : fill(review, reviewing);
      answering = launch;
    } else if (answer.outcome === "revision") {
      const { feedback } = answer as { feedback: string };
      await appendRecord(deck, id, "Review feedback", feedback);
      if (rounds === REVISION_ROUNDS) {
        const cause = `the reviewer still asked for a revision after ${REVISION_ROUNDS} revision rounds, the most a card gets`;
        return { plan, outcome: "stopped", role, session: session(role), cause, feedback };
      }
      rounds++;
      // The reconciler is not brought back: the card is the contract it was.
      await enter("implementer", "implement");
      prompt = fill(final ? finalRevise : revise, { FEEDBACK: feedback.trimEnd() });
      answering = resume;
    } else {
      plan = await writeRecord(plan, { cycle: { ...cycle, commit: sha } });
      await closeCard(deck, id, "done", cycle.note!);
      return { plan, outcome: "landed", sha };
    }
  }
}
