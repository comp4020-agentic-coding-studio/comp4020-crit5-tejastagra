# Process overview

## What I built

Brick Breaker Remastered is the old paddle and ball game with one change:
smashed bricks come back. Break one and it rebuilds a while later, so you have
to take the whole wall down in a burst.

Brick Breaker came on my first phone, a BlackBerry Bold, and I wanted the look
taken from that rather than from whatever a coding agent produces on its own.
Its first attempt could have been any browser game of the last five years, so I
gave it a screenshot of the real one and made it start again
([18febe3](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/18febe3)).

## The moments that mattered

**A game nobody could win.** All my tests passed. They checked a smashed brick
returns at the right moment, which it did, and the game was still impossible:
the ball only breaks about half a brick a second, so all twelve were never going
to be down at once. I had tested the rules without asking whether they made a
game worth playing. Rather than guess at better timings I had the agent write a
script that plays the game against a pretend player with a slow hand, and tuned
against what it reported
([06a2509](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/06a2509)).

**Then I trusted that script too quickly.** The size of the play area was typed
into it by hand and we had since shrunk the real one, so it played a differently
shaped game to the one I shipped. I was also reading one number off it, how often
the pretend player won. When I made it report how far the lost games got, an
ordinary player was smashing eleven bricks of twelve and then dying, every time.
Always one short feels rigged rather than hard
([448fb30](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/448fb30)).

**Playing it myself found what neither caught.** I paused mid game, slid the
paddle under the ball and unpaused. A free save. I reported it, then made the
agent put the bug back and show me the new test failing before I accepted a fix
([5b49a07](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/5b49a07)).
