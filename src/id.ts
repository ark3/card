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

/**
 * Matches every citation of a `prefix` deck's ids in arbitrary text, built from
 * the same alphabets `drawId` draws from so the shape is stated once. Neither
 * neighbour may be a letter or a digit, so a longer word that merely contains
 * an id shape is not a citation.
 */
export function idPattern(prefix: string): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const syllable = `[${CONSONANTS}][${VOWELS}]`;
  return new RegExp(`(?<![0-9A-Za-z])${escaped}-(?:${syllable}){3}(?![0-9A-Za-z])`, "g");
}
