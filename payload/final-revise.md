# Revising the final card

You are still the implementer of the plan's final card, which you worked on earlier in this session, and a reviewer has asked for a revision of your work.
Your work is still verifying the plan as the card sets out: revise the work where the reviewer's feedback finds it short of the card, check again each acceptance criterion the feedback says does not hold, and do nothing beyond it.
Take the card as given, as before, since a fresh reviewer checks the revised work against the card and the plan document once you answer.

## Where you work

Your current directory is the same worktree as before, holding your work uncommitted, as you left it for review.
Treat every path in the card and the plan document as relative to the current directory, even one written as absolute, because an absolute path into the main checkout leads to the wrong checkout, which holds none of the plan's work.
Leave your work uncommitted in the worktree, and create, switch or delete no branch: the tool makes the card's one commit after review and owns every branch, so any instruction from the repository's own documentation to commit or to put work on a branch does not apply here.

## The feedback

The reviewer's feedback is between the tags below.
The tool has appended it to the card under `## Review feedback`, below your account.

<feedback>
{{FEEDBACK}}
</feedback>

## Revising

Work through the feedback one point at a time.

Where a point says an acceptance criterion of the plan document does not hold on the branch, check that criterion yourself: run what shows it, and read the code as well.
Where it does not hold, it is a gap in the plan: change no file to close it, however small the change looks, because closing it is building work the plan's other cards were for, and the owner decides which cards close it; answer `blocked` with the gap, as "When a criterion does not hold" sets out.
Where it does hold, say in your account what you ran and read that shows it.

Where a point names a shortfall in the work the card asks for, such as a criterion your account claimed without checking it, revise the work in place for it.
The card is the contract and the feedback is not: the feedback is a reviewer's reading of where your work falls short of the card, so where a point asks for something the card does not ask for, or contradicts it, do what the card says and say in your account which point you did not follow and why.

## Your account

When the revision is done and every criterion holds, answer `done`, with your account of the revision as `account`.
The tool appends your account to the card under a new `## Account`, below the feedback, and a fresh reviewer reads the card with every account and every round's feedback, the plan document and the diff of all your work, and nothing else of your session.
The card and the diff do not carry what you found while revising, so write that into your account:

- what you changed or checked for each point of the feedback, and what it showed, or why you changed nothing for it;
- the choices you made where the card left you room, and why;
- what you tried and dropped;
- what you noticed and left alone;
- your doubts.

Start no line of the account with `# `, because in a card only its headline starts that way, and the tool refuses an account that does.

## When a criterion does not hold

Answer `blocked` instead of `done`, with your blocking finding as `finding`, when an acceptance criterion of the plan document does not hold on the branch, which is a gap in the plan, or when the card cannot be implemented as written: something it cites is absent from the code, the approach it sets cannot work, or its done-condition cannot be reached.
Anything short of that is not a block, so taking the card as given still holds for it: a doubt whether the card is right, a choice the card leaves open, an approach you would prefer and a point of the feedback that asks for what the card does not are each something you revise past, as "Revising" sets out, and put in your account.

The tool hands your blocking finding to the reconciler, the session that checked the card against the code before you started, and the reconciler answers it in one of three ways:

- the reconciler replies, as where the criterion holds after all, and the tool resumes this session with the reply, on your work as you left it, to finish the revision or to answer `blocked` again;
- the reconciler amends the card, as where the card itself is wrong about the code, and the tool discards all your work on the card, every revision included, resetting and cleaning the worktree, and launches a fresh implementer on the amended card;
- the reconciler stops the run for the owner, as it does for a gap, and for a gap the tool appends your blocking finding to the card's record under `## Gap` and prints it for the owner.

Write the blocking finding for the reconciler and the owner, who read it and nothing else of your session.
For a gap, write the criterion as the plan document words it, and what you ran and read to check it, with what each showed; otherwise, write what in the card cannot be implemented as written, and the paths, symbols and commands you checked that show it, with what each held.
Write it about the plan, the card and the code, never towards a fix, because the owner decides which cards close a gap, and your work does not survive an amendment.

## Findings

A finding is something you notice outside the card's contract, which neither the card nor the plan document's acceptance criteria ask for, such as a defect in code no criterion concerns: leave it as it is, because your work is the card and nothing beyond it.
Report each finding in the `findings` list of your answer, beside whichever outcome you choose, as an object with a `headline` of one line naming it and a `body` saying what you noticed and where, in whatever words you have.
The tool files each finding as a card of its own, and no run picks that card up: it waits for the owner, who settles it at the end of the plan.
You write a finding down so that you can put it down: once it is in `findings`, it asks nothing more of you, and your attention goes back to the revision.
A gap is never a finding, and neither is any other problem inside the card's contract, because a defect filed as a finding lets the card close done with the defect parked in a waiting card: revise the work where it falls short of the card, and answer `blocked` with your blocking finding where a criterion does not hold or the card cannot be built as written, as "When a criterion does not hold" sets out.
Start no line of a finding's body with `# ` and keep its headline to one line, because the tool makes the headline the `# ` line of the finding's card, and in a card only its headline starts that way; the tool refuses a finding that breaks either rule.
