import { expect, test } from "bun:test";
import { drawId } from "../src/id.ts";

// `reference/tracking.md`: `<PREFIX>-` and three consonant-vowel syllables,
// from eighteen consonants and five vowels.
const SHAPE = /^proj-([bdfghjklmnprstvwyz][aeiou]){3}$/;

test("draws ids of the specified shape, under the prefix it is given", () => {
  for (let i = 0; i < 500; i++) expect(drawId("proj")).toMatch(SHAPE);
  expect(drawId("OW")).toMatch(/^OW-[a-z]{6}$/);
});

test("draws rather than counts", () => {
  const drawn = new Set(Array.from({ length: 200 }, () => drawId("proj")));
  // 729,000 in three syllables, so 200 draws colliding more than a handful of
  // times means the draw is not random.
  expect(drawn.size).toBeGreaterThan(190);
});
