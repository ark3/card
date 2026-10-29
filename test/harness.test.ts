import { afterAll, afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { chooseHarness } from "../src/harness.ts";
import { removeTempDirs, tempDir } from "./helpers.ts";

const OUTER_PATH = process.env.PATH;

afterEach(() => {
  if (OUTER_PATH === undefined) delete process.env.PATH;
  else process.env.PATH = OUTER_PATH;
});
afterAll(removeTempDirs);

/**
 * A PATH holding only the stand-ins the test names, so a real `claude` or `pi`
 * on the machine never decides the choice.
 */
function onPath(...names: string[]): void {
  const bin = tempDir();
  for (const name of names) writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env.PATH = bin;
}

test("with claude and pi both on PATH the choice is Claude Code, because claude is on PATH", () => {
  onPath("claude", "pi");
  expect(chooseHarness(null)).toEqual({ harness: "claude", why: "claude is on PATH" });
});

test("with only pi on PATH the choice is Pi, because claude is not", () => {
  onPath("pi");
  expect(chooseHarness(null)).toEqual({ harness: "pi", why: "pi is on PATH and claude is not" });
});

test("with neither claude nor pi on PATH the choice is refused", () => {
  onPath();
  expect(() => chooseHarness(null)).toThrow("neither claude nor pi is on PATH");
});

test("--harness overrides the choice PATH would make, and says the flag chose it", () => {
  onPath("claude", "pi");
  expect(chooseHarness("pi")).toEqual({ harness: "pi", why: "--harness named it" });
});

test("--harness naming a harness that is not on PATH is refused", () => {
  onPath("claude");
  expect(() => chooseHarness("pi")).toThrow("--harness names pi, but pi is not on PATH");
});
