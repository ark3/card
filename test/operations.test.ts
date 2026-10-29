import { afterAll, beforeEach, expect, test } from "bun:test";
import path from "node:path";
import { readCard } from "../src/cardfile.ts";
import { createDeck, locate } from "../src/deck.ts";
import { citedIds } from "../src/id.ts";
import { closeCard, fileCard, listCards } from "../src/operations.ts";
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
