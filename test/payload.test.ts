import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderPayload } from "../src/payload.ts";

// A marker on a line of its own is what fences a rendering, so a marker left in
// the output is a rendering the renderer failed to strip.
const MARKER = /^<!--\/?(?:private|public)-->$/;

test("refuses a block left open at the end of the file", () => {
  expect(() => renderPayload("a\n<!--private-->\nb\n", false)).toThrow(
    "payload: <!--private--> opened on line 2 is never closed",
  );
});

test("refuses a close with no block open", () => {
  expect(() => renderPayload("a\n<!--/private-->\nb\n", false)).toThrow(
    "payload: <!--/private--> on line 2 closes nothing",
  );
});

test("refuses an open inside an open block", () => {
  expect(() => renderPayload("<!--private-->\na\n<!--public-->\n", false)).toThrow(
    "payload: <!--public--> on line 3 opens inside the block opened on line 1",
  );
});

// The verbs import their payloads as text, so nothing else in the suite would
// notice a marker a later edit leaves unpaired in a file no test happens to
// render. Reading the directory rather than a list keeps a file added later
// under the same check.
const dir = path.join(import.meta.dir, "..", "payload");

for (const name of readdirSync(dir)) {
  test(`payload/${name} renders both ways, with no marker residue`, () => {
    const text = readFileSync(path.join(dir, name), "utf8");
    for (const isPublic of [false, true]) {
      const out = renderPayload(text, isPublic);
      for (const line of out.split("\n")) expect(line).not.toMatch(MARKER);
    }
  });
}
