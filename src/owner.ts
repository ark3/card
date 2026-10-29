import relay from "../payload/relay.md" with { type: "text" };

// The owner sees a printout only through the session's reply, and a session
// left to its own judgment retells, so text meant for the owner goes out
// inside marks the relay sentence ahead of them tells the session to copy
// whole. Every printout builds its owner text here, so neither the marks nor
// the sentence is spelled anywhere else. The contents sit between the marks
// byte for byte; the closing mark always starts its own line, so contents
// that end without a newline get one before it, and contents that end with
// one get nothing more, which costs only the difference between the two.
export function forOwner(contents: string): string {
  const close = contents.endsWith("\n") ? "" : "\n";
  return `${relay}<for_owner>\n${contents}${close}</for_owner>\n`;
}
