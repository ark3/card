import { afterAll, expect, test } from "bun:test";
import { chmodSync } from "node:fs";
import path from "node:path";
import { removeTempDirs, tempDir, tempRepo } from "./helpers.ts";

const CARD = path.join(import.meta.dir, "..", "src", "card.ts");

afterAll(removeTempDirs);

/** Runs the entry point as the shell would: shebang, executable bit and all. */
async function card(args: string[], cwd: string, options: { stdin?: string; home?: string } = {}) {
  const env = { ...process.env };
  delete env.CARD_ROOT;
  if (options.home !== undefined) env.HOME = options.home;
  const proc = Bun.spawn([CARD, ...args], {
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

/**
 * A read-only `$HOME`, which is what the sandbox looks like to the probe. Real
 * runs get this from the sandbox; tests must not depend on being inside one.
 */
function sandboxedHome(): string {
  const home = tempDir();
  chmodSync(home, 0o500);
  return home;
}

test("no verb prints usage and fails", async () => {
  const repo = await tempRepo();
  const result = await card([], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("usage: card <verb>");
});

test("an unknown verb prints usage and fails", async () => {
  const repo = await tempRepo();
  const result = await card(["frobnicate"], repo);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("frobnicate");
  expect(result.stderr).toContain("usage: card <verb>");
});

test("one card walks the whole loop, through the real executable", async () => {
  const repo = await tempRepo();
  const home = sandboxedHome();
  const run = (args: string[], stdin?: string) => card(args, repo, { home, stdin });

  // Nothing about cards before there is a deck: that is what makes `card
  // status` safe to run unconditionally in a project that never adopts it.
  const cold = await run(["status"]);
  expect(cold.code).toBe(0);
  expect(cold.stdout).not.toContain("Mode");

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

  const closed = await run(["close", blocker, "--work-done"], "Landed in abc1234.\n");
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

  // The payload reaches a session only once there is a deck, and it carries
  // the counts rather than describing them.
  const warm = await run(["status"]);
  expect(warm.stdout).toContain("1 open, 1 closed");
  expect(warm.stdout).toContain("card close <id> --work-done|--work-not-done");

  chmodSync(home, 0o700);
});

test("init, then a second init that refuses", async () => {
  const repo = await tempRepo();

  const first = await card(["init", "proj"], repo);
  expect(first.code).toBe(0);
  expect(first.stdout).toContain("proj");
  expect(await Bun.file(path.join(repo, ".git", "card", "card-config.toml")).text()).toBe(
    'prefix = "proj"\ndeck = "deck"\n',
  );

  const second = await card(["init", "proj"], repo);
  expect(second.code).not.toBe(0);
  expect(second.stderr).toContain("already configured");
});
