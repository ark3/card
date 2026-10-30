import { GRACE_SECONDS } from "./plan.ts";

/**
 * The form of a role's answer, as a subset of JSON Schema: the same object is
 * stated in the prompt as the instruction and checked against as the
 * validation, so what a session is told to write and what the tool accepts
 * cannot drift apart. Fields an object schema does not list are allowed, as
 * JSON Schema allows them.
 */
export type Schema = { type: "string"; enum?: string[] } | { type: "array"; items: Schema } | ObjectSchema;
export type ObjectSchema = { type: "object"; properties: Record<string, Schema>; required: string[] };

/** An answer that has passed its schema. */
export type Answer = Record<string, unknown>;

/**
 * The instruction appended to a role's prompt and to the repair prompt,
 * naming `file`, the answer file, and restating `schema` whole. It states the
 * signals the turn's sweep sends (`end` in plan.ts), so a change to them
 * changes this sentence too.
 */
export function answerInstruction(schema: ObjectSchema, file: string): string {
  return `Write your report, one JSON object matching this JSON Schema, to \`${file}\`, then respond with \`done\`. The tool takes your answer from that file as soon as it holds complete JSON, and once it has taken your answer it stops every process your commands started that is still running: it sends each one SIGTERM, which lets a process shut down cleanly, and ${GRACE_SECONDS} seconds later SIGKILL, which no process can catch, to whatever is still running.\n${JSON.stringify(schema)}`;
}

/**
 * The answer in `text`, what a session wrote to its answer file, which has
 * to be one JSON object matching `schema` and nothing else. Throws an error
 * whose message says what is wrong, which the repair prompt quotes back to
 * the session.
 */
export function readAnswer(schema: ObjectSchema, text: string): Answer {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`the answer file does not hold one JSON object alone: ${(error as Error).message}`);
  }
  const problem = mismatch(schema, value, "answer");
  if (problem !== null) throw new Error(problem);
  return value as Answer;
}

/** What is wrong with `value` at `at` against `schema`, or null if nothing is. */
function mismatch(schema: Schema, value: unknown, at: string): string | null {
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return `${at} is not a string`;
      if (schema.enum !== undefined && !schema.enum.includes(value)) {
        const words = schema.enum.map((word) => JSON.stringify(word)).join(", ");
        return `${at} is ${JSON.stringify(value)}, which is not one of ${words}`;
      }
      return null;
    case "array":
      if (!Array.isArray(value)) return `${at} is not an array`;
      for (const [index, item] of value.entries()) {
        const problem = mismatch(schema.items, item, `${at}[${index}]`);
        if (problem !== null) return problem;
      }
      return null;
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return `${at} is not an object`;
      const fields = value as Record<string, unknown>;
      for (const name of schema.required) {
        if (!(name in fields)) return `${at} lacks the required field ${JSON.stringify(name)}`;
      }
      for (const [name, field] of Object.entries(schema.properties)) {
        if (!(name in fields)) continue;
        const problem = mismatch(field, fields[name], `${at}.${name}`);
        if (problem !== null) return problem;
      }
      return null;
    }
  }
}
