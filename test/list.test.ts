import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import { rename } from "node:fs/promises";
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

  expect((await run(["--ready", "--label", "work-laptop"], repo)).out).toEqual([
    "proj-aaaaaa  both  [work-laptop, T-1]",
    "proj-cccccc  laptop only  [work-laptop]",
  ]);
  expect((await run(["--ready", "--label", "work-laptop", "--label", "T-1"], repo)).out).toEqual([
    "proj-aaaaaa  both  [work-laptop, T-1]",
  ]);
  expect((await run(["--ready", "--label", "T-1"], repo)).out).toEqual([
    "proj-aaaaaa  both  [work-laptop, T-1]",
    "proj-bbbbbb  ticket only  [T-1]",
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

test("a listing with no mode is an error rather than a default", async () => {
  const { repo } = await fixture();
  await expect(run([], repo)).rejects.toThrow(/--ready is the only listing/);
  await expect(run(["--label", "T-1"], repo)).rejects.toThrow(/--ready is the only listing/);
  await expect(run(["--stale"], repo)).rejects.toThrow(/not a listing card understands/);
  await expect(run(["--ready", "--label"], repo)).rejects.toThrow(/--label wants a label/);
});
