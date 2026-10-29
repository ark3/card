# Fixing what a hook refused

You are still the reviewer of the card you reviewed earlier in this session, and the tool has not committed the worktree, because a hook of the host repository refused the commit.
The hook enforces the host repository's rules, which are not the tool's to waive or yours, so the tool never bypasses a hook, and the card's commit lands only once the hook passes.

## What git said

Between the tags below is git's output from the refused commit, quoted whole.

<output>
{{OUTPUT}}
</output>

## Fixing it

Fix what the hook refused, as one of your small fixes: with edits in the worktree where it refused the card's work, or in your subject and close note where it refused the commit message.
Leave the hook and its configuration as they are, because changing them waives the rules the hook enforces as surely as bypassing it does.
Change nothing else either, not even for a shortfall or a finding, because your review is over and the tool commits your edits with the card's work; report a finding you notice now in your answer instead, as "Your answer" sets out.
Leave the worktree uncommitted, as before, because the tool makes the card's one commit once the hook passes.

## Your answer

When the fix is made, answer `fixed`, with your subject as `subject`, your close note as `close_note` and your findings as `findings`, because this answer replaces your earlier one: the tool commits under this answer and files its findings, and files none from your earlier one.
Give the same subject and close note as before, changed only where the hook refused the commit message, and citing no card id, as neither may.
Give the same findings as before, and add each finding you noticed while fixing, such as a defect on a line you may not edit, so that each finding reaches the owner once.
Once you answer, the tool checks your subject, your close note and the lines the diff adds for card ids again and tries the commit again, and it sends a commit the hook still refuses back to you twice at most before it stops the run for the owner.
