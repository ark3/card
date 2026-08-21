import { afterAll, expect, test } from "bun:test";
import path from "node:path";
import { createCard, formatCard, parseCard, readCard } from "../src/cardfile.ts";
import { removeTempDirs, tempDir } from "./helpers.ts";

afterAll(removeTempDirs);

const FULL = `---
labels: [PROJ-123, work-laptop]
blocked-by: [PROJ-behilo]
---

# One headline, never wrapped, the only \`# \` line in the file.

Body, wrapped at eighty columns, \`##\` for any subheading.

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
  expect(card.body).toStartWith("Body, wrapped at eighty columns");
  expect(card.body).toEndWith("More prose.\n");
});

test("both fields may be absent", () => {
  const card = parseCard(BARE);
  expect(card.labels).toEqual([]);
  expect(card.blockedBy).toEqual([]);
  expect(card.headline).toBe("A card with no frontmatter at all.");
});

test("round-tripping does not reformat", () => {
  for (const text of [FULL, BARE, "# Headline only.\n", "---\nlabels: [a]\n---\n\n# Labels only.\n"]) {
    expect(formatCard(parseCard(text))).toBe(text);
  }
});

test("writes fields on one line each, as flow sequences", () => {
  expect(formatCard({ labels: ["a", "b"], blockedBy: ["c"], headline: "H.", body: "" })).toBe(
    "---\nlabels: [a, b]\nblocked-by: [c]\n---\n\n# H.\n",
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
