/**
 * A balance sensor for the design, not for the code.
 *
 * `pnpm check` can tell you the rules are implemented correctly. It cannot tell
 * you the game is winnable, and the first build of this game was not: with an
 * 11s regrow, twelve bricks could never all be down at once, because one ball
 * breaks roughly 0.56 of them a second. Every test passed and the game was
 * impossible. This script is what caught that.
 *
 * It plays the real rules against a simulated player with a finite hand: a
 * capped paddle speed, a reaction delay and some imprecision, since a paddle
 * that teleports never misses and reports a game far easier than it is.
 *
 * Deliberately NOT part of `pnpm check`. It is slow and stochastic, and a flaky
 * red check trains you to ignore red checks. Run it when the rules change:
 *
 *   pnpm balance
 */

import { DEFAULT_RULES, advance, createGame, isSolid, movePaddle } from "../src/scripts/game.ts";
import type { Field, Rules } from "../src/scripts/game.ts";

/**
 * The field as it actually ships, in game pixels. This used to say 620x880,
 * which were screen pixels and stopped being the real numbers the moment the
 * renderer started drawing into a buffer a third of the screen's size. A sensor
 * measuring a game that no longer ships is worse than no sensor at all, so read
 * these off the running page (window.__brickbreaker.game.field) whenever the
 * layout changes.
 */
const FIELD: Field = { width: 206, height: 293 };
/** The narrowest the field ever gets: a phone at 390x844. */
const PHONE: Field = { width: 116, height: 266 };
const FRAME = 0.016;
const GIVE_UP_MS = 300_000;

export interface Outcome {
  phase: string;
  seconds: number;
  /**
   * The most bricks ever down at once. A losing run that peaked one brick short
   * of the wall is a very different game from one that never got close, and
   * win-rate alone cannot tell them apart. This is the number that caught a
   * tuning where average players hit 11 of 12 and lost every single time.
   */
  peak: number;
}

/** skill runs 0 (careless) to 1 (sharp) and sets hand speed, reaction lag and precision. */
export function simulate(rules: Rules, skill: number, seed: number, field: Field = FIELD): Outcome {
  const game = createGame(field, rules, () => 0.5);
  game.phase = "playing";
  game.ball.vx = game.speed * 0.35;
  game.ball.vy = -game.speed * 0.94;

  let rng = seed;
  const random = () => ((rng = (rng * 1664525 + 1013904223) % 4294967296) / 4294967296);

  const maxStep = (280 + skill * 520) * FRAME;
  const jitter = 200 - skill * 150;
  const lagFrames = Math.round((0.2 - skill * 0.12) / FRAME);
  const seen: number[] = [];
  let centre = game.paddle.x + game.paddle.width / 2;
  let peak = 0;

  while (game.phase !== "won" && game.phase !== "lost" && game.clock < GIVE_UP_MS) {
    seen.push(game.ball.x);
    const remembered = seen[Math.max(0, seen.length - 1 - lagFrames)] ?? game.ball.x;
    // Players lead the ball to aim it, rather than meeting it dead centre.
    const aim =
      remembered -
      0.3 * game.paddle.width * 0.5 * (game.ball.vx > 0 ? 1 : -1) +
      (random() - 0.5) * jitter;
    centre += Math.max(-maxStep, Math.min(maxStep, aim - centre));
    movePaddle(game, centre);
    advance(game, FRAME);
    centre = game.paddle.x + game.paddle.width / 2;
    peak = Math.max(peak, game.bricks.filter((brick) => !isSolid(brick)).length);
  }
  return { phase: game.phase, seconds: Math.round(game.clock / 1000), peak };
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const BANDS: Array<[string, number]> = [
  ["sharp", 0.9],
  ["average", 0.55],
  ["careless", 0.2],
];

function report(label: string, rules: Rules, field: Field = FIELD): void {
  const columns = BANDS.map(([name, skill]) => {
    const runs = SEEDS.map((seed) => simulate(rules, skill, seed, field));
    const won = runs.filter((run) => run.phase === "won");
    const lost = runs.filter((run) => run.phase === "lost").length;
    const stuck = runs.length - won.length - lost;
    const longest = Math.max(...runs.map((run) => run.seconds));
    const closest = Math.max(...runs.filter((run) => run.phase !== "won").map((run) => run.peak), 0);
    const wall = runs[0]?.peak ?? 0;
    return `${name} ${won.length}W/${lost}L${stuck ? `/${stuck} stuck` : ""} max ${longest}s best-loss ${closest}/${Math.max(wall, closest)}`;
  });
  console.log(`${label.padEnd(22)} ${columns.join("  |  ")}`);
}

console.log(
  "A win here means clearing every escalating wall, not one.\n\n" +
    "What to look for: no runs stuck (every run must reach an ending), every\n" +
    "max well inside the five minutes the brief allows a stranger, and a win\n" +
    "rate that climbs with skill. A wall nobody can clear is not a hard game,\n" +
    "it is a broken one. Watch best-loss too: losing runs that peak one brick\n" +
    "short every time mean the win is decorative, however tense it looks.\n",
);

report("shipped", DEFAULT_RULES);
report("shipped on a phone", DEFAULT_RULES, PHONE);
for (const levels of [1, 2, 3]) {
  for (const lives of [4, 5]) {
    report(`${levels} wall(s), ${lives} lives`, { ...DEFAULT_RULES, levels, lives });
  }
}
