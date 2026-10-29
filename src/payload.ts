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
