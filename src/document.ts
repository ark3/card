import prompt from "../payload/document.md" with { type: "text" };
import { fill, wrapPayload } from "./payload.ts";
import { type Context, listPlans, renamePlan, slugify, writeRecord } from "./plan.ts";

/** The Document stage's prompt, which bare `card` prints for as long as the stage lasts. */
export async function printPrompt({ plan, command }: Context): Promise<void> {
  process.stdout.write(wrapPayload(command, fill(prompt, { CARD: command, PLAN_DOCUMENT: plan.document })));
}

/**
 * The plan document's frontmatter fields, one `name: value` line each between
 * `---` lines at its top, and its headline, the first line after them that
 * starts `# `.
 */
export function readDocument(text: string): { fields: Map<string, string>; headline: string | null } {
  const fields = new Map<string, string>();
  let body = text;
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 3);
    if (end !== -1) {
      for (const line of text.slice(4, end).split("\n")) {
        const colon = line.indexOf(":");
        if (colon !== -1) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
      }
      body = text.slice(end + 5);
    }
  }
  const headline = body.split("\n").find((line) => line.startsWith("# "));
  return { fields, headline: headline === undefined ? null : headline.slice(2).trim() };
}

/**
 * `card done` in the Document stage: the owner has agreed the plan document,
 * so the plan moves to Cards, under a slug made from its headline if it was
 * started without a name.
 */
export async function done({ deck, plan, command, args }: Context): Promise<void> {
  if (args.length > 0) throw new Error(`usage: ${command} done`);
  const file = Bun.file(plan.document);
  if (!(await file.exists())) {
    throw new Error(`there is no plan document at ${plan.document} yet, and the Document stage ends only once there is`);
  }
  const { fields, headline } = readDocument(await file.text());

  // Execution reads both, and a run cannot settle either with the owner.
  const missing = ["branch", "start-point"].filter((field) => !fields.get(field));
  if (missing.length > 0) {
    throw new Error(
      `the plan document's frontmatter lacks ${missing.map((field) => `\`${field}:\``).join(" and ")}, which the run needs; add it to ${plan.document}`,
    );
  }

  let moved = plan;
  if (plan.placeholder) {
    if (headline === null) throw new Error(`the plan document at ${plan.document} has no \`# \` headline to name the plan by`);
    const slug = slugify(headline);
    if (slug === "") throw new Error(`the headline \`${headline}\` has no letter or digit to name the plan by`);
    // Equal when a `done` stopped between this rename and the record below,
    // and the plan already sits under the name it is getting.
    if (slug !== plan.slug) {
      // Refused rather than numbered: two plans whose commands differ by a
      // `-2` are one stale picture away from the wrong plan's `done`.
      if ((await listPlans(deck)).some((other) => other.slug === slug)) {
        throw new Error(`another plan in progress is already named \`${slug}\`; give this plan document a headline of its own`);
      }
      moved = await renamePlan(deck, plan, slug);
    }
  }
  await writeRecord(moved, { state: "Cards", placeholder: false });
  console.log(`The Document stage is done, and the plan \`${moved.slug}\` is in the Cards stage.`);
}
