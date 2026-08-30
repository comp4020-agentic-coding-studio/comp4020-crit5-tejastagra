# Crit 5: A game

## What was the breakthrough that moved the work forward?

Realising my tests could not see the thing I actually cared about. They pinned
the regrow rule to the millisecond and passed, and the game was still impossible
to win. A test knows what the code was supposed to do. It has no opinion on
whether the result is worth playing.

So I built a second kind of check: one that plays the real rules against a
simulated player with a limited hand speed and a reaction delay, and reports
what happened. That is what caught it, and then twice more. It caught itself
measuring a field size the game had stopped using. It caught a tuning where an
average player got to eleven of twelve bricks and lost every single time, which
win rate alone called acceptable and which anyone playing would call rigged.

The lesson I want to keep is that the sharpest question was not "does this
pass". It was "what would this check still be green through".

## What did this work change about who I want to be as a software developer?

Someone who stays true to software that had a purpose and a point of view.

I picked this because Brick Breaker came on my first phone, a BlackBerry Bold.
Rebuilding it made me notice how much character that software carried: the
hazard rails, the stone wall, bricks drawn as objects rather than coloured
rectangles. None of it was necessary and all of it was someone's decision.

My first attempt was a glowing, gradient, dark mode canvas. It was competent and
it was interchangeable with everything else. Software today is largely
homogeneous and an agent will produce that default forever unless you direct it
somewhere specific. I would rather build things that are richer than the
standard, and hold the agent to that.
