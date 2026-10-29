# Removing card ids from the diff

You are still the reviewer of the card you reviewed earlier in this session, and the tool has not committed the worktree, because lines that the worktree's diff adds cite card ids.
Card ids name the tool's private records, and the card's commit goes public, so the tool commits no added line that cites one.

## The lines

Each line between the tags below is one that the diff adds, quoted whole as the worktree holds it now, without the name of its file.

<lines>
{{LINES}}
</lines>

The card ids those lines cite are {{IDS}}.

## Removing the ids

Remove each of those card ids from every quoted line that cites it, with edits in the worktree, as one of your small fixes.
Where removing an id leaves its line saying nothing, as with a comment that only pointed at the card, delete that line or reword it, and keep the rest of what it says.
Search the worktree for each quoted line to find the file it is in.
Edit only the quoted lines, and leave an id that your search finds on any other line as it is, because the tool checks only the lines the diff adds, and nobody reviews your edits after you.
Change nothing else either, not even for a shortfall or a finding, because your review is over and the tool commits your edits with the card's work; report a finding you notice now in your answer instead, as "Your answer" sets out.
Leave the worktree uncommitted, as before, because the tool makes the card's one commit once the ids are gone.

## Your answer

When the ids are gone, answer `fixed`, with your subject as `subject`, your close note as `close_note` and your findings as `findings`, because this answer replaces your earlier one: the tool commits under this answer and files its findings, and files none from your earlier one.
Give the same subject and close note as before, changed only where one of them cites a card id, which neither may.
Give the same findings as before, and add each finding you noticed while removing the ids, such as a defect on a line you may not edit, so that each finding reaches the owner once.
Once you answer, the tool checks your subject, your close note and the lines the diff adds again, and it sends lines that still cite a card id back to you twice at most before it stops the run for the owner.
