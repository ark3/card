#!/usr/bin/env bun
import * as author from "./verbs/author.ts";
import * as close from "./verbs/close.ts";
import * as cmd from "./verbs/cmd.ts";
import * as execute from "./verbs/execute.ts";
import * as init from "./verbs/init.ts";
import * as lintCommit from "./verbs/lint-commit.ts";
import * as list from "./verbs/list.ts";
import * as neu from "./verbs/new.ts";
import * as show from "./verbs/show.ts";
import * as status from "./verbs/status.ts";
import * as workflow from "./verbs/workflow.ts";
import * as worktree from "./verbs/worktree.ts";

type Verb = (args: string[], cwd: string) => Promise<void>;

const VERBS: Record<string, Verb> = {
  status: status.run,
  init: init.run,
  new: neu.run,
  show: show.run,
  list: list.run,
  close: close.run,
  cmd: cmd.run,
  "lint-commit": lintCommit.run,
  worktree: worktree.run,
  author: author.run,
  execute: execute.run,
  workflow: workflow.run,
};

const USAGE = `usage: card <verb> [...]

  ${Object.keys(VERBS).join("  ")}`;

const [name, ...args] = process.argv.slice(2);
const verb = name === undefined ? undefined : VERBS[name];

if (verb === undefined) {
  if (name !== undefined) console.error(`card: no such verb as \`${name}\``);
  console.error(USAGE);
  process.exit(1);
}

try {
  await verb(args, process.cwd());
} catch (error) {
  console.error(`card: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
