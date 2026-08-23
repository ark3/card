import { afterAll, beforeEach, expect, test } from "bun:test";
import path from "node:path";
import type { Deck } from "../src/deck.ts";
import { resolveDeck } from "../src/deck.ts";
import { run as init } from "../src/verbs/init.ts";
import { clearCardRoot, removeTempDirs, tempRepo } from "./helpers.ts";

const CARD = path.join(import.meta.dir, "..", "src", "card.ts");

beforeEach(clearCardRoot);
afterAll(removeTempDirs);

type Run = { code: number; stdout: string; stderr: string };

/** Runs the entry point as the shell would, so the exit status is the real one. */
async function card(args: string[], cwd: string, stdin?: string): Promise<Run> {
  const env = { ...process.env };
  delete env.CARD_ROOT;
  const proc = Bun.spawn([CARD, ...args], {
    cwd,
    env,
    stdin: stdin === undefined ? "ignore" : new Response(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

async function byHand(command: string[], cwd: string): Promise<Run> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

async function fixture(): Promise<{ repo: string; deck: Deck }> {
  const repo = await tempRepo();
  await init(["proj"], repo);
  return { repo, deck: (await resolveDeck(repo))! };
}

test("the command runs with the deck as its working directory", async () => {
  const { repo, deck } = await fixture();
  const result = await card(["cmd", "--", "pwd"], repo);
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(`${deck.deckDir}\n`);
});

test("stdout, stderr and stdin pass through unaltered", async () => {
  const { repo } = await fixture();

  const streams = await card(["cmd", "--", "sh", "-c", "echo to-out; echo to-err >&2"], repo);
  expect(streams.stdout).toBe("to-out\n");
  expect(streams.stderr).toBe("to-err\n");

  const piped = await card(["cmd", "--", "cat"], repo, "from the caller\n");
  expect(piped.stdout).toBe("from the caller\n");
});

test("an exit status other than 0 or 1 survives the round trip", async () => {
  const { repo } = await fixture();
  expect((await card(["cmd", "--", "sh", "-c", "exit 42"], repo)).code).toBe(42);
  expect((await card(["cmd", "--", "sh", "-c", "exit 2"], repo)).code).toBe(2);
  expect((await card(["cmd", "--", "true"], repo)).code).toBe(0);
});

test("a command that does not exist fails as a shell would", async () => {
  const { repo } = await fixture();
  const result = await card(["cmd", "--", "no-such-command-anywhere"], repo);
  expect(result.code).toBe(127);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("no-such-command-anywhere");
});

test("cmd with no command is a usage error", async () => {
  const { repo } = await fixture();
  const result = await card(["cmd"], repo);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("usage: card cmd -- <command>");
});

test("rg reaches the cards from a repository whose .gitignore hides *.md", async () => {
  const repo = await tempRepo();
  // The hostile case the deck's `.ignore` exists to defeat: ripgrep walks up
  // from its working directory and would otherwise honour this.
  await Bun.write(path.join(repo, ".gitignore"), "*.md\n");
  await init(["proj"], repo);
  const deck = (await resolveDeck(repo))!;
  await Bun.write(
    path.join(deck.openDir, "proj-aaaaaa.md"),
    "---\nblocked-by: [proj-bbbbbb]\n---\n\n# waiting\n",
  );
  await Bun.write(path.join(deck.openDir, "proj-bbbbbb.md"), "# free\n");

  const command = ["rg", "^blocked-by:", "open"];
  const result = await card(["cmd", "--", ...command], repo);
  expect(result.stdout).toBe("open/proj-aaaaaa.md:blocked-by: [proj-bbbbbb]\n");
  expect(result).toEqual(await byHand(command, deck.deckDir));
});
