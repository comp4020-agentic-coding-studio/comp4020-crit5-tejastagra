# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.

## Stack: Astro

This repo runs on Astro, kept from Assignment 1 and carried forward each week
since (`stack: keep Astro build config`). Pages live in `src/pages/*.astro`;
`main.ts`/`vite.config.ts` don't exist here. The link-preview card block below
goes in the `<head>` of `src/pages/index.astro`, not a bare `index.html`.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; the page's head
points at it. Replace it and the `description` meta, and copy the head block
into any new page. The card URL resolves against the page that names it, like
any link --- `./card.png` is wrong one directory down, and nothing in CI checks
it, so look at the deployed head when you add pages.

## The checks

`pnpm check` runs typecheck, build, `oxlint`, `stylelint` and the test suite;
`pnpm check:evidence` is the extra gate before you ship. CI runs the same plus
links, secrets and the deploy.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## This file is yours

A starting point, not a rulebook: what you add to it is the harness, and the
harness is assessed. This file and the sensors you wire into `check` carry
across the course --- both come with you into next week's repo. The prototype
doesn't: source, and the tests answering this week's published spec, stay
behind. `spec/README.md` draws the line.

## Verify before accepting

Before presenting any calculated or derived number as correct, verify what it
actually represents against its real-world meaning, not just that a chart or
figure changed visually. Assignment 1 had two bugs that looked fine on screen
but were wrong underneath: a comparison scenario pinned to a fixed array index
rather than the value it claimed to represent, and a chart bucket hardcoded to
never change while the others did. When adding or changing any calculation,
trace through what it should mean, not just whether the UI updates.

## Two viewports, both marked

Every prototype in this course is assessed in the latest stable Chrome at two
viewports, and both are full marking environments:

- 1920x1080, desktop
- 390x844, phone (the iPhone preset in Chrome DevTools' device toolbar)

Everything the brief asks for has to work cleanly at both. Narrow width is not
a nice-to-have to get round to: a prototype that falls apart on a phone has not
shipped. Check 390 before calling any layout done, and say plainly when it has
not been checked rather than implying it has.

Watch the controls in particular. A row of controls that fits comfortably on
desktop wraps into several rows on a phone, and anything with pointer events on
it that ends up over the play area makes that part of the screen dead to touch.

## Reproduce before fixing

Do not act on a diagnosis you have not proved. When something is reported
broken, reproduce it first and get a check to fail, then fix it and watch the
same check pass. If you cannot make the fault fail a test, you have not found
it yet, so say so instead of changing code.

Crit 4: reported as "nothing works", I found a temporal dead zone in `setup()`
and was ready to commit the fix. Putting the bug back deliberately left every
test green, because the minifier hoists those declarations and the built output
never had that fault. A confident, well-commented fix for a bug that did not
exist, one step from being shipped. The two minutes spent trying to falsify the
diagnosis were worth more than the diagnosis.

## A test has to run the thing

A spec test must execute the built artefact. Reading the output as text, or
inspecting the markup it declares, tests the description rather than the
behaviour. Before adding an assertion, ask whether it would still pass with all
the JavaScript deleted; if it would, it is not a test.

Crit 4: twenty-four tests passed against a page that could have been completely
dead, because nothing in the repo ever ran the bundle. The first replacement
tests were no better, asserting `aria-pressed` values that are already in the
static markup. Watch for that specifically: an assertion satisfied by the source
HTML proves nothing.

## Look up the word count before writing

Before writing PROCESS.md, a reflection or any assessed prose, fetch the course
word counts, state the target out loud, and count the result before committing.
A crit week's PROCESS.md is 150 to 300 words carrying one or two moments. An
assignment's is 400 to 600. Reflections are 150 to 300 every time.

Crit 4: I wrote 757 words for a crit week, then overshot twice more while
correcting it, purely because I never checked the number first.

## No jargon the reader has to already know

In UI copy, PROCESS.md and reflections, do not use a term the reader may not
have. Explain it the first time or use plain words instead. This applies to
anything a marker or a stranger reads, and the test is whether someone outside
the project could follow it cold.

Crit 4: "home row", "opens a filter" and "canvas instrument" all needed
translating. "The middle row of letter keys from A to the semicolon" and "makes
it brighter or darker" say the same thing without assuming anything.

## Scope discipline

Only implement what's explicitly asked. Don't add navigation elements, UI
affordances, or styling flourishes beyond the specific request, even if they
seem like reasonable defaults. Animation is a standing exception, see the
Animation rule below. If something seems missing or worth adding, ask first
rather than adding it.

## Check in with me

- Before making any non-trivial decision (data source choice, parameter
  choices, visual layout direction, scope cuts), stop and check with me rather
  than assuming and proceeding.
- If you hit a fork where more than one reasonable approach exists, present the
  options briefly and wait for my call instead of picking one silently.
- Do not mark a task as "done" without telling me what you changed and why, so
  I have something concrete to cite in PROCESS.md.
- If you're about to throw away an attempt or start over, tell me what didn't
  work and why before doing it. That's exactly the kind of moment that needs to
  end up in PROCESS.md.

## Animation

Add subtle motion to interactive elements across the site: a slight fade
in/out and a small shift of a few pixels on hover, state changes, and
appearing/disappearing content, rather than snapping instantly. Keep it quick
and understated (roughly 150-200ms, gentle easing), it should make the page
feel responsive, not decorative. Apply this consistently wherever something
appears, disappears, or responds to interaction. Respect
prefers-reduced-motion everywhere.

## Style

- No filler copy, no marketing tone. Direct, plain language throughout the UI text.
- No Oxford commas, no em dashes anywhere in written copy.
- UK English spelling (eg "visualise", "colour").
- Do not use the "X, not Y" or "Y, not X" sentence construction (eg "it's about hindsight bias, not allocation being irrelevant"). This pattern shows up repeatedly and reads as stilted. Write plainly and directly instead.
