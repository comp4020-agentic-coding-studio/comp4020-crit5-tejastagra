/**
 * A balance sensor for the design, not for the code.
 *
 * `pnpm check` can tell you the rules are implemented correctly. It cannot tell
 * you the game is winnable, and the first build of Overgrow was not: with an
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

import { DEFAULT_RULES, advance, createGame, movePaddle } from "../src/scripts/game.ts";
import type { Field, Rules } from "../src/scripts/game.ts";

const FIELD: Field = { width: 620, height: 880 };
const FRAME = 0.016;
const GIVE_UP_MS = 300_000;

export interface Outcome {
  phase: string;
  seconds: number;
}

/** skill runs 0 (careless) to 1 (sharp) and sets hand speed, reaction lag and precision. */
export function simulate(rules: Rules, skill: number, seed: number): Outcome {
  const game = createGame(FIELD, 0, rules);
  game.phase = "playing";
  game.ball.vx = game.speed * 0.35;
  game.ball.vy = -game.speed * 0.94;

  let now = 0;
  let rng = seed;
  const random = () => ((rng = (rng * 1664525 + 1013904223) % 4294967296) / 4294967296);

  const maxStep = (280 + skill * 520) * FRAME;
  const jitter = 200 - skill * 150;
  const lagFrames = Math.round((0.2 - skill * 0.12) / FRAME);
  const seen: number[] = [];
  let centre = game.paddle.x + game.paddle.width / 2;

  while (game.phase !== "won" && game.phase !== "lost" && now < GIVE_UP_MS) {
    now += 16;
    seen.push(game.ball.x);
    const remembered = seen[Math.max(0, seen.length - 1 - lagFrames)] ?? game.ball.x;
    // Players lead the ball to aim it, rather than meeting it dead centre.
    const aim =
      remembered -
      0.3 * game.paddle.width * 0.5 * (game.ball.vx > 0 ? 1 : -1) +
      (random() - 0.5) * jitter;
    centre += Math.max(-maxStep, Math.min(maxStep, aim - centre));
    movePaddle(game, centre);
    advance(game, FRAME, now);
    centre = game.paddle.x + game.paddle.width / 2;
  }
  return { phase: game.phase, seconds: Math.round(now / 1000) };
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const BANDS: Array<[string, number]> = [
  ["sharp", 0.9],
  ["average", 0.55],
  ["careless", 0.2],
];

function report(label: string, rules: Rules): void {
  const columns = BANDS.map(([name, skill]) => {
    const runs = SEEDS.map((seed) => simulate(rules, skill, seed));
    const won = runs.filter((run) => run.phase === "won");
    const lost = runs.filter((run) => run.phase === "lost").length;
    const stuck = runs.length - won.length - lost;
    const times = won.map((run) => run.seconds).sort((a, b) => a - b);
    const median = times.length ? `${times[Math.floor(times.length / 2)]}s` : "-";
    const longest = Math.max(...runs.map((run) => run.seconds));
    return `${name} ${won.length}W/${lost}L${stuck ? `/${stuck} stuck` : ""} med ${median} max ${longest}s`;
  });
  console.log(`${label.padEnd(22)} ${columns.join("  |  ")}`);
}

console.log(
  "What to look for: no runs stuck (every run must reach an ending), every\n" +
    "max well inside the five minutes the brief allows a stranger, and a win\n" +
    "rate that climbs with skill. A wall nobody can clear is not a hard game,\n" +
    "it is a broken one.\n",
);

report("shipped", DEFAULT_RULES);
for (const regrowMs of [11_000, 17_000, 22_000, 28_000]) {
  report(`regrow ${regrowMs / 1000}s`, { ...DEFAULT_RULES, regrowMs });
}
