import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { createDeck, type Deck } from "../src/deck.ts";
import { closeCard, fileCard } from "../src/operations.ts";
import { listPlans, type Plan, startPlan, waitingCards, writeRecord } from "../src/plan.ts";
import { clearCardRoot, removeTempDirs, tempRepo } from "./helpers.ts";

const CARD = path.join(import.meta.dir, "..", "src", "card.ts");

beforeEach(clearCardRoot);
afterAll(removeTempDirs);

async function card(args: string[], cwd: string, input?: string) {
  const env = { ...process.env };
  delete env.CARD_ROOT;
  const stdin = input === undefined ? "ignore" : new Blob([input]);
  const proc = Bun.spawn([CARD, ...args], { cwd, env, stdin, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

/** A repository with a `proj` deck and one plan in the Cards stage. */
async function inCards(): Promise<{ repo: string; deck: Deck; plan: Plan }> {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  const plan = await writeRecord(await startPlan(deck, "the-plan"), { state: "Cards", placeholder: false });
  return { repo, deck, plan };
}

async function reread(deck: Deck): Promise<Plan> {
  return (await listPlans(deck))[0]!;
}

function openIds(deck: Deck): string[] {
  return readdirSync(deck.openDir).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3));
}

async function headline(deck: Deck, id: string): Promise<string> {
  const text = await Bun.file(path.join(deck.openDir, `${id}.md`)).text();
  return text.split("\n").find((line) => line.startsWith("# "))!.slice(2);
}

const finding = (headline: string, blockedBy: string[] = []) => ({ labels: [], blockedBy, headline, body: "Found.\n" });

test("three drafted files become three cards in filename order, the third the final card, and the plan moves to Check", async () => {
  const { repo, deck, plan } = await inCards();
  // Written out of order, so filename order is not creation order.
  await Bun.write(path.join(plan.cardsDir, "03-check-the-whole-plan.md"), "# Check the whole plan\n\nGuide.\n");
  await Bun.write(path.join(plan.cardsDir, "01-parse-the-config.md"), "# Parse the config\n\nBody.\n");
  await Bun.write(path.join(plan.cardsDir, "02-use-the-config.md"), "# Use the config\n\nBody.\n");

  const result = await card(["done"], repo);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);

  const after = await reread(deck);
  expect(after.state).toBe("Check");
  expect(after.cards).toHaveLength(3);
  const headlines = await Promise.all(after.cards.map((id) => headline(deck, id)));
  expect(headlines).toEqual(["Parse the config", "Use the config", "Check the whole plan"]);
  expect(after.final).toBe(after.cards[2]!);
  expect(openIds(deck).sort()).toEqual([...after.cards].sort());
  expect(readdirSync(plan.cardsDir)).toEqual([]);
});

test("a malformed drafted file refuses, naming it, and files nothing", async () => {
  const { repo, deck, plan } = await inCards();
  await Bun.write(path.join(plan.cardsDir, "01-fine.md"), "# A fine card\n\nBody.\n");
  await Bun.write(path.join(plan.cardsDir, "02-no-headline.md"), "Just prose, no headline.\n");
  await Bun.write(path.join(plan.cardsDir, "03-also-fine.md"), "# Another fine card\n");

  const result = await card(["done"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("02-no-headline.md");
  expect(openIds(deck)).toEqual([]);
  expect((await reread(deck)).state).toBe("Cards");
  expect(readdirSync(plan.cardsDir).sort()).toEqual(["01-fine.md", "02-no-headline.md", "03-also-fine.md"]);
});

for (const [outcome, takenIn] of [
  [null, false],
  ["declined", false],
  ["done", true],
] as const) {
  test(`a joined card blocked by a card outside the plan ${outcome === null ? "still open" : `closed ${outcome}`} is ${takenIn ? "taken in" : "refused"}`, async () => {
    const { repo, deck, plan } = await inCards();
    const blocker = await fileCard(deck, finding("The blocker"));
    const joined = await fileCard(deck, finding("The joined finding", [blocker]));
    if (outcome !== null) await closeCard(deck, blocker, outcome, "Settled.\n");
    await Bun.write(path.join(plan.cardsDir, "01-final.md"), "# The final card\n");

    expect((await card(["join", joined], repo)).code).toBe(0);
    const result = await card(["done"], repo);
    const after = await reread(deck);
    if (takenIn) {
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(after.state).toBe("Check");
      expect(after.cards).toContain(joined);
    } else {
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(joined);
      expect(result.stderr).toContain(blocker);
      expect(after.state).toBe("Cards");
      expect(after.cards).toEqual([]);
      // Nothing filed: the joined card and its blocker are all `open/` holds, if the blocker is open.
      expect(openIds(deck).sort()).toEqual((outcome === null ? [blocker, joined] : [joined]).sort());
    }
  });
}

test("on a first take-in, a joined card lands after the new files and ahead of the final card", async () => {
  const { repo, deck, plan } = await inCards();
  const joined = await fileCard(deck, finding("The joined finding"));
  await Bun.write(path.join(plan.cardsDir, "01-first.md"), "# The first card\n");
  await Bun.write(path.join(plan.cardsDir, "02-second.md"), "# The second card\n");
  await Bun.write(path.join(plan.cardsDir, "03-final.md"), "# The final card\n");

  expect((await card(["join", joined], repo)).code).toBe(0);
  expect((await card(["done"], repo)).code).toBe(0);

  const after = await reread(deck);
  expect(after.cards).toHaveLength(4);
  expect(after.cards[2]).toBe(joined);
  expect(after.final).toBe(after.cards[3]!);
  const headlines = await Promise.all(after.cards.map((id) => headline(deck, id)));
  expect(headlines).toEqual(["The first card", "The second card", "The joined finding", "The final card"]);
});

test("card later leaves its card waiting, outside the plan's order", async () => {
  const { repo, deck, plan } = await inCards();
  const later = await fileCard(deck, finding("A finding for another plan"));
  await Bun.write(path.join(plan.cardsDir, "01-final.md"), "# The final card\n");

  const result = await card(["later", later], repo);
  expect(result.code).toBe(0);
  const decided = await reread(deck);
  expect(decided.later).toEqual([later]);
  expect(decided.joins).toEqual([]);

  expect((await card(["done"], repo)).code).toBe(0);
  const after = await reread(deck);
  expect(after.cards).not.toContain(later);
  expect(existsSync(path.join(deck.openDir, `${later}.md`))).toBe(true);
  expect((await waitingCards(deck)).map(({ id }) => id)).toEqual([later]);
});

test("a later take-in puts a new file ahead of the first card not closed done, and drops a card closed declined", async () => {
  const { repo, deck, plan } = await inCards();
  const landed = await fileCard(deck, finding("The landed card"));
  const declined = await fileCard(deck, finding("The declined card"));
  const pending = await fileCard(deck, finding("The pending card"));
  const final = await fileCard(deck, finding("The final card"));
  await writeRecord(plan, { state: "Cards", cards: [landed, declined, pending, final], final });
  await closeCard(deck, landed, "done", "Landed.\n");
  await closeCard(deck, declined, "declined", "Redrafted.\n");
  await Bun.write(path.join(plan.cardsDir, "01-replacement.md"), "# The replacement card\n");

  const result = await card(["done"], repo);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);

  const after = await reread(deck);
  expect(after.cards).toHaveLength(4);
  expect(after.cards[0]).toBe(landed);
  expect(await headline(deck, after.cards[1]!)).toBe("The replacement card");
  expect(after.cards.slice(2)).toEqual([pending, final]);
  expect(after.cards).not.toContain(declined);
  expect(after.final).toBe(final);
});

test("bare card in Cards prints the stage's prompt with the deck's absolute path and the waiting cards", async () => {
  const { repo, deck, plan } = await inCards();
  const waiting = await fileCard(deck, finding("A waiting finding"));

  const result = await card([], repo);
  expect(result.code).toBe(0);
  expect(path.isAbsolute(deck.deckDir)).toBe(true);
  expect(result.stdout).toContain("# The Cards stage");
  expect(result.stdout).toContain(`\`${deck.deckDir}\``);
  expect(result.stdout).toContain(`${deck.deckDir}/closed`);
  expect(result.stdout).toContain(plan.cardsDir);
  expect(result.stdout).toContain(plan.document);
  expect(result.stdout).not.toContain("{{");

  const owner = result.stdout.slice(result.stdout.indexOf("<for_owner>\n"), result.stdout.indexOf("</for_owner>\n"));
  expect(owner).toContain(`${waiting}  A waiting finding`);
  expect(owner).toContain(`card join ${waiting}`);
  expect(owner).toContain(`card later ${waiting}`);
});

test("with no plan in progress, card decline closes a waiting card declined, its reason the close note, and refuses one without a reason or already closed", async () => {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  const id = await fileCard(deck, finding("A thought put down earlier"));

  const silent = await card(["decline", id], repo);
  expect(silent).toEqual({ code: 1, stdout: "", stderr: `card: \`card decline ${id}\` needs the owner's reason on stdin, which becomes its close note\n` });
  expect(existsSync(path.join(deck.openDir, `${id}.md`))).toBe(true);

  const result = await card(["decline", id], repo, "Not wanted after all.\n");
  expect(result).toEqual({ code: 0, stdout: `${id} is closed declined: A thought put down earlier\n`, stderr: "" });
  const closed = await Bun.file(path.join(deck.closedDir, `${id}.md`)).text();
  expect(closed).toContain("closed: declined");
  expect(closed).toEndWith("## Close note\n\nNot wanted after all.\n");
  expect(await listPlans(deck)).toEqual([]);

  const again = await card(["decline", id], repo, "Twice.\n");
  expect(again).toEqual({ code: 1, stdout: "", stderr: `card: ${id} is closed, so it is not waiting\n` });
});

test("card decline refuses a card a plan has joined", async () => {
  const { repo, deck } = await inCards();
  const id = await fileCard(deck, finding("A joined finding"));
  expect((await card(["join", id], repo)).code).toBe(0);

  const result = await card(["decline", id], repo, "Not wanted.\n");
  expect(result).toEqual({ code: 1, stdout: "", stderr: `card: ${id} has joined the plan \`the-plan\`, so it is not waiting\n` });
  expect(existsSync(path.join(deck.openDir, `${id}.md`))).toBe(true);
});

test("with no plan in progress, card promote refuses a draft citing a card id, naming each it cites, and one with no draft, and marks neither card", async () => {
  const repo = await tempRepo();
  const deck = await createDeck(repo, "proj");
  const first = await fileCard(deck, finding("The first finding"));
  const second = await fileCard(deck, finding("The second finding"));
  const read = (id: string) => Bun.file(path.join(deck.openDir, `${id}.md`)).text();
  const before = [await read(first), await read(second)];

  const citing = await card(["promote", first, second], repo, `Both came up under ${second}, and ${first} names the fix; ${second} again.\n`);
  expect(citing).toEqual({ code: 1, stdout: "", stderr: `card: the draft must cite no card id, and it cites ${second}, ${first}\n` });
  const silent = await card(["promote", first], repo);
  expect(silent).toEqual({
    code: 1,
    stdout: "",
    stderr: `card: \`card promote ${first}\` needs the session's draft on stdin, which is printed for the owner to post\n`,
  });

  expect([await read(first), await read(second)]).toEqual(before);
  expect(await listPlans(deck)).toEqual([]);
});

test("card promote refuses a card a plan has joined, in either form, and marks nothing", async () => {
  const { repo, deck } = await inCards();
  const id = await fileCard(deck, finding("A joined finding"));
  expect((await card(["join", id], repo)).code).toBe(0);
  const before = await Bun.file(path.join(deck.openDir, `${id}.md`)).text();

  const refusal = { code: 1, stdout: "", stderr: `card: ${id} has joined the plan \`the-plan\`, so it is not waiting\n` };
  expect(await card(["promote", id], repo, "A clean draft.\n")).toEqual(refusal);
  expect(await card(["promote", id, "--key", "GREET-42"], repo)).toEqual(refusal);
  expect(await Bun.file(path.join(deck.openDir, `${id}.md`)).text()).toBe(before);
});
