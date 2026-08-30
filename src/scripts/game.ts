/**
 * The rules of Brick Breaker Remastered, with no DOM anywhere in the file.
 *
 * Everything here is a plain function over plain state, so the spec tests can
 * run a whole game from serve to ending in a couple of milliseconds without a
 * browser, a canvas or a clock. Rendering and input live in main.ts and are the
 * only things that touch the page.
 *
 * The shape of the game: bricks grow back. Break one and it returns solid a
 * while later, so a slow, even chip-away can never have the whole wall down at
 * once. Winning means breaking the last brick before the first one returns,
 * which takes either a hot streak or the channel above the wall, where the ball
 * rattles along the top and breaks bricks far faster than they come back.
 *
 * The game keeps its OWN clock, advanced by advance() rather than read from
 * Date.now or a frame timestamp. That is what makes pausing honest: a paused
 * game's clock stops, so the wall cannot grow back behind a pause screen, and a
 * backgrounded tab cannot regrow the whole wall while nobody is looking.
 */

/**
 * Every number that decides how the game feels, in one place and injectable,
 * because the balance here is a knife edge: the wall has to be un-grindable and
 * still clearable. These values came out of sweeping them against a simulated
 * player rather than being picked by eye. Run `pnpm balance` after changing any
 * of them.
 */
export interface Rules {
  columns: number;
  rows: number;
  lives: number;
  /** How many escalating walls make a full run. */
  levels: number;
  /** How long a broken brick stays down before it is solid again. */
  regrowMs: number;
  /** The tail of that wait, during which the brick is visibly growing back. */
  regrowFadeMs: number;
  /** After losing a ball, how long the next one rests on the paddle before it goes. */
  serveDelayMs: number;
  /** The beat between walls, long enough to read which one you have reached. */
  levelBreakMs: number;
  /** Ball speed in field heights per second, so it feels the same at any size. */
  baseSpeed: number;
  /** Every brick nudges the speed up. The skill has to sharpen with it. */
  speedGain: number;
  maxSpeedMultiplier: number;
}

export const DEFAULT_RULES: Rules = {
  columns: 4,
  rows: 3,
  lives: 4,
  levels: 2,
  // Swept against a simulated player with a finite hand speed and a reaction
  // delay, three times over.
  //
  // 11s made the wall mathematically unclearable: a ball breaks roughly half a
  // brick a second, so twelve of them inside one window needs far longer.
  //
  // 22s looked fine on win rate alone, but the near-miss numbers gave it away:
  // an average player peaked at eleven of twelve bricks down and still lost
  // eight times out of eight. One brick short every time reads as a rigged
  // game rather than a hard one, and it left running out of balls as the only
  // ending most players ever saw.
  //
  // 44s is where both endings are live at both marked viewports: a sharp
  // player clears it, an average one wins something like a third to a half of
  // the time, and a careless one almost never does.
  regrowMs: 44_000,
  regrowFadeMs: 700,
  serveDelayMs: 900,
  levelBreakMs: 2000,
  baseSpeed: 0.55,
  speedGain: 1.012,
  maxSpeedMultiplier: 1.35,
};

/**
 * How the game escalates. The wall keeps its shape and gets harder to outrun:
 * it grows back sooner and the ball moves quicker, so the window you have to
 * land the whole wall inside keeps narrowing.
 */
export function rulesForLevel(level: number, base: Rules = DEFAULT_RULES): Rules {
  const step = Math.max(0, level - 1);
  return {
    ...base,
    regrowMs: Math.round(base.regrowMs * 0.82 ** step),
    baseSpeed: base.baseSpeed * 1.08 ** step,
  };
}

/** How far off vertical the ball can leave the paddle, at the very edge of it. */
const MAX_BOUNCE_ANGLE = Math.PI / 3;
/** A serve is angled somewhere in here, so no two runs open the same way. */
const SERVE_SPREAD = Math.PI / 5;

export interface Field {
  width: number;
  height: number;
}

export interface Brick {
  readonly column: number;
  readonly row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** null while the brick is solid, otherwise the game-clock time it was broken at. */
  brokenAt: number | null;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface Paddle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * attract  the ball rests on a paddle that drifts by itself, waiting to be taken over
 * serving  a fresh ball rests on the player's paddle and launches itself shortly
 * playing  the ball is live
 * won/lost the run is over
 */
export type Phase = "attract" | "serving" | "playing" | "won" | "lost";

export interface Game {
  /** The rules of the level being played. */
  rules: Rules;
  /** The rules level 1 is derived from, kept so later levels can be derived too. */
  baseRules: Rules;
  field: Field;
  bricks: Brick[];
  ball: Ball;
  paddle: Paddle;
  lives: number;
  level: number;
  phase: Phase;
  /** Milliseconds of actual play. Stops while paused. Everything timed reads this. */
  clock: number;
  paused: boolean;
  /** Clock time a serving ball launches itself at. */
  serveAt: number;
  /** Clock time the current wall went up, so the renderer can flash a new level. */
  levelStartedAt: number;
  /** Current ball speed in pixels per second. */
  speed: number;
  baseSpeed: number;
  broken: number;
  /** Injectable so tests and the balance sim stay deterministic. */
  rng: () => number;
}

export interface StepResult {
  broke: number;
  lostLife: boolean;
  bounced: boolean;
  /** A wall was cleared and another went up. */
  levelUp: boolean;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Math.sign, but never zero, so a dead-centre hit still picks a side. */
function side(value: number): number {
  return value < 0 ? -1 : 1;
}

export function layoutBricks(field: Field, rules: Rules = DEFAULT_RULES): Brick[] {
  const marginX = field.width * 0.06;
  const gapX = field.width * 0.014;
  const gapY = field.height * 0.012;
  // The channel above the wall is the whole point of the game, so the top of
  // the field is deliberately left clear enough for the ball to travel along.
  const top = field.height * 0.09;
  const usable = field.width - marginX * 2;
  const width = (usable - gapX * (rules.columns - 1)) / rules.columns;
  const height = field.height * 0.045;

  const bricks: Brick[] = [];
  for (let row = 0; row < rules.rows; row += 1) {
    for (let column = 0; column < rules.columns; column += 1) {
      bricks.push({
        column,
        row,
        x: marginX + column * (width + gapX),
        y: top + row * (height + gapY),
        width,
        height,
        brokenAt: null,
      });
    }
  }
  return bricks;
}

export function createPaddle(field: Field): Paddle {
  const width = field.width * 0.2;
  return {
    x: field.width / 2 - width / 2,
    y: field.height * 0.9,
    width,
    // The floors are in game pixels, which are a third the size of a screen
    // pixel. A floor of 6 here was written when these were screen pixels and
    // silently became the binding value at every size, which made the paddle a
    // different fraction of the field on a phone than on a desktop.
    height: Math.max(3, field.height * 0.016),
  };
}

export function createGame(
  field: Field,
  baseRules: Rules = DEFAULT_RULES,
  rng: () => number = Math.random,
): Game {
  const rules = rulesForLevel(1, baseRules);
  const paddle = createPaddle(field);
  const speed = field.height * rules.baseSpeed;
  return {
    rules,
    baseRules,
    field,
    bricks: layoutBricks(field, rules),
    paddle,
    ball: {
      x: paddle.x + paddle.width / 2,
      y: paddle.y - Math.max(5, field.height * 0.011),
      vx: 0,
      vy: 0,
      radius: Math.max(2, field.height * 0.011),
    },
    lives: rules.lives,
    level: 1,
    phase: "attract",
    clock: 0,
    paused: false,
    serveAt: 0,
    levelStartedAt: 0,
    speed,
    baseSpeed: speed,
    broken: 0,
    rng,
  };
}

/**
 * Rebuilds the geometry for a new field size, keeping the run going. Brick
 * damage is kept: a resize should not hand the player a fresh wall.
 */
export function resize(game: Game, field: Field): void {
  const damage = game.bricks.map((brick) => brick.brokenAt);
  const ballFraction = { x: game.ball.x / game.field.width, y: game.ball.y / game.field.height };
  const paddleFraction = game.paddle.x / game.field.width;
  const heading = Math.atan2(game.ball.vy, game.ball.vx);
  const moving = game.ball.vx !== 0 || game.ball.vy !== 0;

  game.field = field;
  game.bricks = layoutBricks(field, game.rules);
  game.bricks.forEach((brick, index) => {
    brick.brokenAt = damage[index] ?? null;
  });

  const speedMultiplier = game.speed / game.baseSpeed;
  game.baseSpeed = field.height * game.rules.baseSpeed;
  game.speed = game.baseSpeed * speedMultiplier;

  game.paddle = createPaddle(field);
  game.paddle.x = clamp(paddleFraction * field.width, 0, field.width - game.paddle.width);
  game.ball.radius = Math.max(2, field.height * 0.011);
  game.ball.x = ballFraction.x * field.width;
  game.ball.y = ballFraction.y * field.height;
  if (moving) {
    game.ball.vx = Math.cos(heading) * game.speed;
    game.ball.vy = Math.sin(heading) * game.speed;
  }
}

export function isSolid(brick: Brick): boolean {
  return brick.brokenAt === null;
}

/**
 * How far a broken brick has come back, from 0 (an empty slot) to 1 (solid).
 * The renderer uses it to grow the brick back in view before it starts
 * deflecting anything, so its return is never a surprise.
 */
export function regrowth(brick: Brick, clock: number, rules: Rules = DEFAULT_RULES): number {
  if (brick.brokenAt === null) return 1;
  const elapsed = clock - brick.brokenAt;
  const fadeStart = rules.regrowMs - rules.regrowFadeMs;
  if (elapsed <= fadeStart) return 0;
  return clamp((elapsed - fadeStart) / rules.regrowFadeMs, 0, 1);
}

/**
 * The rule the whole design rests on: a broken brick comes back solid once
 * the regrow wait has passed, and not one millisecond before.
 */
export function regrowBricks(bricks: Brick[], clock: number, rules: Rules = DEFAULT_RULES): void {
  for (const brick of bricks) {
    if (brick.brokenAt !== null && clock - brick.brokenAt >= rules.regrowMs) {
      brick.brokenAt = null;
    }
  }
}

/** Every brick down at the same instant. With regrowth, that has to be earned in a burst. */
export function isCleared(bricks: Brick[]): boolean {
  return bricks.every((brick) => brick.brokenAt !== null);
}

/**
 * Where the ball goes after the paddle: dead centre sends it straight up, and
 * the further out it lands the wider the angle. This is the control that makes
 * aiming a column possible at all.
 */
export function bounceAngle(ballX: number, paddle: Paddle): number {
  const half = paddle.width / 2;
  const offset = clamp((ballX - (paddle.x + half)) / half, -1, 1);
  return offset * MAX_BOUNCE_ANGLE;
}

export function movePaddle(game: Game, centreX: number): void {
  // A paused game must not accept steering. Otherwise pause is a cheat: freeze
  // the ball mid-flight, walk the paddle under it, unpause. Guarded here rather
  // than in the input handler so every caller gets it, and so a test can prove
  // it without a browser.
  if (game.paused) return;
  game.paddle.x = clamp(centreX - game.paddle.width / 2, 0, game.field.width - game.paddle.width);
}

function restBallOnPaddle(game: Game): void {
  game.ball.x = game.paddle.x + game.paddle.width / 2;
  game.ball.y = game.paddle.y - game.ball.radius - 1;
  game.ball.vx = 0;
  game.ball.vy = 0;
}

/** Serves at a fresh angle each time, so no two runs open identically. */
export function launch(game: Game): void {
  const angle = (game.rng() * 2 - 1) * SERVE_SPREAD;
  game.ball.vx = Math.sin(angle) * game.speed;
  game.ball.vy = -Math.cos(angle) * game.speed;
  game.phase = "playing";
}

/** Called when the player first takes hold of the paddle. No key, no button, no words. */
export function takeControl(game: Game): void {
  if (game.phase !== "attract") return;
  game.serveAt = game.clock + game.rules.serveDelayMs;
  game.phase = "serving";
}

function startLevel(game: Game, level: number, carrySpeed = false): void {
  // Clearing a wall tops a life back up, short of the starting count. Without
  // it the later walls are unreachable: the balance sim had nobody at all
  // finishing three escalating walls on one shared pool of lives.
  if (level > 1) game.lives = Math.min(game.lives + 1, game.baseRules.lives);

  // The ramp earned on the last wall carries over. Resetting to the new base
  // made the ball SLOWER on levelling up: end a wall at the +35% cap and the
  // next one opened 20% below it, which is the opposite of escalation.
  const multiplier = carrySpeed && game.baseSpeed > 0 ? game.speed / game.baseSpeed : 1;

  game.level = level;
  game.rules = rulesForLevel(level, game.baseRules);
  game.bricks = layoutBricks(game.field, game.rules);
  game.baseSpeed = game.field.height * game.rules.baseSpeed;
  game.speed = Math.min(
    game.baseSpeed * multiplier,
    game.baseSpeed * game.rules.maxSpeedMultiplier,
  );
  game.levelStartedAt = game.clock;
  // A new wall gets a longer hold than a lost ball does, so the card naming it
  // has time to be read before anything is in play.
  game.serveAt = game.clock + game.rules.levelBreakMs;
  game.phase = "serving";
  restBallOnPaddle(game);
}

/** A new game from the top: level 1, full lives, fresh wall. */
export function restart(game: Game): void {
  game.lives = game.baseRules.lives;
  game.broken = 0;
  game.paused = false;
  startLevel(game, 1);
}

export function togglePause(game: Game): void {
  if (game.phase === "won" || game.phase === "lost" || game.phase === "attract") return;
  game.paused = !game.paused;
}

export function setPaused(game: Game, paused: boolean): void {
  if (game.phase === "won" || game.phase === "lost" || game.phase === "attract") return;
  game.paused = paused;
}

function hitWalls(game: Game, result: StepResult): void {
  const { ball, field } = game;
  if (ball.x - ball.radius < 0) {
    ball.x = ball.radius;
    ball.vx = Math.abs(ball.vx);
    result.bounced = true;
  } else if (ball.x + ball.radius > field.width) {
    ball.x = field.width - ball.radius;
    ball.vx = -Math.abs(ball.vx);
    result.bounced = true;
  }
  if (ball.y - ball.radius < 0) {
    ball.y = ball.radius;
    ball.vy = Math.abs(ball.vy);
    result.bounced = true;
  }
}

function hitPaddle(game: Game, result: StepResult): void {
  const { ball, paddle } = game;
  if (ball.vy <= 0) return;
  const withinX = ball.x + ball.radius > paddle.x && ball.x - ball.radius < paddle.x + paddle.width;
  const withinY =
    ball.y + ball.radius > paddle.y && ball.y - ball.radius < paddle.y + paddle.height;
  if (!withinX || !withinY) return;

  const angle = bounceAngle(ball.x, paddle);
  ball.vx = Math.sin(angle) * game.speed;
  ball.vy = -Math.cos(angle) * game.speed;
  ball.y = paddle.y - ball.radius - 1;
  result.bounced = true;
}

function hitBricks(game: Game, result: StepResult): void {
  const { ball } = game;
  for (const brick of game.bricks) {
    if (brick.brokenAt !== null) continue;

    const dx = ball.x - (brick.x + brick.width / 2);
    const dy = ball.y - (brick.y + brick.height / 2);
    const reachX = brick.width / 2 + ball.radius;
    const reachY = brick.height / 2 + ball.radius;
    if (Math.abs(dx) >= reachX || Math.abs(dy) >= reachY) continue;

    // Reflect off whichever face the ball is least far through: a glancing hit
    // on the end of a brick should send it sideways, not straight back down.
    const overlapX = reachX - Math.abs(dx);
    const overlapY = reachY - Math.abs(dy);
    if (overlapX < overlapY) {
      ball.vx = Math.abs(ball.vx) * side(dx);
      ball.x += side(dx) * overlapX;
    } else {
      ball.vy = Math.abs(ball.vy) * side(dy);
      ball.y += side(dy) * overlapY;
    }

    brick.brokenAt = game.clock;
    game.broken += 1;
    game.speed = Math.min(
      game.speed * game.rules.speedGain,
      game.baseSpeed * game.rules.maxSpeedMultiplier,
    );
    result.broke += 1;
    result.bounced = true;
    // One brick per substep keeps the reflection honest when the ball is
    // wedged into a corner between two of them.
    return;
  }
}

function loseBall(game: Game, result: StepResult): void {
  if (game.ball.y - game.ball.radius <= game.field.height) return;
  game.lives -= 1;
  result.lostLife = true;
  if (game.lives <= 0) {
    game.lives = 0;
    game.phase = "lost";
    return;
  }
  game.phase = "serving";
  game.serveAt = game.clock + game.rules.serveDelayMs;
  restBallOnPaddle(game);
}

/**
 * Advances the game by `dt` seconds of play. The game's own clock moves with
 * it, so nothing here reads a wall clock and a paused game is genuinely frozen.
 */
export function advance(game: Game, dt: number): StepResult {
  const result: StepResult = { broke: 0, lostLife: false, bounced: false, levelUp: false };

  if (game.phase === "won" || game.phase === "lost" || game.paused) return result;

  game.clock += dt * 1000;
  regrowBricks(game.bricks, game.clock, game.rules);

  if (game.phase === "attract" || game.phase === "serving") {
    restBallOnPaddle(game);
    if (game.phase === "serving" && game.clock >= game.serveAt) launch(game);
    return result;
  }

  // Substep so a fast ball cannot pass clean through a brick in one frame.
  const travel = Math.hypot(game.ball.vx, game.ball.vy) * dt;
  const steps = Math.max(1, Math.ceil(travel / (game.ball.radius * 0.8)));
  for (let step = 0; step < steps; step += 1) {
    game.ball.x += (game.ball.vx * dt) / steps;
    game.ball.y += (game.ball.vy * dt) / steps;
    hitWalls(game, result);
    hitPaddle(game, result);
    hitBricks(game, result);

    if (isCleared(game.bricks)) {
      if (game.level >= game.baseRules.levels) {
        game.phase = "won";
      } else {
        startLevel(game, game.level + 1, true);
        result.levelUp = true;
      }
      return result;
    }

    loseBall(game, result);
    if (game.phase !== "playing") return result;
  }
  return result;
}
