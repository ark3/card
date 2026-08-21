import { writeFile } from "node:fs/promises";

/**
 * A card, as `PLAN.md` "What a card is" defines it: two optional list-valued
 * frontmatter fields, one `# ` headline, and prose.
 */
export type Card = {
  labels: string[];
  blockedBy: string[];
  headline: string;
  /** Everything after the headline, verbatim, without its leading blank line. */
  body: string;
};

const FLOW_SEQUENCE = /^\[(.*)\]$/;
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

export function parseCard(text: string): Card {
  let rest = text;
  let labels: string[] = [];
  let blockedBy: string[] = [];

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
      else throw new Error(`unknown frontmatter field \`${field}\``);
    }
    rest = rest.slice(end + 5);
  }

  rest = rest.replace(/^\n+/, "");
  const breakAt = rest.indexOf("\n");
  const first = breakAt === -1 ? rest : rest.slice(0, breakAt);
  if (!first.startsWith("# ")) throw new Error("card has no `# ` headline");

  return {
    labels,
    blockedBy,
    headline: first.slice(2).trim(),
    body: breakAt === -1 ? "" : rest.slice(breakAt + 1).replace(/^\n+/, ""),
  };
}

export function formatCard(card: Card): string {
  const fields = [];
  if (card.labels.length > 0) fields.push(formatList("labels", card.labels));
  if (card.blockedBy.length > 0) fields.push(formatList("blocked-by", card.blockedBy));

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
