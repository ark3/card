// `reference/tracking.md`, "Ids are drawn at random", is the specification.
// Eighteen consonants — no `c`, `q` or `x` — times five vowels is ninety per
// syllable, 729,000 in three.
const CONSONANTS = "bdfghjklmnprstvwyz";
const VOWELS = "aeiou";

function pick(alphabet: string): string {
  return alphabet[Math.floor(Math.random() * alphabet.length)]!;
}

export function drawId(prefix: string): string {
  let drawn = "";
  for (let i = 0; i < 3; i++) drawn += pick(CONSONANTS) + pick(VOWELS);
  return `${prefix}-${drawn}`;
}
