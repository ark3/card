# Working in this repository

`bun test` is the check, and it is a floor: nothing in the suite reads payload prose beyond asserting a few headings survive, so a green run never verifies a payload change.
The check for prose is a cold read — hand the finished file to an agent with no other context and ask it the question the change is supposed to settle.
Every file ends with a trailing newline.
Prose is one sentence per line: a line break falls where a sentence ends, never at a column count, and a long sentence stays one long line.

Nothing public ever cites a card id: not a commit message, not a pull request, not a comment in the code.
This repo's own history is public tier.

## The register for payload files

The rules below bind `payload/*.md` — the prose that operates the workflow.
They do not bind BRIEF.md, close notes, or commit messages, which are rationale and record, not procedure.

The payload is read by a literal model reader working under load, and every past defect in these files was an ambiguity bug of one of a few kinds.
The rewrite of 2026-08-22 (`reference/payload-rewrite/`) removed them class by class; these rules are what keep a later edit from reintroducing one.

- **Every imperative names its actor.**
  No agentless passives: "the card is amended" hid who amends and stalled real sessions.
  Say "amend the card yourself" or "the dispatching session commits".
- **A sentence that grants what another role is denied names the granted role, never "you".**
  Every reader of a payload file parses itself as "you", including dispatched agents the file is not addressed to, so "you may commit here" read by an implementer inverts the one bar the payload puts on it.
  "The dispatching session" is safe: an agent knows it did not dispatch itself.
  A duty no role is denied — amending a card, filing one — may say "you"; the role form is owed wherever a bar exists for someone.
- **One term per concept, and one concept per term.**
  "Cold read" once named both a dispatched reader and an owner-held stopping condition, with opposite consequences.
  Before reusing a term, check what it already names.
- **State a rule where it binds.**
  A rule that lives in one section and governs another survives only as long as readers carry it forward; edits that weaken the distant sentence break the near one silently.
- **An exception states what its rule protects.**
  "Edit only what review put in front of you" was widened by readers because the rule never said what it was guarding.
  Name the purpose first, then the exception is safe to name.
- **Say only what the corporate repo cannot say for itself.**
  Nothing about branch policy, review process, or anything the host repository documents; the test is whether a colleague reading the line would learn this workflow exists.
- **Address prose by quoted phrase and section, never by line number.**
  Line numbers go stale silently and still resolve, to the wrong text.

When a payload change lands, check the sentence you touched against these rules, and check what else in the three files states or depends on the same rule — the files deliberately restate a few rules in their own vocabulary, and only a change of rule, not of wording, needs propagating.
