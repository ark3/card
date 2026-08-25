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
