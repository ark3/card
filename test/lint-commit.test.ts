import { afterAll, beforeEach, expect, test } from "bun:test";
import path from "node:path";
import { drawId } from "../src/id.ts";
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

async function fixture(): Promise<string> {
  const repo = await tempRepo();
  await init(["proj"], repo);
  return repo;
}

test("a message citing a card id fails and names it", async () => {
  const repo = await fixture();
  const id = drawId("proj");
  const result = await card(["lint-commit"], repo, `Teach the reader to stop\n\nFixes ${id}\n`);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain(id);
});

test("on a public deck a message citing a card id passes", async () => {
  const repo = await fixture();
  const configPath = path.join(repo, ".git", "card", "card-config.toml");
  await Bun.write(configPath, `${await Bun.file(configPath).text()}public = true\n`);
  const result = await card(["lint-commit"], repo, `Teach the reader to stop\n\nFixes ${drawId("proj")}\n`);
  expect(result.code).toBe(0);
});

test("a message citing no card id passes silently", async () => {
  const repo = await fixture();
  const result = await card(["lint-commit"], repo, "Teach the reader to stop\n\nNo id here.\n");
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

test("an id under another deck's prefix is not this deck's citation", async () => {
  const repo = await fixture();
  const result = await card(["lint-commit"], repo, `Teach the reader to stop\n\nSee ${drawId("other")}\n`);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
});

test("every distinct id is named once, one per line", async () => {
  const repo = await fixture();
  const first = "proj-behilo";
  const second = "proj-vazuku";
  const message = `Land it\n\nFixes ${first}, and ${second}; also ${first} again.\n`;
  const result = await card(["lint-commit"], repo, message);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toBe(`${first}\n${second}\n`);
});

test("a longer word merely containing an id shape is not a citation", async () => {
  const repo = await fixture();
  const result = await card(["lint-commit"], repo, "Rename proj-behilonger to something else\n");
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
});
