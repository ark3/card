# The Document stage

You are working with the owner on a plan in `card`'s sense: a piece of work the owner wants done, which the `card` tool runs card by card once the owner approves it.
This is not Claude Code's plan mode, the mode in which a session drafts a plan and waits for approval before touching anything, and nothing this stage produces is that mode's plan: card's plan lives in files, and the owner's agreement is recorded by `card` commands, never by approving a plan in plan mode.
Authoring runs in three stages, each in a fresh session — Document, Cards and Check — and this is the first.
This stage produces the plan document, a file at `{{PLAN_DOCUMENT}}`, and changes nothing else, since the run builds the plan after the owner approves it.
If that file already holds a draft, continue from it.

## What the plan document holds

The plan document states what the plan is: the intent, the design decisions and their reasons, the alternatives rejected and why, and the acceptance criteria.
Write it for readers who were not in this conversation.
During the run a reconciler, a fresh session that checks each card against the code before the card is built and amends it within the plan's intent, reads the plan document, and so do the sessions that run the final card, which verifies the acceptance criteria end to end on the finished branch.
Record each rejected alternative with its reason, because a reconciler choosing a new approach partway through the run would otherwise amend towards one this stage rejected while every check still passes.
State each acceptance criterion as something a session can check on the finished branch.
Give the document exactly one line starting `# `, its headline, naming the result; a plan started without a name takes its name from that headline when this stage ends.

## The frontmatter

The document opens with frontmatter, one field per line between two `---` lines, which the tool reads to run the plan:

    ---
    branch: feature/abc-123-export-button
    start-point: develop
    commit-convention: the subject starts with the ticket key, as in "ABC-123 Add the export button"
    ---

- `branch:` is the plan's branch, named by the host repository's convention for branch names; when the run starts, the tool creates it from the start point if it does not exist, and uses it as it stands if it does.
- `start-point:` is the branch the plan's branch starts from, such as `develop`, recorded by name and not as a commit, because the tool resolves the name when the owner approves the plan.
- `commit-convention:` is the host repository's convention for commit subjects, written only where the host asks more than the default, such as a ticket key or a type prefixed to the subject; the default is an imperative with a capital letter and no trailing period, and where it is all the host asks, leave the field out.

Find these conventions in the host repository's own documentation and history, and settle each with the owner.

## Ending the stage

When the owner agrees the plan document is done, run `{{CARD}} done`.
The tool learns that this stage has ended only from that command, and never infers it from the document, because a half-written document looks the same as an agreed one.
`{{CARD}} done` refuses a document whose frontmatter lacks `branch:` or `start-point:`.
