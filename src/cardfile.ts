import { writeFile } from "node:fs/promises";

/**
 * A card, as `reference/brief-2026-08-20.md` "What this project changes about
 * the format" defines it: two optional list-valued frontmatter fields, one
 * `# ` headline, and prose — and `closed`, the one field `deck close` writes
 * rather than the owner.
 */
export type Card = {
  labels: string[];
  blockedBy: string[];
  /** How the card ended, on a card `close` has already moved to `closed/`. */
  closed?: string;
  headline: string;
  /** Everything after the headline, verbatim, without its leading blank line. */
  body: string;
};

const FLOW_SEQUENCE = /^\[(.*)\]$/;
/** The outcomes `deck close` takes, and the only values `closed` can hold. */
export const OUTCOMES = ["done", "promoted", "declined", "moot"] as const;
export type Outcome = (typeof OUTCOMES)[number];
// A value that would need quoting to survive the flow-sequence grammar, or a
// line break that would break `^labels:` as a grep.
const UNWRITABLE = /[,[\]\n]/;

function parseList(field: string, raw: string): string[] {
  const match = FLOW_SEQUENCE.exec(raw.trim());
  if (match === null) {
    throw new Error(`${field}: must be a one-line flow sequence, as in \`${field}: [a, b]\``);
  }
  return match[1]!
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function formatList(field: string, values: string[]): string {
  for (const value of values) {
    if (UNWRITABLE.test(value) || value.trim() !== value) {
      throw new Error(`${field}: \`${value}\` cannot be written as a flow-sequence value`);
    }
  }
  return `${field}: [${values.join(", ")}]`;
}

function parseOutcome(raw: string): string {
  const outcome = raw.trim();
  if (!(OUTCOMES as readonly string[]).includes(outcome)) {
    throw new Error(`closed: \`${outcome}\` is not one of ${OUTCOMES.join(", ")}`);
  }
  return outcome;
}

// A fence's opening line, by CommonMark: up to three spaces, then three or
// more backticks or tildes.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Which lines of `text` belong to a fenced code block, its opening and
 * closing lines included, and the fence still open at the end of the text,
 * null where none is. A fence closes on a line of its own character, at least
 * as long, and an unclosed one runs to the end of the text. Every reader of a
 * card's structure decides what is code by this one rule, so text the tool
 * pastes cannot read as code to one and as structure to another.
 */
export function fences(text: string): { fenced: boolean[]; open: string | null } {
  let open: string | null = null;
  const fenced = text.split("\n").map((line) => {
    const match = FENCE.exec(line);
    if (open === null) {
      if (match !== null) open = match[1]!;
      return match !== null;
    }
    if (match !== null && match[1]![0] === open[0] && match[1]!.length >= open.length && line.trim() === match[1]) open = null;
    return true;
  });
  return { fenced, open };
}

/**
 * Whether each line of `text` starts `# ` outside a fenced code block, where
 * it would read as a headline; a fenced line is code, such as a shell comment.
 */
function headlineLines(text: string): boolean[] {
  const { fenced } = fences(text);
  return text.split("\n").map((line, index) => !fenced[index] && line.startsWith("# "));
}

/**
 * Refuses `text`, naming `what` it is and every line in it that starts `# `
 * outside a fenced code block, since a card's one such line is its headline.
 * Run on any text before it becomes part of a card, so the rule holds when a
 * card is written rather than surfacing as an unreadable card at its next
 * read.
 */
export function refuseHeadlines(what: string, text: string): void {
  const marked = headlineLines(text);
  const lines = text.split("\n").filter((_, index) => marked[index]);
  if (lines.length === 0) return;
  throw new Error(
    `${what} has a line starting \`# \`, which only a card's headline may: ${lines.map((line) => `\`${line}\``).join(", ")}`,
  );
}

// An ATX heading's marker, by CommonMark: up to three spaces, then one to six
// `#`, then a space, a tab or the end of the line.
const HEADING = /^( {0,3})(#{1,6})(?=[ \t]|$)/;
// The level of the shallowest heading pasted text keeps, below the `## `
// section the tool writes it under.
const PASTED_LEVEL = 3;

/**
 * `text` as the tool pastes it from a session into a card, inert to every
 * reader of the card's structure. Outside fences, each heading is shifted
 * down by the one number of levels that brings the shallowest to level 3, so
 * the text's headings become subheadings of the section it is written under,
 * in their own relative structure, and no line can read as the headline or a
 * record boundary; a heading the shift would take past level 6, the deepest
 * Markdown has, stops at 6. Text whose headings are all level 3 or deeper is
 * left as it is, so pasting twice changes nothing. A fence the text leaves
 * open is closed at its end, so it cannot hide what the tool writes after
 * it. Fenced lines are left as they are, since rewriting them would change
 * the code they show.
 */
export function escapePasted(text: string): string {
  const lines = text.split("\n");
  const { fenced } = fences(text);
  // Each line's heading level, 0 for a line that is no heading.
  const levels = lines.map((line, index) => (fenced[index] ? 0 : (HEADING.exec(line)?.[2]!.length ?? 0)));
  const headed = levels.filter((level) => level > 0);
  const shift = headed.length === 0 ? 0 : Math.max(0, PASTED_LEVEL - Math.min(...headed));
  const shifted = lines.map((line, index) =>
    levels[index] === 0 ? line : line.replace(HEADING, (_, indent: string) => `${indent}${"#".repeat(Math.min(6, levels[index]! + shift))}`),
  );
  return closeFence(shifted.join("\n"));
}

/**
 * `text` with the fence it leaves open, if any, closed on a line of its own
 * at its end, for text the tool writes more below.
 */
export function closeFence(text: string): string {
  const { open } = fences(text);
  if (open === null) return text;
  return text.endsWith("\n") ? `${text}${open}\n` : `${text}\n${open}`;
}

/** Refuses `headline` as a card's headline: empty, or more than one line. */
export function refuseHeadline(headline: string): void {
  if (headline.trim() === "") throw new Error("the card's headline is empty");
  if (headline.includes("\n")) throw new Error("a headline is one line and never wraps");
}

export function parseCard(text: string): Card {
  let rest = text;
  let labels: string[] = [];
  let blockedBy: string[] = [];
  let closed: string | undefined;

  if (rest.startsWith("---\n")) {
    const end = rest.indexOf("\n---\n", 3);
    if (end === -1) throw new Error("frontmatter is never closed");
    for (const line of rest.slice(4, end + 1).split("\n")) {
      if (line.trim() === "") continue;
      const colon = line.indexOf(":");
      if (colon === -1) throw new Error(`frontmatter line is not a field: \`${line}\``);
      const field = line.slice(0, colon);
      const value = line.slice(colon + 1);
      if (field === "labels") labels = parseList(field, value);
      else if (field === "blocked-by") blockedBy = parseList(field, value);
      else if (field === "closed") closed = parseOutcome(value);
      else throw new Error(`unknown frontmatter field \`${field}\``);
    }
    rest = rest.slice(end + 5);
  }

  rest = rest.replace(/^\n+/, "");
  const breakAt = rest.indexOf("\n");
  const first = breakAt === -1 ? rest : rest.slice(0, breakAt);
  if (!first.startsWith("# ")) throw new Error("card has no `# ` headline");
  const headline = first.slice(2).trim();
  refuseHeadline(headline);
  const body = breakAt === -1 ? "" : rest.slice(breakAt + 1).replace(/^\n+/, "");
  refuseHeadlines("the card's body", body);

  return {
    labels,
    blockedBy,
    ...(closed === undefined ? {} : { closed }),
    headline,
    body,
  };
}

export function formatCard(card: Card): string {
  refuseHeadline(card.headline);
  refuseHeadlines("the card's body", card.body);
  const fields = [];
  if (card.labels.length > 0) fields.push(formatList("labels", card.labels));
  if (card.blockedBy.length > 0) fields.push(formatList("blocked-by", card.blockedBy));
  if (card.closed !== undefined) fields.push(`closed: ${card.closed}`);

  const frontmatter = fields.length === 0 ? "" : `---\n${fields.join("\n")}\n---\n\n`;
  const body = card.body.trim() === "" ? "" : `\n${card.body.replace(/\n*$/, "\n")}`;
  return `${frontmatter}# ${card.headline}\n${body}`;
}

export async function readCard(path: string): Promise<Card> {
  try {
    return parseCard(await Bun.file(path).text());
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Writes a card that does not exist yet, and fails rather than overwriting. */
export async function createCard(path: string, card: Card): Promise<void> {
  await writeFile(path, formatCard(card), { flag: "wx" });
}
