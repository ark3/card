import { afterAll, expect, test } from "bun:test";
import path from "node:path";
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

for (const [program, run] of [
  ["card", card],
  ["deck", deck],
] as const) {
  test(`${program} with no verb prints usage and fails`, async () => {
    const repo = await tempRepo();
    const result = await run([], repo);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`usage: ${program} <verb>`);
  });

  test(`${program} with an unknown verb prints usage and fails`, async () => {
    const repo = await tempRepo();
    const result = await run(["frobnicate"], repo);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`${program}: no such verb as \`frobnicate\``);
    expect(result.stderr).toContain(`usage: ${program} <verb>`);
  });
}

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
