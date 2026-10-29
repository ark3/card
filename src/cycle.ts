import converse from "../payload/converse.md" with { type: "text" };
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
import { addedLines, discard, land, uncommittedDiff, undoMovedHead } from "./landing.ts";
import { appendRecord, closeCard, fileCard } from "./operations.ts";
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
   * The reviewer's subject and close note, recorded with step land once they
   * and the diff cite no card id, so a card whose commit lands and whose run
   * dies before it closes closes from them.
   */
  subject?: string;
  note?: string;
  /** The card's commit, recorded once it lands and before the card closes. */
  commit?: string;
};

/**
 * How a cycle ended, and the plan as it then stands. A reconciler that stops
 * the run asks the owner `question`; a reviewer that asks for a revision past
 * the cap leaves its `feedback`; a role that fails asks nothing.
 */
export type CycleEnd = { plan: Plan } & (
  | { outcome: "landed"; sha: string }
  | { outcome: "stopped"; role: Role; session: Session; cause: string; question?: string; feedback?: string }
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
 * answer.
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
 * exchanges a cycle gets; `carried` checks its fields by outcome.
 */
const CONVERSE: ObjectSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["amended", "reply", "stop"] },
    amended: { type: "string" },
    reply: { type: "string" },
    cause: { type: "string", enum: ["intent", "order"] },
    question: { type: "string" },
    findings: FINDINGS,
  },
  required: ["outcome"],
};

/** The reconciler's answer to a blocking finding past the exchanges a cycle gets: the stop for disagreement alone. */
const DISAGREEMENT: ObjectSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["stop"] },
    cause: { type: "string", enum: ["disagreement"] },
    question: { type: "string" },
    findings: FINDINGS,
  },
  required: ["outcome", "cause", "question"],
};

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

/** Refuses a reviewer's answer that `answered` refuses, or that holds a headline in a field its outcome carries. */
const reviewed: Check = (answer: Answer) => {
  answered(answer);
  noHeadlines("subject", "close_note", "feedback")(answer);
};

/**
 * The reviewer's answer when the landing sends it back for a card id: its
 * whole report again, under an outcome that lands, findings included, since
 * the answer that passes the checks is the one whose findings are filed.
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
 * reconciler edits it at, since both live outside the worktree it runs in.
 */
export function reconcilerPrompt(card: { path: string; text: string }, document: { path: string; text: string }): string {
  return fill(reconcile, {
    CARD_PATH: card.path,
    CARD_TEXT: card.text,
    DOCUMENT_PATH: document.path,
    DOCUMENT_TEXT: document.text.trimEnd(),
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
 * goes back to the cycle's base for a fresh implementer, for up to EXCHANGES
 * exchanges, after which a blocking finding gets the reconciler's stop for
 * disagreement alone. Neither the implementer nor the reviewer is shown the
 * plan document; the reviewer gets its commit convention alone. Nothing is
 * committed until the reviewer's subject and close note, and the lines the
 * diff adds, cite no card id of the deck, as `referenceChecked` holds them.
 * Every answer's findings are filed as waiting cards as the answer is read,
 * whatever its outcome, but for a reviewer's `approved` or `fixed`: each
 * answer the landing sends back is replaced by the reviewer's next, which
 * restates the whole report, so the findings filed are those of the answer
 * that passes, and a reviewer that fails at its last return files none. A
 * reconciler that stops, a reviewer asking for a revision past the cap, or a
 * role that fails, ends the cycle stopped, with its cause and session.
 */
export async function runCard(deck: Deck, plan: Plan, id: string, tree: string, harness: Harness): Promise<CycleEnd> {
  const base = await headSha(tree);
  const reconciler: Session = { harness, id: crypto.randomUUID(), dir: tree };
  let cycle: Cycle = { card: id, base, role: "reconciler", step: "reconcile", sessions: { reconciler: reconciler.id } };
  plan = await writeRecord(plan, { cycle });

  const card = { path: await cardPath(deck, id), text: await cardText(deck, id) };
  const reconciling = reconcilerPrompt(card, { path: plan.document, text: await Bun.file(plan.document).text() });
  let verdict: Answer;
  try {
    verdict = await launch(reconciler, reconciling, RECONCILER, answered);
  } catch (error) {
    if (!(error instanceof RoleFailure)) throw error;
    return { plan, outcome: "stopped", role: "reconciler", session: reconciler, cause: error.message };
  }
  plan = await fileFindings(deck, plan, "reconciler", id, verdict);
  if (verdict.outcome === "stop") {
    const { cause, question } = verdict as { cause: string; question: string };
    return { plan, outcome: "stopped", role: "reconciler", session: reconciler, cause: CAUSES[cause]!, question };
  }
  // The run's log, where the owner reads what the reconciler changed.
  console.log(`${id}: the reconciler proceeded: ${verdict.amended}`);

  let implementer: Session = { harness, id: crypto.randomUUID(), dir: tree };
  cycle = { ...cycle, role: "implementer", step: "implement", sessions: { ...cycle.sessions, implementer: implementer.id } };
  plan = await writeRecord(plan, { cycle });

  // Read after the reconciler has ended, so its amendments reach the implementer.
  let implementing = fill(implement, { CARD_TEXT: await cardText(deck, id) });
  // A fresh implementer is launched; a revision round or a reply resumes it on the work as it left it.
  let answering = launch;
  let rounds = 0;
  let blocking = 0;
  let subject: string;
  let note: string;
  for (;;) {
    let built: Answer;
    try {
      built = await answering(implementer, implementing, IMPLEMENTER, implemented);
    } catch (error) {
      if (!(error instanceof RoleFailure)) throw error;
      return { plan, outcome: "stopped", role: "implementer", session: implementer, cause: error.message };
    }
    plan = await fileFindings(deck, plan, "implementer", id, built);

    if (built.outcome === "blocked") {
      blocking++;
      // Before the reconciler converses, so HEAD is the branch it amends the card to and the work is uncommitted.
      await undoMovedHead(base, tree);
      cycle = { ...cycle, role: "reconciler", step: "converse" };
      plan = await writeRecord(plan, { cycle });
      const conversing = fill(converse, { FINDING: (built.finding as string).trimEnd(), NUMBER: String(blocking) });
      let settled: Answer;
      try {
        settled = await resume(reconciler, conversing, blocking > EXCHANGES ? DISAGREEMENT : CONVERSE, answered);
      } catch (error) {
        if (!(error instanceof RoleFailure)) throw error;
        return { plan, outcome: "stopped", role: "reconciler", session: reconciler, cause: error.message };
      }
      plan = await fileFindings(deck, plan, "reconciler", id, settled);
      if (settled.outcome === "stop") {
        const { cause, question } = settled as { cause: string; question: string };
        return { plan, outcome: "stopped", role: "reconciler", session: reconciler, cause: CAUSES[cause]!, question };
      }
      if (settled.outcome === "reply") {
        cycle = { ...cycle, role: "implementer", step: "implement" };
        plan = await writeRecord(plan, { cycle });
        implementing = fill(reply, { REPLY: (settled.reply as string).trimEnd() });
        answering = resume;
        continue;
      }
      console.log(`${id}: the reconciler amended the card: ${settled.amended}`);
      // Discarded, so the amendment owes nothing to the work it replaces.
      await discard(tree, base);
      implementer = { harness, id: crypto.randomUUID(), dir: tree };
      cycle = { ...cycle, role: "implementer", step: "implement", sessions: { ...cycle.sessions, implementer: implementer.id } };
      plan = await writeRecord(plan, { cycle });
      implementing = fill(implement, { CARD_TEXT: await cardText(deck, id) });
      answering = launch;
      continue;
    }

    const { account } = built as { account: string };
    // Before the diff is taken, so the reviewer sees committed work as uncommitted.
    await undoMovedHead(base, tree);
    await appendRecord(deck, id, "Account", account);

    const reviewer: Session = { harness, id: crypto.randomUUID(), dir: tree };
    cycle = { ...cycle, role: "reviewer", step: "review", sessions: { ...cycle.sessions, reviewer: reviewer.id } };
    plan = await writeRecord(plan, { cycle });

    // The card's record holds every account and every earlier round's feedback.
    const { fields } = readDocument(await Bun.file(plan.document).text());
    const reviewing = fill(review, {
      CARD_TEXT: await cardText(deck, id),
      DIFF: (await uncommittedDiff(tree)).trimEnd(),
      COMMIT_CONVENTION: fields.get("commit-convention") || "(none)",
    });
    let answer: Answer;
    try {
      answer = await launch(reviewer, reviewing, REVIEWER, reviewed);
    } catch (error) {
      if (!(error instanceof RoleFailure)) throw error;
      return { plan, outcome: "stopped", role: "reviewer", session: reviewer, cause: error.message };
    }
    if (answer.outcome !== "revision") {
      try {
        answer = await referenceChecked(deck, reviewer, tree, base, answer);
      } catch (error) {
        if (!(error instanceof RoleFailure)) throw error;
        return { plan, outcome: "stopped", role: "reviewer", session: reviewer, cause: error.message };
      }
      // From the answer that passed, which restates the reviewer's whole report.
      plan = await fileFindings(deck, plan, "reviewer", id, answer);
      ({ subject, close_note: note } = answer as { subject: string; close_note: string });
      break;
    }
    plan = await fileFindings(deck, plan, "reviewer", id, answer);

    const { feedback } = answer as { feedback: string };
    await appendRecord(deck, id, "Review feedback", feedback);
    if (rounds === REVISION_ROUNDS) {
      const cause = `the reviewer still asked for a revision after ${REVISION_ROUNDS} revision rounds, the most a card gets`;
      return { plan, outcome: "stopped", role: "reviewer", session: reviewer, cause, feedback };
    }
    rounds++;
    // The reconciler is not brought back: the card is the contract it was.
    cycle = { ...cycle, role: "implementer", step: "implement" };
    plan = await writeRecord(plan, { cycle });
    implementing = fill(revise, { FEEDBACK: feedback.trimEnd() });
    answering = resume;
  }

  cycle = { ...cycle, step: "land", subject, note };
  plan = await writeRecord(plan, { cycle });
  // `referenceChecked` undid any commit of the reviewer's before it read the diff.
  const sha = await land(subject, note, tree);
  plan = await writeRecord(plan, { cycle: { ...cycle, commit: sha } });
  await closeCard(deck, id, "done", note);
  return { plan, outcome: "landed", sha };
}
