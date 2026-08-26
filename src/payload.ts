// A payload file carries both privacy renderings of its prose: lines fenced by
// `<!--private-->`/`<!--/private-->` are served only to a private deck's
// session, lines fenced by `<!--public-->`/`<!--/public-->` only to a public
// one. Each marker stands alone on its own line and reaches neither rendering,
// so a session never sees the state it is not in, or the seam.

const OPEN = /^<!--(private|public)-->$/;
const CLOSE = /^<!--\/(?:private|public)-->$/;

export function renderPayload(text: string, isPublic: boolean): string {
  const kept: string[] = [];
  let dropping = false;
  for (const line of text.split("\n")) {
    const open = OPEN.exec(line);
    if (open !== null) {
      dropping = (open[1] === "public") !== isPublic;
      continue;
    }
    if (CLOSE.test(line)) {
      dropping = false;
      continue;
    }
    if (!dropping) kept.push(line);
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
