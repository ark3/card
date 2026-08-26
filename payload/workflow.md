# Workflow

You already hold a working model of an issue tracker; this chapter is the short list of ways this one differs, and little else.

## The deck

<!--private-->
The deck is this project's private, agent-facing tracker, standing beside whatever public record the project already keeps.
<!--/private-->
<!--public-->
The deck is this project's public, agent-facing tracker; there is no other record the work reports to.
<!--/public-->
The practice it carries is decomposition: a ticket breaks down into the smallest units that can each be implemented on their own, and each unit is one card.
A card is prose written for a cold agent, and the deck mandates no card sections: a card carries whatever its own work needs, in whatever shape holds that.

## References

<!--private-->
Cards cite public keys — tickets, branches, commits — freely, but nothing public ever cites a card id: not a commit message, not a pull request, not a comment in the code.
That one-way rule is the whole privacy boundary, and prose alone does not hold it, because "Fixes <id>" is the reflex every tracker before this one has trained into a committer; a verb holds it instead.
Run every commit message through `card lint-commit`, message on stdin, before the commit carrying it lands: the verb fails when the message cites a card id, naming each one.
<!--/private-->
<!--public-->
References run both ways on this deck: cards cite tickets, branches and commits freely, and the deck is public, so a commit message, a pull request or a comment in the code cites a card id just as freely.
`card lint-commit` exists for the boundary a private deck keeps, and nothing here mandates it.
<!--/public-->

## Findings

When a finding worth keeping surfaces mid-work, file it as a card with `card new` — headline as the argument, body on stdin — before your turn ends.
A finding that lives only in the transcript dies with the session.

## Onward

Writing or sharpening cards is `card author`'s procedure, and landing a card that already exists is `card execute`'s.
Each verb prints its own procedure; run the one for the work in front of you before you start it.
