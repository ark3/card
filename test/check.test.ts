import { afterAll, beforeEach, expect, test } from "bun:test";
import path from "node:path";
import { createDeck, type Deck } from "../src/deck.ts";
import { closeCard, fileCard } from "../src/operations.ts";
import { listPlans, type Plan, startPlan, writeRecord } from "../src/plan.ts";
import { clearCardRoot, removeTempDirs, tempRepo } from "./helpers.ts";

const CARD = path.join(import.meta.dir, "..", "src", "card.ts");

beforeEach(clearCardRoot);
afterAll(removeTempDirs);

async function card(args: string[], cwd: string) {
  const env = { ...process.env };
  delete env.CARD_ROOT;
  const proc = Bun.spawn([CARD, ...args], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

const finding = (headline: string) => ({ labels: [], blockedBy: [], headline, body: "Body.\n" });

/** A repository with a `proj` deck and one plan in the Check stage, its first card landed. */
async function inCheck(): Promise<{ repo: string; deck: Deck; plan: Plan }> {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  const landed = await fileCard(deck, finding("The landed card"));
  const pending = await fileCard(deck, finding("The pending card"));
  const final = await fileCard(deck, finding("The final card"));
  await closeCard(deck, landed, "done", "Landed.\n");
  const plan = await writeRecord(await startPlan(deck, "the-plan"), {
    state: "Check",
    placeholder: false,
    cards: [landed, pending, final],
    final,
  });
  return { repo, deck, plan };
}

test("bare card in Check prints the stage's prompt with the plan document and the plan's cards in order, each with its path", async () => {
  const { repo, deck, plan } = await inCheck();
  const [landed, pending, final] = plan.cards;

  const result = await card([], repo);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("# The Check stage");
  expect(result.stdout).toContain(plan.document);
  expect(result.stdout).not.toContain("{{");
  expect(result.stdout).toContain(
    [
      `${landed}  The landed card  (landed)`,
      `  ${path.join(deck.closedDir, `${landed}.md`)}`,
      `${pending}  The pending card`,
      `  ${path.join(deck.openDir, `${pending}.md`)}`,
      `${final}  The final card  (final card)`,
      `  ${path.join(deck.openDir, `${final}.md`)}`,
    ].join("\n"),
  );
});

test("card amend in Check moves the plan to Cards, keeping its cards, and prints the Cards prompt", async () => {
  const { repo, deck, plan } = await inCheck();

  const result = await card(["amend"], repo);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);

  const after = (await listPlans(deck))[0]!;
  expect(after.state).toBe("Cards");
  expect(after.cards).toEqual(plan.cards);
  expect(after.final).toBe(plan.final);
  expect(result.stdout).toContain("# The Cards stage");
  // Exactly what bare `card` prints in the Cards stage it moved to.
  expect(result.stdout).toBe((await card([], repo)).stdout);
});

test("card done in Check refuses as not open, naming Check, and lists card approve and card amend as open", async () => {
  const { repo, deck } = await inCheck();

  const result = await card(["done"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toBe(
    "card: `card done` is not open while the plan `the-plan` is in Check, where these commands are open:\n  card\n  card approve\n  card amend\n",
  );
  expect((await listPlans(deck))[0]!.state).toBe("Check");
});
