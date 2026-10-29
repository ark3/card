import { afterAll, beforeEach, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { readCard } from "../src/cardfile.ts";
import { createDeck, locate } from "../src/deck.ts";
import { citedIds } from "../src/id.ts";
import { appendRecord, closeCard, fileCard, listCards, reopenCard } from "../src/operations.ts";
import { clearCardRoot, removeTempDirs, tempRepo } from "./helpers.ts";

beforeEach(clearCardRoot);
afterAll(removeTempDirs);

test("files, reads, lists and closes a card with explicit inputs and no stdin", async () => {
  const deck = await createDeck(await tempRepo(), "proj");

  const blocker = await fileCard(deck, { headline: "Land first", labels: [], blockedBy: [], body: "Grounding.\n" });
  const waiting = await fileCard(deck, {
    headline: "Wait for it",
    labels: ["T-1"],
    blockedBy: [blocker],
    body: "More.\n",
  });

  const found = await locate(deck, waiting);
  expect(found).toEqual({ path: path.join(deck.openDir, `${waiting}.md`), closed: false });
  expect(await readCard(found!.path)).toEqual({
    labels: ["T-1"],
    blockedBy: [blocker],
    headline: "Wait for it",
    body: "More.\n",
  });

  const ready = await listCards(deck, "ready", []);
  expect(ready.listed.map((entry) => entry.id)).toEqual([blocker]);
  expect(ready.blocked).toBe(1);
  expect(ready.warnings).toEqual([]);

  const report = await closeCard(deck, blocker, "done", "Landed in abc1234.");
  expect(report).toEqual({ dependents: [{ id: waiting, headline: "Wait for it" }], heldShut: [], warnings: [] });
  expect(await locate(deck, blocker)).toEqual({ path: path.join(deck.closedDir, `${blocker}.md`), closed: true });

  const closed = await listCards(deck, "closed", []);
  expect(closed.listed.map((entry) => [entry.id, entry.card.closed])).toEqual([[blocker, "done"]]);
});

test("lists a bad file and a dangling blocker as warnings, not on the console", async () => {
  const deck = await createDeck(await tempRepo(), "proj");
  await Bun.write(path.join(deck.openDir, "proj-fanovi.md"), "---\nkind: [chore]\n---\n\n# Typo\n\nBody.\n");
  await Bun.write(path.join(deck.openDir, "proj-vezipo.md"), "---\nblocked-by: [proj-nosuch]\n---\n\n# Dangling\n\nBody.\n");

  const { listed, warnings } = await listCards(deck, "open", []);

  expect(listed.map((entry) => entry.id)).toEqual(["proj-vezipo"]);
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toStartWith("skipped ");
  expect(warnings[0]).toContain("proj-fanovi.md: unknown frontmatter field `kind`");
  expect(warnings[1]).toBe("proj-vezipo is blocked by proj-nosuch, which is in neither open/ nor closed/");
});

test("close returns the dependents another open blocker holds shut, and the dangling blocker as a warning", async () => {
  const deck = await createDeck(await tempRepo(), "proj");
  await Bun.write(path.join(deck.openDir, "proj-behilo.md"), "# The card being closed\n\nBody.\n");
  await Bun.write(path.join(deck.openDir, "proj-lakito.md"), "# The other blocker\n\nBody.\n");
  await Bun.write(
    path.join(deck.openDir, "proj-dumoka.md"),
    "---\nblocked-by: [proj-behilo, proj-lakito]\n---\n\n# Still shut\n\nBody.\n",
  );
  await Bun.write(
    path.join(deck.openDir, "proj-hitowa.md"),
    "---\nblocked-by: [proj-behilo, proj-nosuch]\n---\n\n# Blocker never existed\n\nBody.\n",
  );

  const report = await closeCard(deck, "proj-behilo", "done", "Landed.");

  expect(report.dependents).toEqual([]);
  expect(report.heldShut).toEqual([
    { id: "proj-dumoka", headline: "Still shut" },
    { id: "proj-hitowa", headline: "Blocker never existed" },
  ]);
  expect(report.warnings).toEqual([
    "proj-hitowa is blocked by proj-nosuch, which is in neither open/ nor closed/",
  ]);
});

test("the id check names each distinct id the text cites, once", () => {
  expect(citedIds("Fixes proj-behilo, and proj-vazuku; also proj-behilo again.", "proj")).toEqual([
    "proj-behilo",
    "proj-vazuku",
  ]);
  expect(citedIds("Rename proj-behilonger, see other-behilo.", "proj")).toEqual([]);
});

test("filing a body with a `# ` line refuses, naming the line, and writes nothing", async () => {
  const deck = await createDeck(await tempRepo(), "proj");

  await expect(
    fileCard(deck, { headline: "One", labels: [], blockedBy: [], body: "Prose.\n\n# Two\n" }),
  ).rejects.toThrow(/`# Two`/);

  expect(await Array.fromAsync(new Bun.Glob("*").scan({ cwd: deck.openDir, dot: true }))).toEqual([]);
});

test("a close note with a `# ` line refuses, naming the line, and leaves the card where it was", async () => {
  const deck = await createDeck(await tempRepo(), "proj");
  const card = "# The card being closed\n\nBody.\n";
  const file = path.join(deck.openDir, "proj-behilo.md");
  await Bun.write(file, card);

  await expect(closeCard(deck, "proj-behilo", "done", "Landed.\n# Not a headline")).rejects.toThrow(
    /`# Not a headline`/,
  );

  expect(await Bun.file(file).text()).toBe(card);
  expect(await Array.fromAsync(new Bun.Glob("*").scan({ cwd: deck.closedDir, dot: true }))).toEqual([]);
});

test("reads a closed card that carries no `closed:` line", async () => {
  const deck = await createDeck(await tempRepo(), "proj");
  await Bun.write(path.join(deck.closedDir, "proj-behilo.md"), "# Closed before close recorded it\n\nBody.\n");

  const { listed, warnings } = await listCards(deck, "closed", []);

  expect(listed.map((entry) => [entry.id, entry.card.closed])).toEqual([["proj-behilo", undefined]]);
  expect(warnings).toEqual([]);
});

test("closing, reopening and closing again leaves one closed: line and two close notes, in order", async () => {
  const deck = await createDeck(await tempRepo(), "proj");
  const file = path.join(deck.openDir, "proj-behilo.md");
  await Bun.write(file, "---\nlabels: [T-1]\n---\n\n# The card\n\nBody.\n");

  await closeCard(deck, "proj-behilo", "done", "First.");
  await reopenCard(deck, "proj-behilo");

  // Back in open/ with its outcome gone and everything below the frontmatter
  // kept, the first close note included.
  expect(await Bun.file(path.join(deck.closedDir, "proj-behilo.md")).exists()).toBe(false);
  expect(await Bun.file(file).text()).toBe(
    "---\nlabels: [T-1]\n---\n\n# The card\n\nBody.\n\n## Close note\n\nFirst.\n",
  );

  await closeCard(deck, "proj-behilo", "moot", "Second.");

  expect(await Bun.file(path.join(deck.closedDir, "proj-behilo.md")).text()).toBe(
    "---\nlabels: [T-1]\nclosed: moot\n---\n\n# The card\n\nBody.\n\n## Close note\n\nFirst.\n\n## Close note\n\nSecond.\n",
  );
});

test("reopening drops the frontmatter close opened, once removing closed: leaves it empty", async () => {
  const deck = await createDeck(await tempRepo(), "proj");
  await Bun.write(path.join(deck.openDir, "proj-behilo.md"), "# No fields\n\nBody.\n");

  await closeCard(deck, "proj-behilo", "declined", "Not now.");
  await reopenCard(deck, "proj-behilo");

  expect(await Bun.file(path.join(deck.openDir, "proj-behilo.md")).text()).toBe(
    "# No fields\n\nBody.\n\n## Close note\n\nNot now.\n",
  );
});

test("reopening refuses a card that is open, and one that is nowhere", async () => {
  const deck = await createDeck(await tempRepo(), "proj");
  await Bun.write(path.join(deck.openDir, "proj-behilo.md"), "# Open\n\nBody.\n");

  await expect(reopenCard(deck, "proj-behilo")).rejects.toThrow(/proj-behilo is already open/);
  await expect(reopenCard(deck, "proj-nosuch")).rejects.toThrow(/no card proj-nosuch/);
});

test("an interruption of a reopen leaves the closed card whole, and never a reopened card half-written", async () => {
  const deck = await createDeck(await tempRepo(), "proj");
  const closedText = "---\nclosed: done\n---\n\n# Closed\n\nBody.\n\n## Close note\n\nDone.\n";
  const closedFile = path.join(deck.closedDir, "proj-behilo.md");
  await Bun.write(closedFile, closedText);

  // `open/` unwritable stops the reopen at its first write, the staged copy.
  await chmod(deck.openDir, 0o555);
  try {
    await expect(reopenCard(deck, "proj-behilo")).rejects.toThrow(/EACCES/);
  } finally {
    await chmod(deck.openDir, 0o755);
  }
  expect(await Bun.file(closedFile).text()).toBe(closedText);
  expect(await Array.fromAsync(new Bun.Glob("*").scan({ cwd: deck.openDir, dot: true }))).toEqual([]);

  // `closed/` unwritable lets the reopened card be renamed into `open/`, then
  // stops the reopen at the unlink.
  await chmod(deck.closedDir, 0o555);
  try {
    await expect(reopenCard(deck, "proj-behilo")).rejects.toThrow(/EACCES/);
  } finally {
    await chmod(deck.closedDir, 0o755);
  }
  expect(await Bun.file(closedFile).text()).toBe(closedText);
  expect(await Bun.file(path.join(deck.openDir, "proj-behilo.md")).text()).toBe(
    "# Closed\n\nBody.\n\n## Close note\n\nDone.\n",
  );
});

test("a record section lands at the end of the card, every byte above it kept", async () => {
  const deck = await createDeck(await tempRepo(), "proj");
  const byHand = "---\nlabels: [a,b]\n---\n# Squeezed together\nProse.\n";
  const file = path.join(deck.openDir, "proj-behilo.md");
  await Bun.write(file, byHand);

  await appendRecord(deck, "proj-behilo", "Account", "What the implementer did.");
  await appendRecord(deck, "proj-behilo", "Review feedback", "What the reviewer asked for.\n");

  expect(await Bun.file(file).text()).toBe(
    `${byHand}\n## Account\n\nWhat the implementer did.\n\n## Review feedback\n\nWhat the reviewer asked for.\n`,
  );
  expect(await Array.fromAsync(new Bun.Glob("*").scan({ cwd: deck.openDir, dot: true }))).toEqual([
    "proj-behilo.md",
  ]);
});

test("a record section with a `# ` line refuses, naming the line, and writes nothing", async () => {
  const deck = await createDeck(await tempRepo(), "proj");
  const card = "# The card\n\nBody.\n";
  const file = path.join(deck.openDir, "proj-behilo.md");
  await Bun.write(file, card);

  await expect(appendRecord(deck, "proj-behilo", "Account", "Did it.\n# Not a headline\n")).rejects.toThrow(
    /`# Not a headline`/,
  );

  expect(await Bun.file(file).text()).toBe(card);
});
