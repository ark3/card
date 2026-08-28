import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import { rename, utimes } from "node:fs/promises";
import path from "node:path";
import type { Card } from "../src/cardfile.ts";
import { formatCard } from "../src/cardfile.ts";
import type { Deck } from "../src/deck.ts";
import { resolveDeck } from "../src/deck.ts";
import { run as init } from "../src/verbs/init.ts";
import { run as list } from "../src/verbs/list.ts";
import { clearCardRoot, removeTempDirs, tempRepo } from "./helpers.ts";

beforeEach(clearCardRoot);
afterAll(removeTempDirs);

async function fixture(): Promise<{ repo: string; deck: Deck }> {
  const repo = await tempRepo();
  await init(["proj"], repo);
  return { repo, deck: (await resolveDeck(repo))! };
}

async function put(
  deck: Deck,
  where: "open" | "closed",
  id: string,
  card: Partial<Card> & Pick<Card, "headline">,
): Promise<void> {
  const dir = where === "open" ? deck.openDir : deck.closedDir;
  await Bun.write(path.join(dir, `${id}.md`), formatCard({ labels: [], blockedBy: [], body: "", ...card }));
}

/** Give a card an mtime, so a listing's order is the test's choice and not the clock's. */
async function touch(deck: Deck, where: "open" | "closed", id: string, when: number): Promise<void> {
  const dir = where === "open" ? deck.openDir : deck.closedDir;
  await utimes(path.join(dir, `${id}.md`), when, when);
}

/** `list` writes its answer to stdout and its complaints to stderr. */
async function run(args: string[], cwd: string): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...parts: unknown[]) => void out.push(parts.join(" ")));
  const error = spyOn(console, "error").mockImplementation((...parts: unknown[]) => void err.push(parts.join(" ")));
  try {
    await list(args, cwd);
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { out, err };
}

test("a card blocked by an open card is absent until the blocker closes", async () => {
  const { repo, deck } = await fixture();
  await put(deck, "open", "proj-aaaaaa", { headline: "the blocker" });
  await put(deck, "open", "proj-bbbbbb", { headline: "the dependent", blockedBy: ["proj-aaaaaa"] });

  expect((await run(["--ready"], repo)).out).toEqual(["proj-aaaaaa  the blocker"]);

  await rename(path.join(deck.openDir, "proj-aaaaaa.md"), path.join(deck.closedDir, "proj-aaaaaa.md"));

  expect((await run(["--ready"], repo)).out).toEqual(["proj-bbbbbb  the dependent"]);
});

test("a label filter includes and excludes the right cards", async () => {
  const { repo, deck } = await fixture();
  await put(deck, "open", "proj-aaaaaa", { headline: "both", labels: ["work-laptop", "T-1"] });
  await put(deck, "open", "proj-bbbbbb", { headline: "ticket only", labels: ["T-1"] });
  await put(deck, "open", "proj-cccccc", { headline: "laptop only", labels: ["work-laptop"] });
  await touch(deck, "open", "proj-aaaaaa", 1000);
  await touch(deck, "open", "proj-bbbbbb", 2000);
  await touch(deck, "open", "proj-cccccc", 3000);

  expect((await run(["--ready", "--label", "work-laptop"], repo)).out).toEqual([
    "proj-cccccc  laptop only  [work-laptop]",
    "proj-aaaaaa  both  [work-laptop, T-1]",
  ]);
  expect((await run(["--ready", "--label", "work-laptop", "--label", "T-1"], repo)).out).toEqual([
    "proj-aaaaaa  both  [work-laptop, T-1]",
  ]);
  expect((await run(["--ready", "--label", "T-1"], repo)).out).toEqual([
    "proj-bbbbbb  ticket only  [T-1]",
    "proj-aaaaaa  both  [work-laptop, T-1]",
  ]);
});

test("a blocker in neither directory is reported, never treated as satisfied", async () => {
  const { repo, deck } = await fixture();
  await put(deck, "open", "proj-aaaaaa", { headline: "waiting on a ghost", blockedBy: ["proj-zzzzzz"] });

  const { out, err } = await run(["--ready"], repo);
  expect(err).toEqual([
    "card: proj-aaaaaa is blocked by proj-zzzzzz, which is in neither open/ nor closed/",
  ]);
  expect(out).toEqual(["nothing ready: 1 open card is blocked"]);
});

test("an empty result says which kind of empty it is", async () => {
  const { repo, deck } = await fixture();
  expect((await run(["--ready"], repo)).out).toEqual(["nothing ready: no open cards"]);

  await put(deck, "open", "proj-aaaaaa", { headline: "the blocker", labels: ["T-2"] });
  await put(deck, "open", "proj-bbbbbb", { headline: "one", labels: ["T-1"], blockedBy: ["proj-aaaaaa"] });
  await put(deck, "open", "proj-cccccc", { headline: "another", labels: ["T-1"], blockedBy: ["proj-aaaaaa"] });

  expect((await run(["--ready", "--label", "T-1"], repo)).out).toEqual([
    "nothing ready: 2 matching open cards are blocked",
  ]);
  expect((await run(["--ready", "--label", "T-9"], repo)).out).toEqual([
    "nothing ready: no matching open cards",
  ]);
});

test("a malformed card is named and the rest of the listing survives", async () => {
  const { repo, deck } = await fixture();
  await Bun.write(path.join(deck.openDir, "proj-aaaaaa.md"), "---\nkind: chore\n---\n\n# dropped field\n");
  await put(deck, "open", "proj-bbbbbb", { headline: "fine" });
  // The malformed card sorts first, so a `break` on it would take the rest of
  // the listing down with it and this test would see the difference.
  await touch(deck, "open", "proj-aaaaaa", 2000);
  await touch(deck, "open", "proj-bbbbbb", 1000);

  const { out, err } = await run(["--ready"], repo);
  expect(out).toEqual(["proj-bbbbbb  fine"]);
  expect(err).toHaveLength(1);
  expect(err[0]).toContain("proj-aaaaaa.md");
  expect(err[0]).toContain("unknown frontmatter field");
});

test("closed cards are never listed", async () => {
  const { repo, deck } = await fixture();
  await put(deck, "closed", "proj-aaaaaa", { headline: "done" });

  expect((await run(["--ready"], repo)).out).toEqual(["nothing ready: no open cards"]);
});

test("a bare listing is the open one, and --open says the same thing aloud", async () => {
  const { repo, deck } = await fixture();
  await put(deck, "open", "proj-aaaaaa", { headline: "open one", labels: ["T-1"] });
  await put(deck, "open", "proj-bbbbbb", { headline: "open two" });
  await put(deck, "closed", "proj-cccccc", { headline: "done" });
  await touch(deck, "open", "proj-aaaaaa", 1000);
  await touch(deck, "open", "proj-bbbbbb", 2000);

  const expected = ["proj-bbbbbb  open two", "proj-aaaaaa  open one  [T-1]"];
  expect((await run([], repo)).out).toEqual(expected);
  expect((await run(["--open"], repo)).out).toEqual(expected);
});

test("the open listing marks a blocked card, where --ready drops it", async () => {
  const { repo, deck } = await fixture();
  await put(deck, "open", "proj-aaaaaa", { headline: "the blocker" });
  await put(deck, "open", "proj-bbbbbb", { headline: "the dependent", labels: ["T-1"], blockedBy: ["proj-aaaaaa"] });
  await touch(deck, "open", "proj-aaaaaa", 1000);
  await touch(deck, "open", "proj-bbbbbb", 2000);

  expect((await run([], repo)).out).toEqual([
    "proj-bbbbbb  the dependent  [T-1]  (blocked by proj-aaaaaa)",
    "proj-aaaaaa  the blocker",
  ]);
  expect((await run(["--ready"], repo)).out).toEqual(["proj-aaaaaa  the blocker"]);
});

test("--closed lists the closed cards, and answers whether a ticket is finished", async () => {
  const { repo, deck } = await fixture();
  await put(deck, "closed", "proj-aaaaaa", { headline: "shipped", labels: ["T-14"] });
  await put(deck, "closed", "proj-bbbbbb", { headline: "shipped too", labels: ["T-15"] });
  await put(deck, "open", "proj-cccccc", { headline: "still going", labels: ["T-14"] });
  await touch(deck, "closed", "proj-aaaaaa", 1000);
  await touch(deck, "closed", "proj-bbbbbb", 2000);

  expect((await run(["--closed"], repo)).out).toEqual([
    "proj-bbbbbb  shipped too  [T-15]",
    "proj-aaaaaa  shipped  [T-14]",
  ]);
  expect((await run(["--closed", "--label", "T-14"], repo)).out).toEqual(["proj-aaaaaa  shipped  [T-14]"]);
  expect((await run(["--label", "T-14"], repo)).out).toEqual(["proj-cccccc  still going  [T-14]"]);
});

test("a blocker still open is not a ghost, and a closed one stops blocking", async () => {
  const { repo, deck } = await fixture();
  await put(deck, "closed", "proj-aaaaaa", { headline: "the blocker" });
  await put(deck, "open", "proj-bbbbbb", { headline: "freed", blockedBy: ["proj-aaaaaa"] });

  const { out, err } = await run([], repo);
  expect(err).toEqual([]);
  expect(out).toEqual(["proj-bbbbbb  freed"]);
});

test("each listing names its own kind of empty", async () => {
  const { repo, deck } = await fixture();
  expect((await run([], repo)).out).toEqual(["no open cards"]);
  expect((await run(["--closed"], repo)).out).toEqual(["no closed cards"]);

  await put(deck, "open", "proj-aaaaaa", { headline: "open one", labels: ["T-1"] });
  await put(deck, "closed", "proj-bbbbbb", { headline: "done", labels: ["T-1"] });

  expect((await run(["--label", "T-9"], repo)).out).toEqual(["no matching open cards"]);
  expect((await run(["--closed", "--label", "T-9"], repo)).out).toEqual(["no matching closed cards"]);
});

test("a malformed closed card is named and the rest of the listing survives", async () => {
  const { repo, deck } = await fixture();
  await Bun.write(path.join(deck.closedDir, "proj-aaaaaa.md"), "---\nkind: chore\n---\n\n# dropped field\n");
  await put(deck, "closed", "proj-bbbbbb", { headline: "fine" });
  await touch(deck, "closed", "proj-aaaaaa", 2000);
  await touch(deck, "closed", "proj-bbbbbb", 1000);

  const { out, err } = await run(["--closed"], repo);
  expect(out).toEqual(["proj-bbbbbb  fine"]);
  expect(err).toHaveLength(1);
  expect(err[0]).toContain("proj-aaaaaa.md");
});

test("two listings at once is an error, and so is a flag that names none", async () => {
  const { repo } = await fixture();
  await expect(run(["--open", "--closed"], repo)).rejects.toThrow(/pick one/);
  await expect(run(["--ready", "--closed"], repo)).rejects.toThrow(/pick one/);
  await expect(run(["--stale"], repo)).rejects.toThrow(/not a listing card understands/);
  await expect(run(["--ready", "--label"], repo)).rejects.toThrow(/--label wants a label/);
});

test("a listing is ordered by when each card was last updated, newest first", async () => {
  const { repo, deck } = await fixture();
  await put(deck, "open", "proj-aaaaaa", { headline: "touched first" });
  await put(deck, "open", "proj-bbbbbb", { headline: "touched last" });
  await put(deck, "open", "proj-cccccc", { headline: "touched second" });
  await touch(deck, "open", "proj-aaaaaa", 1000);
  await touch(deck, "open", "proj-bbbbbb", 3000);
  await touch(deck, "open", "proj-cccccc", 2000);

  expect((await run([], repo)).out).toEqual([
    "proj-bbbbbb  touched last",
    "proj-cccccc  touched second",
    "proj-aaaaaa  touched first",
  ]);

  await put(deck, "closed", "proj-dddddd", { headline: "closed first" });
  await put(deck, "closed", "proj-eeeeee", { headline: "closed last" });
  await touch(deck, "closed", "proj-dddddd", 1000);
  await touch(deck, "closed", "proj-eeeeee", 2000);

  expect((await run(["--closed"], repo)).out).toEqual([
    "proj-eeeeee  closed last",
    "proj-dddddd  closed first",
  ]);
});
