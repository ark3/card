import { afterAll, afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { answerInstruction, type ObjectSchema, readAnswer } from "../src/answer.ts";
import { chooseHarness, type Harness, launch, REPAIR_PROMPTS, resume, RoleFailure } from "../src/harness.ts";
import { calls, type Reply, removeTempDirs, script, stand, tempDir } from "./helpers.ts";

const OUTER_PATH = process.env.PATH;

afterEach(() => {
  if (OUTER_PATH === undefined) delete process.env.PATH;
  else process.env.PATH = OUTER_PATH;
});
afterAll(removeTempDirs);

/**
 * A PATH holding only the stand-ins the test names, so a real `claude` or `pi`
 * on the machine never decides the choice.
 */
function onPath(...names: string[]): void {
  const bin = tempDir();
  for (const name of names) writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env.PATH = bin;
}

test("with claude and pi both on PATH the choice is Claude Code, because claude is on PATH", () => {
  onPath("claude", "pi");
  expect(chooseHarness(null)).toEqual({ harness: "claude", why: "claude is on PATH" });
});

test("with only pi on PATH the choice is Pi, because claude is not", () => {
  onPath("pi");
  expect(chooseHarness(null)).toEqual({ harness: "pi", why: "pi is on PATH and claude is not" });
});

test("with neither claude nor pi on PATH the choice is refused", () => {
  onPath();
  expect(() => chooseHarness(null)).toThrow("neither claude nor pi is on PATH");
});

test("--harness overrides the choice PATH would make, and says the flag chose it", () => {
  onPath("claude", "pi");
  expect(chooseHarness("pi")).toEqual({ harness: "pi", why: "--harness named it" });
});

test("--harness naming a harness that is not on PATH is refused", () => {
  onPath("claude");
  expect(() => chooseHarness("pi")).toThrow("--harness names pi, but pi is not on PATH");
});

/** A small role answer: an outcome word, a string, and an optional list of findings. */
const SCHEMA: ObjectSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["done", "blocked"] },
    account: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: { headline: { type: "string" }, body: { type: "string" } },
        required: ["headline", "body"],
      },
    },
  },
  required: ["outcome", "account"],
};

const GOOD = { outcome: "done", account: "did it" };

/** Claude Code's `--output-format json` result, abridged to the fields the launcher reads. */
function claudeJson(result: string, isError = false, subtype = "success"): Reply {
  return { stdout: JSON.stringify({ type: "result", subtype, is_error: isError, result, session_id: "x" }) };
}

const ID = "6f1c2c1e-0000-4000-8000-000000000001";
const CLAUDE_LAUNCH = ["claude", "-p", "--output-format", "json", "--permission-mode", "bypassPermissions", "--session-id", ID];
const CLAUDE_RESUME = ["claude", "-p", "--output-format", "json", "--permission-mode", "bypassPermissions", "--resume", ID];
const PI = ["pi", "-p", "--session-id", ID];

function session(harness: Harness) {
  return { harness, id: ID, dir: tempDir() };
}

test("Claude Code launches with --session-id and resumes with --resume, the prompt on stdin, in the named directory", async () => {
  const control = stand();
  const role = session("claude");
  script(control, ID, claudeJson(JSON.stringify(GOOD)), claudeJson(JSON.stringify(GOOD)));
  await launch(role, "first prompt", SCHEMA);
  await resume(role, "second prompt", SCHEMA);
  const [first, second] = calls(control, ID);
  expect(first.argv).toEqual(CLAUDE_LAUNCH);
  expect(second.argv).toEqual(CLAUDE_RESUME);
  expect(first.stdin).toBe(`first prompt\n\n${answerInstruction(SCHEMA)}`);
  expect(second.stdin).toBe(`second prompt\n\n${answerInstruction(SCHEMA)}`);
  expect(first.cwd).toBe(role.dir);
  expect(second.cwd).toBe(role.dir);
});

test("Pi launches and resumes alike with --session-id, the prompt on stdin, in the named directory", async () => {
  const control = stand();
  const role = session("pi");
  script(control, ID, { stdout: JSON.stringify(GOOD) }, { stdout: JSON.stringify(GOOD) });
  await launch(role, "first prompt", SCHEMA);
  await resume(role, "second prompt", SCHEMA);
  const [first, second] = calls(control, ID);
  expect(first.argv).toEqual(PI);
  expect(second.argv).toEqual(PI);
  expect(first.stdin).toBe(`first prompt\n\n${answerInstruction(SCHEMA)}`);
  expect(second.stdin).toBe(`second prompt\n\n${answerInstruction(SCHEMA)}`);
  expect(first.cwd).toBe(role.dir);
  expect(second.cwd).toBe(role.dir);
});

test("a Claude Code result holding one JSON object is the answer", async () => {
  const control = stand();
  const answer = { ...GOOD, findings: [{ headline: "h", body: "b" }] };
  script(control, ID, claudeJson(`\n${JSON.stringify(answer)}\n`));
  expect(await launch(session("claude"), "go", SCHEMA)).toEqual(answer);
});

test("a Claude Code result with the error flag is a failure naming its cause", async () => {
  const control = stand();
  script(control, ID, { ...claudeJson("API Error: overloaded", true, "error_during_execution"), exit: 0 });
  const failed = launch(session("claude"), "go", SCHEMA);
  await expect(failed).rejects.toBeInstanceOf(RoleFailure);
  await expect(failed).rejects.toThrow("Claude Code reported an error (error_during_execution): API Error: overloaded");
});

test("Claude Code output that is not JSON is a failure", async () => {
  const control = stand();
  script(control, ID, { stdout: "Segmentation fault" });
  await expect(launch(session("claude"), "go", SCHEMA)).rejects.toThrow("Claude Code's output is not JSON: Segmentation fault");
});

test("a non-zero exit is a failure carrying what the harness printed", async () => {
  const control = stand();
  script(control, ID, { stderr: "No conversation found with session ID\n", exit: 1 });
  const failed = launch(session("pi"), "go", SCHEMA);
  await expect(failed).rejects.toBeInstanceOf(RoleFailure);
  await expect(failed).rejects.toThrow("pi exited with status 1: No conversation found with session ID");
});

test("Pi's plain output is the answer, and its new-session warning on stderr is no failure", async () => {
  const control = stand();
  script(control, ID, {
    stdout: `${JSON.stringify(GOOD)}\n`,
    stderr: "No project session found with id; creating a new session\n",
  });
  expect(await launch(session("pi"), "go", SCHEMA)).toEqual(GOOD);
});

test("an answer with prose around its JSON gets a repair by resuming, carrying the fence, the error and the schema", async () => {
  const control = stand();
  const role = session("claude");
  script(control, ID, claudeJson(`Here is my report: ${JSON.stringify(GOOD)}`), claudeJson(JSON.stringify(GOOD)));
  expect(await launch(role, "go", SCHEMA)).toEqual(GOOD);
  const [first, repair] = calls(control, ID);
  expect(first.argv).toEqual(CLAUDE_LAUNCH);
  expect(repair.argv).toEqual(CLAUDE_RESUME);
  expect(repair.cwd).toBe(role.dir);
  let error = "";
  try {
    readAnswer(SCHEMA, `Here is my report: ${JSON.stringify(GOOD)}`);
  } catch (thrown) {
    error = (thrown as Error).message;
  }
  expect(error).not.toBe("");
  expect(repair.stdin).toContain(
    "The work attempt is finished.\nDo not continue implementing or reviewing.\nDo not modify any files.\nCorrect only the final report.",
  );
  expect(repair.stdin).toContain(`The previous report was invalid:\n${error}\n`);
  expect(repair.stdin).toContain(answerInstruction(SCHEMA));
  expect(repair.stdin).not.toContain("go\n\n");
});

test("Pi's repair resumes the same session too", async () => {
  const control = stand();
  script(control, ID, { stdout: "```json\n{}\n```" }, { stdout: JSON.stringify(GOOD) });
  expect(await launch(session("pi"), "go", SCHEMA)).toEqual(GOOD);
  const [, repair] = calls(control, ID);
  expect(repair.argv).toEqual(PI);
  expect(repair.stdin).toContain("Correct only the final report.");
});

test("an answer still malformed after two repairs is a failure, and no third repair is sent", async () => {
  const control = stand();
  const bad = claudeJson(JSON.stringify({ outcome: "finished", account: "x" }));
  script(control, ID, bad, bad, bad, claudeJson(JSON.stringify(GOOD)));
  const failed = launch(session("claude"), "go", SCHEMA);
  await expect(failed).rejects.toBeInstanceOf(RoleFailure);
  await expect(failed).rejects.toThrow(`still malformed after ${REPAIR_PROMPTS} repair prompts`);
  await failed.catch(() => {});
  expect(REPAIR_PROMPTS).toBe(2);
  expect(calls(control, ID).map((call) => call.argv[6])).toEqual(["--session-id", "--resume", "--resume"]);
});

test("an answer its check refuses gets a repair quoting the check's error, as a schema mismatch does", async () => {
  const control = stand();
  const refuse = (answer: Record<string, unknown>) => {
    if (answer.account === "bad") throw new Error("answer.account is bad");
  };
  script(control, ID, { stdout: JSON.stringify({ ...GOOD, account: "bad" }) }, { stdout: JSON.stringify(GOOD) });
  expect(await launch(session("pi"), "go", SCHEMA, refuse)).toEqual(GOOD);
  const [, repair] = calls(control, ID);
  expect(repair.stdin).toContain("The previous report was invalid:\nanswer.account is bad\n");
});

test("the schema yields both the instruction and the validation, so changing it changes both", () => {
  const widened: ObjectSchema = {
    ...SCHEMA,
    properties: { ...SCHEMA.properties, subject: { type: "string" } },
    required: [...SCHEMA.required, "subject"],
  };
  expect(answerInstruction(SCHEMA)).toContain(JSON.stringify(SCHEMA));
  expect(answerInstruction(SCHEMA)).not.toContain("subject");
  expect(answerInstruction(widened)).toContain(JSON.stringify(widened));
  expect(readAnswer(SCHEMA, JSON.stringify(GOOD))).toEqual(GOOD);
  expect(() => readAnswer(widened, JSON.stringify(GOOD))).toThrow('lacks the required field "subject"');

  const reworded: ObjectSchema = {
    ...SCHEMA,
    properties: { ...SCHEMA.properties, outcome: { type: "string", enum: ["approved", "revision"] } },
  };
  expect(answerInstruction(reworded)).toContain('"enum":["approved","revision"]');
  expect(() => readAnswer(reworded, JSON.stringify(GOOD))).toThrow('answer.outcome is "done", which is not one of');
});

test("the answer is checked field by field, into lists of objects", () => {
  expect(() => readAnswer(SCHEMA, "[]")).toThrow("answer is not an object");
  expect(() => readAnswer(SCHEMA, '{"outcome":"done","account":3}')).toThrow("answer.account is not a string");
  expect(() =>
    readAnswer(SCHEMA, JSON.stringify({ ...GOOD, findings: [{ headline: "h", body: "b" }, { headline: "h" }] })),
  ).toThrow('answer.findings[1] lacks the required field "body"');
  expect(() => readAnswer(SCHEMA, `${JSON.stringify(GOOD)} ${JSON.stringify(GOOD)}`)).toThrow(
    "the final response is not one JSON object alone",
  );
});
