import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderPayload } from "../src/payload.ts";

// A comment on a line of its own reaches a rendering only two ways, and both are
// defects: the renderer failed to strip a marker it recognized, or the line names
// something `OPEN` and `CLOSE` do not match and so fenced nothing at all — the
// case a marker misspelled in both halves of its pair falls into, where the
// pairing errors stay silent and the prose inside goes out to both renderings.
// So nothing comment-shaped survives, not merely nothing that parses as a marker.
const COMMENT = /^<!--.*-->$/;

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
  test(`payload/${name} renders both ways, with no comment residue`, () => {
    const text = readFileSync(path.join(dir, name), "utf8");
    for (const isPublic of [false, true]) {
      const out = renderPayload(text, isPublic);
      for (const line of out.split("\n")) expect(line).not.toMatch(COMMENT);
    }
  });
}
