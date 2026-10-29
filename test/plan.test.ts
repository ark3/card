import { expect, test } from "bun:test";
import { slugify } from "../src/plan.ts";

test("a headline's slug drops punctuation inside words and hyphenates word breaks", () => {
  expect(slugify("Add the export button")).toBe("add-the-export-button");
  expect(slugify("Configure src/db.clj")).toBe("configure-srcdbclj");
  expect(slugify("  Fix  the  -- double   spaces  ")).toBe("fix-the-double-spaces");
  expect(slugify("Don't drop `card done`'s refusal!")).toBe("dont-drop-card-dones-refusal");
  expect(slugify("— …")).toBe("");
});
