# Crit 5: A game

## What was the breakthrough that moved the work forward?

Working out that my tests could not see the thing I actually cared about.

The game is a brick breaker where smashed bricks rebuild themselves, so you have
to take the whole wall down in one burst. My tests checked that a brick comes
back at exactly the right moment, they all passed, and the game was impossible
to win anyway. The ball could not break twelve bricks fast enough to have them
all down at once.

That was uncomfortable, because I had been reading a full set of passing tests
as proof the week was going well. All it proved was that the code did what I
told it to. Nothing was checking whether that added up to a game anyone would
want to play.

So we built a different kind of check: a script that plays the game against a
pretend player and reports how it went. That caught it, then caught me out again
when I trusted it too fast, because the size of the play area was typed into it
by hand and had gone stale.

The habit I want to keep is asking what a check would still pass through.
Pausing and sliding the paddle under the ball took ten seconds to find by hand,
and nothing automated was ever going to notice.

## What did this work change about who I want to be as a software developer?

Someone who stays true to software that had a purpose and a point of view.

Brick Breaker came on my first phone, a BlackBerry Bold. Rebuilding it made me
notice how much character was in it: the hazard stripes, the stone wall behind,
bricks drawn as objects rather than coloured rectangles. None of that was
necessary and all of it was somebody's decision.

The first thing the agent handed me was a glowing dark screen. Competent, and
interchangeable with everything else. Most software looks like that now, and an
agent keeps producing it unless you push it somewhere specific. I would rather
build the richer thing and hold it to that.
