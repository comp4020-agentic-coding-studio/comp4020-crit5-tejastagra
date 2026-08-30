# Process overview

## What I built

Brick Breaker Remastered is a brick breaker where the wall grows back while
you are still breaking it. I picked it because Brick Breaker came on my first
phone, a BlackBerry Bold, and I wanted the look to come from that instead of
from whatever an agent reaches for on its own. The first version came back as a dark
glowing canvas thing that could have been any browser game from the last five
years, so I gave it a screenshot of the real one and made it start again
([18febe3](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/18febe3)).

## The moments that mattered

**A game nobody could win.** Every test passed. The regrow rule was pinned to
the millisecond and green, and the game was still impossible: the ball breaks
about half a brick a second, so twelve of them were never going to be down
together inside an eleven second regrow. I had tested the rules without once
asking whether the rules added up to a game. Instead of guessing at new numbers
I had it write a script that plays the real rules against a fake player with a
slow hand and a reaction delay, and tuned against that
([06a2509](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/06a2509)).

**Then I trusted that script too quickly.** Two things were wrong with it. The
field size was written into it as 620x880, and when we changed the game to draw
at a third of the screen's resolution the real field became 206x293, so the
script had been quietly playing a differently shaped game to the one I was
shipping. The second was easier to miss. I was only reading the win rate off it
and that looked survivable, but when I made it also report how far a losing run
got, an average player turned out to be breaking eleven of the twelve bricks and
then losing, every single time. Always one short is a rigged game rather than a
hard one
([448fb30](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/448fb30)).

**Playing it myself found what neither caught.** I paused mid game, slid the
paddle under the ball and unpaused. Free save every time. I reported it, then
made it put the bug back and show me the new test going red before I accepted
the fix
([5b49a07](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/5b49a07)).
