import implement from "../payload/implement.md" with { type: "text" };
import reconcile from "../payload/reconcile.md" with { type: "text" };
import review from "../payload/review.md" with { type: "text" };
import type { Answer, ObjectSchema } from "./answer.ts";
import { refuseHeadlines } from "./cardfile.ts";
import { type Deck, locate } from "./deck.ts";
import { readDocument } from "./document.ts";
import { headSha } from "./git.ts";
import { type Check, type Harness, launch, RoleFailure, type Session } from "./harness.ts";
import { land, uncommittedDiff, undoMovedHead } from "./landing.ts";
import { appendRecord, closeCard } from "./operations.ts";
import { fill } from "./payload.ts";
import { type Plan, writeRecord } from "./plan.ts";

/** The roles of one card's cycle. */
export type Role = "reconciler" | "implementer" | "reviewer";

/**
 * Where a cycle is: the reconciler's turn, the implementer's, the reviewer's,
 * or landing the reviewer's answer, which is under the reviewer because its
 * subject and note are what lands.
 */
export type Step = "reconcile" | "implement" | "review" | "land";

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
  /** Each role's session id, recorded before the session is launched. */
  sessions: Partial<Record<Role, string>>;
  /**
   * The reviewer's subject and close note, recorded with step land, so a card
   * whose commit lands and whose run dies before it closes closes from them.
   */
  subject?: string;
  note?: string;
  /** The card's commit, recorded once it lands and before the card closes. */
  commit?: string;
};

/**
 * How a cycle ended, and the plan as it then stands. A reconciler that stops
 * the run asks the owner `question`; a role that fails asks nothing.
 */
export type CycleEnd = { plan: Plan } & (
  | { outcome: "landed"; sha: string }
  | { outcome: "stopped"; role: Role; session: Session; cause: string; question?: string }
);

/**
 * The reconciler's answer. Which fields go with which outcome, a schema of
 * this subset cannot state, so `reconciled` checks it.
 */
export const RECONCILER: ObjectSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["proceed", "stop"] },
    amended: { type: "string" },
    cause: { type: "string", enum: ["intent", "order"] },
    question: { type: "string" },
  },
  required: ["outcome"],
};

/** The fields each of the reconciler's outcomes carries. */
const CARRIES: Record<string, string[]> = { proceed: ["amended"], stop: ["cause", "question"] };

/** Refuses a reconciler's answer that lacks a field its outcome carries. */
const reconciled: Check = (answer: Answer) => {
  for (const field of CARRIES[answer.outcome as string]!) {
    if (field in answer) continue;
    throw new Error(`answer lacks the field ${JSON.stringify(field)}, which outcome ${JSON.stringify(answer.outcome)} carries`);
  }
};

/** Each cause a reconciler stops on, as the owner reads it. */
const CAUSES: Record<string, string> = {
  intent: "the card's intent itself is wrong, which only the owner can change",
  order: "the card depends on work no earlier card has landed, a problem of order for authoring to fix",
};

const IMPLEMENTER: ObjectSchema = {
  type: "object",
  properties: { outcome: { type: "string", enum: ["done"] }, account: { type: "string" } },
  required: ["outcome", "account"],
};

const REVIEWER: ObjectSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["approved", "fixed"] },
    subject: { type: "string" },
    close_note: { type: "string" },
  },
  required: ["outcome", "subject", "close_note"],
};

/**
 * Refuses an answer whose `fields` hold a line starting `# `, while the role
 * can still repair it, rather than when the text is written into the card
 * after the role has ended.
 */
function noHeadlines(...fields: string[]): Check {
  return (answer: Answer) => {
    for (const field of fields) refuseHeadlines(`answer.${field}`, answer[field] as string);
  };
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
 * worktree as the card's one commit before the card closes done. Neither the
 * implementer nor the reviewer is shown the plan document; the reviewer gets
 * its commit convention alone. A reconciler that stops, or a role that fails,
 * ends the cycle stopped, with its cause and session.
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
    verdict = await launch(reconciler, reconciling, RECONCILER, reconciled);
  } catch (error) {
    if (!(error instanceof RoleFailure)) throw error;
    return { plan, outcome: "stopped", role: "reconciler", session: reconciler, cause: error.message };
  }
  if (verdict.outcome === "stop") {
    const { cause, question } = verdict as { cause: string; question: string };
    return { plan, outcome: "stopped", role: "reconciler", session: reconciler, cause: CAUSES[cause]!, question };
  }
  // The run's log, where the owner reads what the reconciler changed.
  console.log(`${id}: the reconciler proceeded: ${verdict.amended}`);

  const implementer: Session = { harness, id: crypto.randomUUID(), dir: tree };
  cycle = { ...cycle, role: "implementer", step: "implement", sessions: { ...cycle.sessions, implementer: implementer.id } };
  plan = await writeRecord(plan, { cycle });

  // Read after the reconciler has ended, so its amendments reach the implementer.
  const implementing = fill(implement, { CARD_TEXT: await cardText(deck, id) });
  let account: string;
  try {
    ({ account } = (await launch(implementer, implementing, IMPLEMENTER, noHeadlines("account"))) as { account: string });
  } catch (error) {
    if (!(error instanceof RoleFailure)) throw error;
    return { plan, outcome: "stopped", role: "implementer", session: implementer, cause: error.message };
  }
  // Before the diff is taken, so the reviewer sees committed work as uncommitted.
  await undoMovedHead(base, tree);
  await appendRecord(deck, id, "Account", account);

  const reviewer: Session = { harness, id: crypto.randomUUID(), dir: tree };
  cycle = { ...cycle, role: "reviewer", step: "review", sessions: { ...cycle.sessions, reviewer: reviewer.id } };
  plan = await writeRecord(plan, { cycle });

  const { fields } = readDocument(await Bun.file(plan.document).text());
  const reviewing = fill(review, {
    CARD_TEXT: await cardText(deck, id),
    DIFF: (await uncommittedDiff(tree)).trimEnd(),
    COMMIT_CONVENTION: fields.get("commit-convention") || "(none)",
  });
  let subject: string;
  let note: string;
  try {
    const answer = await launch(reviewer, reviewing, REVIEWER, noHeadlines("subject", "close_note"));
    ({ subject, close_note: note } = answer as { subject: string; close_note: string });
  } catch (error) {
    if (!(error instanceof RoleFailure)) throw error;
    return { plan, outcome: "stopped", role: "reviewer", session: reviewer, cause: error.message };
  }

  cycle = { ...cycle, step: "land", subject, note };
  plan = await writeRecord(plan, { cycle });
  // A reviewer committing its fixes would otherwise give the card two commits.
  await undoMovedHead(base, tree);
  const sha = await land(subject, note, tree);
  plan = await writeRecord(plan, { cycle: { ...cycle, commit: sha } });
  await closeCard(deck, id, "done", note);
  return { plan, outcome: "landed", sha };
}
