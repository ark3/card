// A session reading a payload through `head` or a grep sees a clean prefix and
// nothing telling it the rest existed, so every payload goes out inside a
// block whose first line says how to tell a partial read from a whole one.
// Line 1 is the one line every truncation keeps, so that is where the
// detection instruction rides; the closing tag is the last line, and the
// guidance describes it rather than quoting it, so the quoted copy can never
// be mistaken for the real terminator. `command` is what the guidance tells a
// session to rerun, and the tag is the command with every run of characters
// other than letters and digits made one `_`, so `deck agent-help` goes out
// as `<deck_agent_help>`.
export function wrapPayload(command: string, body: string): string {
  const tag = command.replace(/[^A-Za-z0-9]+/g, "_");
  const guidance = `Everything below is one block that ends with the matching closing tag alone on the last line, so if you do not see that closing tag, you are holding only part of this block: rerun \`${command}\` bare, with no pipe and no filter, and read the whole block before you act on any of it.`;
  return `<${tag}> ${guidance}\n${body}</${tag}>\n`;
}

// Payload placeholders are `{{NAME}}`. Every one a payload carries has to be
// given a value, so a payload that gains a placeholder its printer does not
// fill fails at its first print rather than going out with `{{` in it.
export function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`nothing fills {{${name}}} in a payload`);
    return value;
  });
}
