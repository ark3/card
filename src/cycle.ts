import implement from "../payload/implement.md" with { type: "text" };
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
export type Role = "implementer" | "reviewer";

/**
 * Where a cycle is: the implementer's turn, the reviewer's, or landing the
 * reviewer's answer, which is under the reviewer because its subject and note
 * are what lands.
 */
export type Step = "implement" | "review" | "land";

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

/** How a cycle ended, and the plan as it then stands. */
export type CycleEnd = { plan: Plan } & (
  | { outcome: "landed"; sha: string }
  | { outcome: "stopped"; role: Role; session: Session; cause: string }
);

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

async function cardText(deck: Deck, id: string): Promise<string> {
  const found = await locate(deck, id);
  if (found === null) throw new Error(`no card ${id} in ${deck.deckDir}`);
  return (await Bun.file(found.path).text()).trimEnd();
}

/**
 * Runs the card `id` through one cycle in the plan's worktree `tree`: a fresh
 * implementer, whose account is appended to the card, then a fresh reviewer,
 * whose subject and close note land the worktree as the card's one commit
 * before the card closes done. Neither role is shown the plan document; the
 * reviewer gets its commit convention alone. A role that fails ends the cycle
 * stopped, with its cause and session.
 */
export async function runCard(deck: Deck, plan: Plan, id: string, tree: string, harness: Harness): Promise<CycleEnd> {
  const base = await headSha(tree);
  const implementer: Session = { harness, id: crypto.randomUUID(), dir: tree };
  let cycle: Cycle = { card: id, base, role: "implementer", step: "implement", sessions: { implementer: implementer.id } };
  plan = await writeRecord(plan, { cycle });

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
