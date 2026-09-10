// A payload file carries both privacy renderings of its prose: lines fenced by
// `<!--private-->`/`<!--/private-->` are served only to a private deck's
// session, lines fenced by `<!--public-->`/`<!--/public-->` only to a public
// one. Each marker stands alone on its own line and reaches neither rendering,
// so a session never sees the state it is not in, or the seam.

const OPEN = /^<!--(private|public)-->$/;
const CLOSE = /^<!--\/(?:private|public)-->$/;

// An unpaired marker is silent where it hurts most: a lost closer drops every
// later line from one rendering while the other stays whole, so the file reads
// as it should to whoever edited it and a section goes missing from a session
// nobody is running yet. So the renderer refuses a file whose markers do not
// pair, and names the marker and its line for whoever has to find it.
export function renderPayload(text: string, isPublic: boolean): string {
  const kept: string[] = [];
  let dropping = false;
  let openMarker: { text: string; line: number } | null = null;
  for (const [index, line] of text.split("\n").entries()) {
    const number = index + 1;
    const open = OPEN.exec(line);
    if (open !== null) {
      if (openMarker !== null) {
        throw new Error(`payload: ${line} on line ${number} opens inside the block opened on line ${openMarker.line}`);
      }
      openMarker = { text: line, line: number };
      dropping = (open[1] === "public") !== isPublic;
      continue;
    }
    if (CLOSE.test(line)) {
      if (openMarker === null) throw new Error(`payload: ${line} on line ${number} closes nothing`);
      openMarker = null;
      dropping = false;
      continue;
    }
    if (!dropping) kept.push(line);
  }
  if (openMarker !== null) {
    throw new Error(`payload: ${openMarker.text} opened on line ${openMarker.line} is never closed`);
  }
  return kept.join("\n");
}

// A session reading a payload through `head` or a grep sees a clean prefix and
// nothing telling it the rest existed, so every payload goes out inside a
// block whose first line says how to tell a partial read from a whole one.
// Line 1 is the one line every truncation keeps, so that is where the
// detection instruction rides; the closing tag is the last line, and the
// guidance describes it rather than quoting it, so the quoted copy can never
// be mistaken for the real terminator.
export function wrapPayload(verb: string, body: string): string {
  const tag = `card_${verb}`;
  const guidance = `Everything below is one block that ends with the matching closing tag alone on the last line, so if you do not see that closing tag, you are holding only part of this block: rerun \`card ${verb}\` bare, with no pipe and no filter, and read the whole block before you act on any of it.`;
  return `<${tag}> ${guidance}\n${body}</${tag}>\n`;
}
