import { expect, test } from "bun:test";
import relay from "../payload/relay.md" with { type: "text" };
import { forOwner } from "../src/owner.ts";

const OPEN = "<for_owner>\n";
const CLOSE = "</for_owner>\n";

test("puts the relay sentence before the marks and the contents between them byte for byte", () => {
  const contents = "# Promote\n\nPost this, exactly:\n\n```\ngit push origin main\n```\n\n- one\n- **two**\n";
  const block = forOwner(contents);
  expect(block).toBe(relay + OPEN + contents + CLOSE);
  expect(block.slice(relay.length + OPEN.length, block.length - CLOSE.length)).toBe(contents);
});

test("keeps the closing mark on its own line when the contents end without a newline", () => {
  const contents = "Line one.\n\nLine two, no newline after.";
  expect(forOwner(contents)).toBe(relay + OPEN + contents + "\n" + CLOSE);
});
