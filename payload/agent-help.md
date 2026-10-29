# The deck

These are the deck's conventions, for a session the owner has asked to work with the deck directly: what the deck is for, the shape of a card file, the `deck` verbs, how to cite a card, and the one rule about references.

## What the deck is for

A card is one item of work, and the deck is a repository's cards.
A plan here is the unit of work the `card` tool runs, not the plan Claude Code's plan mode drafts.
The deck holds a plan's cards while the plan runs, and that is what it is for.
A plan is done when every one of its cards has closed done, and that says nothing about whether the owner has other work; an empty deck, or no deck at all, says nothing about that either.
Only the owner decides whether there is work.

By default the deck lives under the repository's git common directory, at `<git-common-dir>/card/deck`, so every worktree of a repository reaches the same deck; `CARD_ROOT` set in the environment moves it.
git tracks nothing in that default place, so nothing `deck` writes there shows in `git status` or needs committing.

## The card file

A card is a markdown file named by its id, `<id>.md`, in the deck's `open/` directory, or in `closed/` once it has closed.
It has exactly one line starting `# `, its headline, which never wraps, and below it prose in whatever shape the card's own work needs.
Its frontmatter permits three fields and no others, each on one line: `blocked-by:` and `labels:`, lists written as `labels: [a, b]`, and `closed:`, which `deck close` writes.
Every field is optional: a list with nothing in it is left out, `closed:` appears only on a closed card, and a card with no fields has no frontmatter.
`blocked-by:` names the cards this one waits on, and labels are opaque strings that `deck` stores and matches without giving any of them a meaning.
An id is the deck's prefix, a hyphen, and three consonant-vowel syllables drawn at random.
A card ends one way: it moves from `open/` to `closed/`, gains `closed:` holding `done`, `promoted`, `declined` or `moot`, and gains its close note under a `## Close note` heading.
`done` says the work landed where the card said it would; the other three say it never happened: `promoted`, the work went to a public ticket; `declined`, someone chose not to do it; `moot`, the reason the card existed is gone.
No card is rewritten because another changed: `deck` computes every relation when it reads the deck, which keeps the deck something a person can edit with an editor and a grep.

## The verbs

`deck init`, `deck new` and `deck agent-help` run where there is no deck; every other verb answers "no deck here".

- `deck init <prefix>` creates the deck under the prefix given, and refuses where a deck already exists.
- `deck new '<headline>' [--label L]... [--blocked-by <id>]...`, body on stdin, draws an id, checks it against both directories and creates the card in `open/`, as one act, and prints the id.
  Where there is no deck, `deck new` first creates one under the default prefix, `card`; `deck init <prefix>` is how to choose another prefix before the first card.
  It refuses an empty body, a blocker that is closed or exists nowhere, and a run from a linked worktree, naming the main checkout to run it from.
  Create every new card with `deck new` and never by hand, because only the verb draws an id and claims it in the same act, so no two writers ever hold the same id.
- `deck show <id>` prints a card wherever it is, and `deck show <id> --path` prints its file's location instead, which is how to find a card to edit.
  A card changes directory when it closes, so build no path out of an id; ask `deck show <id> --path` for it.
- `deck list [--open | --ready | --closed] [--label L]...` lists cards one per line, id then headline, then any labels in brackets.
  Bare or with `--open` it lists the open cards, a blocked one marked with the blockers it still waits on; `--ready` narrows that to the open cards whose blockers have all closed; `--closed` lists the closed cards, each with how it ended; `--label` narrows any listing to the cards carrying every label given.
  Every listing puts the most recently modified card first.
- `deck close <id> --done|--promoted|--declined|--moot`, close note on stdin, moves the card to `closed/`, writes the outcome as `closed:` and appends the note under `## Close note`, as one act, and names the cards the closed one was blocking.
  It takes exactly one outcome flag, because the flag records what happened and the note says why.
  It refuses an empty note and a note that cites a card id, since a close note is written public-safe: it says what landed and how it was verified, or why the work never happened.
- `deck lint`, a text on stdin, fails when the text cites a card id of this deck, printing each such id on a line of its own; a text that cites none passes silently.
- `deck agent-help` prints this text.

## Citing a card

Ids are not mnemonic: the owner keeps them straight by the headline beside them, and copies an id out of a message into the next command, where any markup around it is a character the paste carries along.
So the first time a message names a card, cite it as `deck list` prints it, id then headline, in plain text — never in backticks, bold or a link — and later mentions in the same message may use the id alone.
The usages under "The verbs" put `<id>` in backticks because there the id sits inside a command; an id cited in prose is not code, and this rule, not those usages, governs it.
The headline is the deck's own line, so citing it copies nothing that drifts, where a retelling of a card's body is a second copy that drifts from the first; to say what a card holds, cite it and let `deck show` print it.

## References

Cards cite public keys — tickets, branches, commits — freely, and nothing public ever cites a card id: not a commit message, not a pull request, not a comment in the code.
That one-way rule is the whole privacy boundary, and prose alone does not hold it, because "Fixes <id>" is the reflex every tracker before this one has trained into a committer; `deck lint` holds it instead.
Run every commit message and pull request text through `deck lint`, on stdin, before it lands: `deck lint` fails when the text cites a card id, naming each one.
`deck close` runs the same check on every close note.
