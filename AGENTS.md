# Working in this repository

This repository develops `card` and uses it to track its own work, in a private, agent-facing deck.
Run `card status` before you act: it reports this repo's deck.
The rules that bind card work live in `card workflow` — run it before you touch a card — among them that a finding survives only once it is a card, never in the transcript alone.

`bun test` is the check, and it is a floor: nothing in the suite reads payload prose beyond asserting a few headings survive, so a green run never verifies a payload change.
The check for prose is a cold read — hand the finished file to an agent with no other context and ask it the question the change is supposed to settle.
Ask for the answer, not for the reading experience; the bar that follows governs filing however a finding surfaced.
The bar protects the tracker's signal and the owner's triage: a finding from a prose check is card-worthy only when the misreading survives the passage — the reader answers the settling question wrong or would act wrong, two competent readers resolve the same text opposite ways (the text is silent, not unclear), or the right reading is rescued only from outside the passage.
The rescued case stays card-worthy because an edit elsewhere can silently break the rescue.
A stumble the passage itself corrects — resolved within its own sentence or paragraph, with the answer right — is never a card: whoever ran the check records it as one line in the close note of the work under check, with the condition that would make it card-worthy, and that line is what keeps a below-bar finding durable, which is what filing exists to guarantee.
Every file ends with a trailing newline.
Prose is one sentence per line: a line break falls where a sentence ends, never at a column count, and a long sentence stays one long line.

Nothing public ever cites a card id: not a commit message, not a pull request, not a comment in the code.
This repo's own history is public tier.

## Routing payload work

Which session works payload prose is the owner's choice, and the `payload` label is how the deck carries that choice.
File any card whose change lands in `payload/*.md` with `--label payload`.
A session executing a card that lacks the label never edits `payload/*.md`, whatever the card turns out to need: stop and hand the card back, and the owner amends the label and picks the session to re-dispatch it to.
That gate binds card execution only; a payload edit the owner asks a session for directly is authorized by the ask.

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
