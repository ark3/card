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
 * Whether each line of `text` starts `# ` outside a fenced code block, where
 * it would read as a headline; a fenced line is code, such as a shell comment.
 * A fence closes on a line of its own character, at least as long, and an
 * unclosed one runs to the end of the text.
 */
function headlineLines(text: string): boolean[] {
  let fence: string | null = null;
  return text.split("\n").map((line) => {
    if (fence === null) {
      const open = FENCE.exec(line);
      if (open !== null) fence = open[1]!;
      return open === null && line.startsWith("# ");
    }
    const close = FENCE.exec(line);
    if (close !== null && close[1]![0] === fence[0] && close[1]!.length >= fence.length && line.trim() === close[1]) fence = null;
    return false;
  });
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

/**
 * `text` with each line `refuseHeadlines` would refuse made a `## ` line, for
 * text the tool takes from a session into a card, so a session's heading
 * costs it no refusal. Fenced lines are left as they are, since rewriting
 * them would change the code they show.
 */
export function demoteHeadlines(text: string): string {
  const marked = headlineLines(text);
  return text
    .split("\n")
    .map((line, index) => (marked[index] ? `#${line}` : line))
    .join("\n");
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
