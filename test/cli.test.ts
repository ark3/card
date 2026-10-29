import { afterAll, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { forOwner } from "../src/owner.ts";
import { removeTempDirs, tempDir, tempRepo } from "./helpers.ts";

const CARD = path.join(import.meta.dir, "..", "src", "card.ts");
const DECK = path.join(import.meta.dir, "..", "src", "deck-cli.ts");

afterAll(removeTempDirs);

/** Runs an entry point as the shell would: shebang, executable bit and all. */
async function spawn(entry: string, args: string[], cwd: string, options: { stdin?: string } = {}) {
  const env = { ...process.env };
  delete env.CARD_ROOT;
  const proc = Bun.spawn([entry, ...args], {
    cwd,
    env,
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

const card = (args: string[], cwd: string) => spawn(CARD, args, cwd);
const deck = (args: string[], cwd: string, options: { stdin?: string } = {}) => spawn(DECK, args, cwd, options);

test("deck with no verb prints usage and fails", async () => {
  const repo = await tempRepo();
  const result = await deck([], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("usage: deck <verb>");
});

for (const [program, run] of [
  ["card", card],
  ["deck", deck],
] as const) {
  test(`${program} with an unknown verb prints usage and fails`, async () => {
    const repo = await tempRepo();
    const result = await run(["frobnicate"], repo);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`${program}: no such verb as \`frobnicate\``);
    expect(result.stderr).toContain(`usage: ${program} `);
  });
}

/** The slugs of the plans recorded in `repo`'s deck, sorted. */
function plans(repo: string): string[] {
  const dir = path.join(repo, ".git", "card", "plans");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

async function planState(repo: string, slug: string): Promise<string> {
  const record = await Bun.file(path.join(repo, ".git", "card", "plans", slug, "state.json")).json();
  return record.state;
}

test("bare card where there is no deck creates one, starts a plan and prints the Document prompt filled", async () => {
  const repo = await tempRepo();
  const result = await card([], repo);
  expect(result.code).toBe(0);

  expect(await Bun.file(path.join(repo, ".git", "card", "card-config.toml")).text()).toContain('prefix = "card"');
  const started = plans(repo);
  expect(started).toHaveLength(1);
  const document = path.join(repo, ".git", "card", "plans", started[0]!, "plan.md");

  expect(result.stdout).toContain("# The Document stage");
  expect(result.stdout).toContain(document);
  expect(result.stdout).toContain("run `card done`");
  expect(result.stdout).not.toContain("{{");
  expect(await planState(repo, started[0]!)).toBe("Document");

  const again = await card([], repo);
  expect(again.code).toBe(0);
  expect(again.stdout).toContain(document);
  expect(plans(repo)).toEqual(started);
});

test("bare card lists a waiting card inside the owner marks, with decline and promote beside it", async () => {
  const repo = await tempRepo();
  expect((await deck(["init", "proj"], repo)).code).toBe(0);
  const id = (await deck(["new", "A thought put down earlier"], repo, { stdin: "Body.\n" })).stdout.trim();

  const result = await card([], repo);
  expect(result.code).toBe(0);
  const open = result.stdout.indexOf("<for_owner>\n");
  const close = result.stdout.indexOf("</for_owner>\n");
  expect(open).toBeGreaterThan(-1);
  const owner = result.stdout.slice(open, close);
  expect(owner).toContain(id);
  expect(owner).toContain("A thought put down earlier");
  expect(owner).toContain(`card decline ${id}`);
  expect(owner).toContain(`card promote ${id}`);
});

test("card done refuses a document without a start point, then moves the plan to Cards under its headline", async () => {
  const repo = await tempRepo();
  expect((await card([], repo)).code).toBe(0);
  const [draft] = plans(repo);
  const document = path.join(repo, ".git", "card", "plans", draft!, "plan.md");

  await Bun.write(document, "---\nbranch: feature/export\n---\n\n# Add the export button\n\nIntent.\n");
  const refused = await card(["done"], repo);
  expect(refused.code).not.toBe(0);
  expect(refused.stderr).toContain("start-point");
  expect(refused.stderr).not.toContain("branch:");
  expect(await planState(repo, draft!)).toBe("Document");

  await Bun.write(
    document,
    "---\nbranch: feature/export\nstart-point: develop\n---\n\n# Add the export button\n\nIntent.\n",
  );
  const done = await card(["done"], repo);
  expect(done.code).toBe(0);
  expect(plans(repo)).toEqual(["add-the-export-button"]);
  expect(await planState(repo, "add-the-export-button")).toBe("Cards");
  expect(await Bun.file(path.join(repo, ".git", "card", "plans", "add-the-export-button", "plan.md")).text()).toContain(
    "# Add the export button",
  );

  const bare = await card([], repo);
  expect(bare.code).toBe(0);
  expect(bare.stdout).toContain("# The Cards stage");
});

test("card approve in Document refuses, naming the state and the commands open in it", async () => {
  const repo = await tempRepo();
  expect((await card([], repo)).code).toBe(0);
  const result = await card(["approve"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("Document");
  expect(result.stderr).toContain("card done");
  expect(result.stderr).not.toContain("no such verb");
});

test("card drop in Document ends the plan, and the next bare card starts afresh", async () => {
  const repo = await tempRepo();
  expect((await card(["--plan", "mistaken"], repo)).code).toBe(0);

  const dropping = await card(["drop"], repo);
  expect(dropping).toEqual({ code: 0, stdout: forOwner("The plan `mistaken` is dropped.\n\nNo card of the plan was left open to close.\n"), stderr: "" });
  expect(plans(repo)).toEqual([]);

  const next = await card([], repo);
  expect(next.code).toBe(0);
  expect(next.stdout).toContain("# The Document stage");
  const started = plans(repo);
  expect(started).toHaveLength(1);
  expect(started).not.toEqual(["mistaken"]);
  expect(await planState(repo, started[0]!)).toBe("Document");
});

test("card refuses frobnicate and status as unknown, with a plan in progress", async () => {
  const repo = await tempRepo();
  expect((await card([], repo)).code).toBe(0);
  for (const name of ["frobnicate", "status"]) {
    const result = await card([name], repo);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`no such verb as \`${name}\``);
  }
});

test("with two plans in progress, bare card prints every command with its --plan", async () => {
  const repo = await tempRepo();
  expect((await card([], repo)).code).toBe(0);
  const second = await card(["--plan", "second-plan"], repo);
  expect(second.code).toBe(0);
  // The new plan's own prompt already names it, since there are now two.
  expect(second.stdout).toContain("run `card --plan second-plan done`");

  const slugs = plans(repo);
  expect(slugs).toHaveLength(2);
  expect(slugs).toContain("second-plan");

  const result = await card([], repo);
  expect(result.code).toBe(0);
  for (const slug of slugs) {
    expect(result.stdout).toContain(slug);
    expect(result.stdout).toContain(`card --plan ${slug} done`);
  }
  expect(result.stdout).toContain("Document");
  expect(plans(repo)).toEqual(slugs);

  // A verb with no --plan cannot tell which plan it means.
  const ambiguous = await card(["done"], repo);
  expect(ambiguous.code).not.toBe(0);
  expect(ambiguous.stderr).toContain("--plan");
});

test("--plan is accepted after the verb as well as before it", async () => {
  const repo = await tempRepo();
  expect((await card(["--plan", "named"], repo)).code).toBe(0);
  const result = await card(["done", "--plan", "named"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("no plan document");
});

test("card --plan nosuch done refuses and starts nothing", async () => {
  const repo = await tempRepo();
  expect((await card([], repo)).code).toBe(0);
  const before = plans(repo);

  const result = await card(["--plan", "nosuch", "done"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("nosuch");
  expect(plans(repo)).toEqual(before);
});

test("every verb but bare card answers no deck here where there is none", async () => {
  const repo = await tempRepo();
  for (const args of [["done"], ["approve"], ["--plan", "nosuch", "done"]]) {
    const result = await card(args, repo);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("no deck here");
  }
  expect(plans(repo)).toEqual([]);
});

test("card refuses the deck's verbs and the retired workflow verbs as unknown", async () => {
  const repo = await tempRepo();
  const deckVerbs = ["init", "new", "show", "list", "close", "lint-commit"];
  const retired = ["status", "cmd", "worktree", "author", "execute", "run", "workflow"];
  for (const name of [...deckVerbs, ...retired]) {
    const result = await card([name], repo);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`no such verb as \`${name}\``);
  }
});

test("deck refuses lint-commit, now lint, and the workflow's status as unknown", async () => {
  const repo = await tempRepo();
  for (const name of ["lint-commit", "status"]) {
    const result = await deck([name], repo);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`no such verb as \`${name}\``);
  }
});

test("agent-help prints its payload whole, inside the envelope, with no deck", async () => {
  const text = await Bun.file(path.join(import.meta.dir, "..", "payload", "agent-help.md")).text();
  const result = await deck(["agent-help"], tempDir());
  expect(result.code).toBe(0);

  const lines = result.stdout.split("\n");
  expect(lines.pop()).toBe("");
  expect(lines[0]).toStartWith("<deck_agent_help> ");
  expect(lines[0]).toContain("rerun `deck agent-help` bare");
  expect(lines.at(-1)).toBe("</deck_agent_help>");

  const headings = text.split("\n").filter((line) => line.startsWith("#"));
  expect(headings.length).toBeGreaterThan(0);
  for (const heading of headings) expect(lines).toContain(heading);
  expect(lines.slice(1, -1).join("\n") + "\n").toBe(text);
});

test("one card walks the whole loop, through the real executable", async () => {
  const repo = await tempRepo();
  const run = (args: string[], stdin?: string) => deck(args, repo, { stdin });

  expect((await run(["init", "proj"])).code).toBe(0);

  const blocker = (await run(["new", "The card that has to land first"], "Grounding.\n")).stdout.trim();
  const waiting = (
    await run(["new", "The card that waits", "--label", "TICKET-1", "--blocked-by", blocker], "More.\n")
  ).stdout.trim();
  expect(blocker).toMatch(/^proj-[bdfghjklmnprstvwyz][aeiou]/);
  expect(waiting).not.toBe(blocker);

  // Blocked cards are absent, and the join is against `closed/` rather than
  // anything written into the waiting card.
  const first = await run(["list", "--ready"]);
  expect(first.stdout).toContain(blocker);
  expect(first.stdout).not.toContain(waiting);

  const closed = await run(["close", blocker, "--done"], "Landed in abc1234.\n");
  expect(closed.code).toBe(0);

  const second = await run(["list", "--ready"]);
  expect(second.stdout).toContain(waiting);
  expect(second.stdout).toContain("TICKET-1");
  expect(second.stdout).not.toContain(blocker);

  // A cited id still resolves after the card moved, which is the incident
  // `show` exists for.
  const shown = await run(["show", blocker]);
  expect(shown.code).toBe(0);
  expect(shown.stdout).toContain("Landed in abc1234.");
});

test("init, then a second init that refuses", async () => {
  const repo = await tempRepo();

  const first = await deck(["init", "proj"], repo);
  expect(first.code).toBe(0);
  expect(first.stdout).toContain("proj");
  expect(await Bun.file(path.join(repo, ".git", "card", "card-config.toml")).text()).toBe(
    'prefix = "proj"\ndeck = "deck"\n',
  );

  const second = await deck(["init", "proj"], repo);
  expect(second.code).not.toBe(0);
  expect(second.stderr).toStartWith("deck: ");
  expect(second.stderr).toContain("already configured");
});
