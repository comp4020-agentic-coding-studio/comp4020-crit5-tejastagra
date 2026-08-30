# Process overview

## What I built

Overgrow is a brick breaker whose wall grows back, so an even chip away can
never have the whole wall down at once. It came from the Brick Breaker on my
first phone, a BlackBerry Bold, and the look is taken from that: a stone wall,
hazard rails, outlined bricks, a blue paddle. The field is drawn into a buffer a
third of the screen's size and magnified with smoothing off, because styling
alone leaves antialiased curves underneath
([18febe3](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/18febe3)).

## The moments that mattered

**A game every test approved of and nobody could win.** My spec tests pinned the
regrow rule to the millisecond and passed, while the game was impossible: a ball
breaks about half a brick a second, so twelve could never be down at once inside
an eleven second regrow. Tests check the rules. Nothing checked whether
the rules made a game. Rather than guess at new numbers I wrote a check that
plays the real rules against a simulated player with a limited hand speed and a
reaction delay, then swept the tuning against it. It stays out of `pnpm check`
deliberately, because it is slow and random and a flaky red check trains you to
ignore red checks
([06a2509](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/06a2509)).

**Keeping that sensor honest.** It was still measuring a 620x880 field after the
renderer moved to low resolution, so it reported on a game that no longer ships.
Win rate hid the real fault too. Measuring how close losing runs got exposed it:
an average player reached eleven of twelve bricks and lost eight times out of
eight, which reads as rigged rather than hard
([448fb30](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/448fb30)).

**Playing it found what neither could.** Pausing still let me slide the paddle
under the ball, and clearing a wall made the ball slower. I put both faults back
deliberately and watched the new tests fail before trusting the fixes
([5b49a07](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-tejastagra/commit/5b49a07)).
