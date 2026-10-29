#!/usr/bin/env bun
// No verb to import yet; this keeps the file a module, which top-level await needs.
export {};

type Verb = (args: string[], cwd: string) => Promise<void>;

const VERBS: Record<string, Verb> = {};

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
