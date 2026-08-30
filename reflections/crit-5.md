# Crit 5: A game

## What was the breakthrough that moved the work forward?

Working out that my tests could not see the thing I actually cared about.

They pinned the regrow rule to the millisecond and they all passed, and the game
was still impossible to win. That was uncomfortable, because I had been treating
a green suite as proof the week was going fine. It was only ever proof that the
code did what I had told it to do.

So we built a second kind of check, one that plays the game against a fake
player and tells you what happened. That caught it, and then I got caught out
again by trusting the new script too fast: it was measuring a field size the
game had stopped using, and its win rate looked healthy while a normal player
was losing at eleven bricks out of twelve every time.

The part I want to keep is that the useful question stopped being "did it pass".
It became "what would this still be green through". Pausing and sliding the
paddle under the ball took me about ten seconds to find by hand, and nothing
automated had a hope of noticing.

## What did this work change about who I want to be as a software developer?

Someone who stays true to software that had a purpose and a point of view.

Brick Breaker came on my first phone, a BlackBerry Bold. Rebuilding it made me
notice how much character was in it: the hazard rails, the stone wall, bricks
drawn as objects rather than coloured rectangles. None of that was necessary and
all of it was somebody's decision.

The first thing the agent gave me was a glowing dark mode canvas. Competent, and
interchangeable with everything else. Most software looks like that now, and an
agent will keep producing it unless you push it somewhere specific. I would
rather build the richer thing and hold it to that.
