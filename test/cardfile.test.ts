import { afterAll, expect, test } from "bun:test";
import path from "node:path";
import { createCard, escapePasted, formatCard, parseCard, readCard, refuseHeadlines } from "../src/cardfile.ts";
import { removeTempDirs, tempDir } from "./helpers.ts";

afterAll(removeTempDirs);

const FULL = `---
labels: [PROJ-123, work-laptop]
blocked-by: [PROJ-behilo]
---

# One headline, never wrapped, the only \`# \` line in the file.

Body, one sentence per line, \`##\` for any subheading.

## A subheading

More prose.
`;

const BARE = `# A card with no frontmatter at all.

Just prose.
`;

test("reads the two fields, the headline and the body", () => {
  const card = parseCard(FULL);
  expect(card.labels).toEqual(["PROJ-123", "work-laptop"]);
  expect(card.blockedBy).toEqual(["PROJ-behilo"]);
  expect(card.headline).toBe("One headline, never wrapped, the only `# ` line in the file.");
  expect(card.body).toStartWith("Body, one sentence per line");
  expect(card.body).toEndWith("More prose.\n");
});

test("both fields may be absent", () => {
  const card = parseCard(BARE);
  expect(card.labels).toEqual([]);
  expect(card.blockedBy).toEqual([]);
  expect(card.headline).toBe("A card with no frontmatter at all.");
});

test("round-tripping does not reformat", () => {
  for (const text of [
    FULL,
    BARE,
    "# Headline only.\n",
    "---\nlabels: [a]\n---\n\n# Labels only.\n",
    "---\nlabels: [a]\nclosed: declined\n---\n\n# Closed and labelled.\n",
  ]) {
    expect(formatCard(parseCard(text))).toBe(text);
  }
});

test("writes fields on one line each, as flow sequences", () => {
  expect(formatCard({ labels: ["a", "b"], blockedBy: ["c"], headline: "H.", body: "" })).toBe(
    "---\nlabels: [a, b]\nblocked-by: [c]\n---\n\n# H.\n",
  );
});

test("reads how a closed card ended, and leaves an open one saying nothing", () => {
  expect(parseCard("---\nclosed: moot\n---\n\n# H.\n").closed).toBe("moot");
  expect(parseCard(FULL).closed).toBeUndefined();
  expect(parseCard(BARE).closed).toBeUndefined();
});

test("rejects an outcome that is not one of the four", () => {
  expect(() => parseCard("---\nclosed: finished\n---\n\n# H.\n")).toThrow(
    /`finished` is not one of done, promoted, declined, moot/,
  );
});

test("rejects a block sequence, which `^labels:` could not grep", () => {
  expect(() => parseCard("---\nlabels:\n  - a\n---\n\n# H.\n")).toThrow(/flow sequence/);
});

test("rejects a field the format does not have", () => {
  expect(() => parseCard("---\nkind: defect\n---\n\n# H.\n")).toThrow(/unknown frontmatter field/);
});

test("rejects a card with no headline", () => {
  expect(() => parseCard("no headline here\n")).toThrow(/no `# ` headline/);
  expect(() => parseCard("---\nlabels: [a]\n---\n\n## Not a headline\n")).toThrow(/no `# ` headline/);
});

test("rejects a card whose headline is empty", () => {
  expect(() => parseCard("# \n\nBody.\n")).toThrow(/headline is empty/);
  expect(() => parseCard("---\nlabels: [a]\n---\n\n#    \n")).toThrow(/headline is empty/);
});

test("rejects a card with a second `# ` line, naming it", () => {
  expect(() => parseCard("# One\n\nProse.\n\n# Two\n")).toThrow(/`# Two`/);
});

test("refuses to write a card the parser would refuse", () => {
  const card = { labels: [], blockedBy: [], headline: "One.", body: "" };
  expect(() => formatCard({ ...card, headline: "  " })).toThrow(/headline is empty/);
  expect(() => formatCard({ ...card, headline: "One\nTwo" })).toThrow(/never wraps/);
  expect(() => formatCard({ ...card, body: "Prose.\n\n# Two\n" })).toThrow(/`# Two`/);
});

test("the `# `-line check names every line starting `# `, and passes `#` lines that are not", () => {
  expect(() => refuseHeadlines("note", "a\n# One\nb\n# Two\n")).toThrow(/note .*`# One`, `# Two`$/);
  expect(() => refuseHeadlines("note", "## Sub\n#hash\n#\n  # indented\n")).not.toThrow();
});

test("a `# ` line inside a fenced code block is no headline, to the check and the parser alike", () => {
  const fenced = "Ran:\n\n```sh\n# a comment\necho hi\n```\n\n~~~~\n# another\n```\n# still fenced\n~~~~\n";
  expect(() => refuseHeadlines("note", fenced)).not.toThrow();
  expect(() => refuseHeadlines("note", `${fenced}# Out\n`)).toThrow(/`# Out`$/);
  expect(parseCard(`# The card\n\n${fenced}`)).toEqual({ labels: [], blockedBy: [], headline: "The card", body: fenced });
});

test("pasted text has its headings outside a fence shifted alike so the shallowest is level 3, and every other line left as it was", () => {
  const text = "# Title\n\nProse # not a heading.\n## Sub\n#hash\n  # Indented\n#\n##### Deep\n\n```\n# a comment\n```\nSetext\n===\n";
  const escaped = "### Title\n\nProse # not a heading.\n#### Sub\n#hash\n  ### Indented\n###\n###### Deep\n\n```\n# a comment\n```\nSetext\n===\n";
  expect(escapePasted(text)).toBe(escaped);
  expect(escapePasted(escaped)).toBe(escaped);
  expect(escapePasted("##### Five\n###### Six\n")).toBe("##### Five\n###### Six\n");
  expect(() => refuseHeadlines("note", escapePasted(text))).not.toThrow();
});

test("pasted text that leaves a fence open has it closed at its end, with the fence it opened", () => {
  expect(escapePasted("Ran:\n\n````sh\n# a comment\n```\n")).toBe("Ran:\n\n````sh\n# a comment\n```\n````\n");
  expect(escapePasted("~~~\n## Account")).toBe("~~~\n## Account\n~~~");
});

test("rejects a value that could not be written back", () => {
  const card = { labels: ["a, b"], blockedBy: [], headline: "H.", body: "" };
  expect(() => formatCard(card)).toThrow(/cannot be written/);
});

test("createCard fails rather than overwriting", async () => {
  const dir = tempDir();
  const file = path.join(dir, "proj-behilo.md");
  const card = { labels: [], blockedBy: [], headline: "First.", body: "" };

  await createCard(file, card);
  expect((await readCard(file)).headline).toBe("First.");

  await expect(createCard(file, { ...card, headline: "Second." })).rejects.toThrow(/EEXIST/);
  expect((await readCard(file)).headline).toBe("First.");
});

test("a malformed card names its own path", async () => {
  const dir = tempDir();
  const file = path.join(dir, "proj-bad.md");
  await Bun.write(file, "---\nkind: defect\n---\n\n# H.\n");

  await expect(readCard(file)).rejects.toThrow(file);
});
