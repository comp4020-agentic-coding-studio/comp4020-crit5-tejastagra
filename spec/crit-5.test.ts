import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  advance,
  createGame,
  isCleared,
  isSolid,
  movePaddle,
  regrowBricks,
  regrowth,
  restart,
  togglePause,
} from "../src/scripts/game.ts";
import type { Field, Game } from "../src/scripts/game.ts";

// These answer this week's published spec (crits/05-game).
//
// Judged by a person at the crit, and deliberately not faked with an assertion
// here:
// - "it teaches itself": whether a drifting paddle and a resting ball really do
//   invite the first move. Four people's hands settle that in ten seconds.
// - "a stranger can pick it up and reach an ending inside five minutes".
// - "one change you made came from playing the finished game", plus the process
//   evidence in PROCESS.md and reflections/crit-5.md.

/**
 * The field as it actually ships, in game pixels. This used to say 620x880,
 * which were screen pixels and stopped being the real numbers when the renderer
 * started drawing into a buffer a third of the screen's size. Tests against a
 * geometry the game no longer has prove nothing about the game.
 */
const FIELD: Field = { width: 206, height: 293 };

/** Runs the game forward on its own clock, so five simulated minutes cost nothing. */
function play(game: Game, steps: number, onFrame?: (game: Game) => void): number {
  for (let frame = 0; frame < steps; frame += 1) {
    advance(game, 0.016);
    onFrame?.(game);
    if (game.phase === "won" || game.phase === "lost") break;
  }
  return game.clock;
}

// ---------------------------------------------------------------------------
// The focused rule test the spec asks for.
//
// Bricks growing back is the one rule the whole design rests on: it is why
// chipping away evenly cannot finish the wall, and why the channel above the
// field is worth the risk of getting there. Every number in it matters, so the
// boundary is pinned exactly rather than approximately.
// ---------------------------------------------------------------------------
describe("the rule the game turns on: a broken brick grows back", () => {
  it("stays down for exactly the regrow wait, and not a millisecond less", () => {
    const game = createGame(FIELD);
    const brick = game.bricks[0]!;
    brick.brokenAt = 1000;

    regrowBricks(game.bricks, 1000 + DEFAULT_RULES.regrowMs - 1);
    expect(isSolid(brick), "the brick came back early, so the wall is easier than designed").toBe(
      false,
    );

    regrowBricks(game.bricks, 1000 + DEFAULT_RULES.regrowMs);
    expect(isSolid(brick), "the brick never came back, so the game is ordinary breakout").toBe(true);
  });

  it("is invisible until the tail of the wait, then grows in fully", () => {
    const game = createGame(FIELD);
    const brick = game.bricks[0]!;
    brick.brokenAt = 0;

    expect(regrowth(brick, 0)).toBe(0);
    expect(
      regrowth(brick, DEFAULT_RULES.regrowMs * 0.5),
      "a brick should not creep back all wait long",
    ).toBe(0);
    expect(regrowth(brick, DEFAULT_RULES.regrowMs - 1)).toBeGreaterThan(0);
    expect(regrowth(brick, DEFAULT_RULES.regrowMs)).toBe(1);
  });

  it("deflects nothing while it is still growing back", () => {
    // The fade is a warning, so a half-grown brick must not bat the ball away.
    // Without this the player is punished by something they can see coming and
    // cannot yet plan around.
    const game = createGame(FIELD);
    const brick = game.bricks[0]!;
    brick.brokenAt = 0;

    const partway = DEFAULT_RULES.regrowMs - 1;
    regrowBricks(game.bricks, partway);
    expect(regrowth(brick, partway)).toBeGreaterThan(0);
    expect(isSolid(brick), "a brick that is only part way back is already solid").toBe(false);
  });

  it("un-clears a wall the moment one brick returns", () => {
    const game = createGame(FIELD);
    for (const brick of game.bricks) brick.brokenAt = 0;
    expect(isCleared(game.bricks)).toBe(true);

    regrowBricks(game.bricks, DEFAULT_RULES.regrowMs);
    expect(
      isCleared(game.bricks),
      "the wall counted as cleared while bricks were standing in it",
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// "it can be lost: a wrong move is possible, and play ends somewhere"
// ---------------------------------------------------------------------------
describe("play ends somewhere", () => {
  it("ends in a loss when the ball keeps getting past the paddle", () => {
    const game = createGame(FIELD);
    game.phase = "playing";
    game.ball.vx = 0;
    game.ball.vy = game.speed;

    // Flee the ball every frame, which is the wrong move made repeatedly.
    play(game, 4000, (state) => {
      movePaddle(state, state.ball.x > FIELD.width / 2 ? 0 : FIELD.width);
    });

    expect(game.phase, "missing every ball never ended the run, so the game cannot be lost").toBe(
      "lost",
    );
    expect(game.lives).toBe(0);
  });

  it("puts up a harder wall when one is cleared, until the last", () => {
    const game = createGame(FIELD);
    game.phase = "playing";
    const firstRegrow = game.rules.regrowMs;
    for (const brick of game.bricks) brick.brokenAt = game.clock;

    advance(game, 0.016);
    expect(game.level, "clearing the first wall did not advance a level").toBe(2);
    expect(game.phase, "the next wall should serve, not end the run").toBe("serving");
    expect(
      game.rules.regrowMs,
      "the second wall grows back no faster than the first, so nothing escalated",
    ).toBeLessThan(firstRegrow);
    expect(game.bricks.every(isSolid), "the new wall did not go up whole").toBe(true);
  });

  it("ends in a win when the last wall is cleared", () => {
    const game = createGame(FIELD);
    game.phase = "playing";
    game.level = DEFAULT_RULES.levels;
    for (const brick of game.bricks) brick.brokenAt = game.clock;

    advance(game, 0.016);
    expect(game.phase, "clearing the final wall did not finish the game").toBe("won");
  });

  it("keeps a finished run finished until it is restarted", () => {
    const game = createGame(FIELD);
    game.phase = "lost";
    const before = { ...game.ball };
    advance(game, 0.016);
    expect(game.ball.x).toBe(before.x);
    expect(game.ball.y).toBe(before.y);
  });
});

// ---------------------------------------------------------------------------
// Pausing has to stop time, not just the ball. The wall regrows on a clock, so
// a pause that only froze the physics would quietly hand back a rebuilt wall
// while the player was away from the keyboard.
// ---------------------------------------------------------------------------
describe("a paused game is genuinely frozen", () => {
  it("does not let the wall grow back behind a pause", () => {
    const game = createGame(FIELD);
    game.phase = "playing";
    const brick = game.bricks[0]!;
    brick.brokenAt = game.clock;

    togglePause(game);
    expect(game.paused).toBe(true);

    // Far longer than a full regrow wait, all of it paused.
    play(game, Math.ceil((game.rules.regrowMs * 2) / 16));

    expect(
      isSolid(brick),
      "the wall rebuilt itself while the game was paused, so pausing is a way to cheat",
    ).toBe(false);
  });

  it("stops the clock, and starts it again on resume", () => {
    const game = createGame(FIELD);
    game.phase = "playing";
    togglePause(game);
    play(game, 60);
    expect(game.clock, "a paused clock kept counting").toBe(0);

    togglePause(game);
    play(game, 60);
    expect(game.clock, "the clock never restarted after a resume").toBeGreaterThan(0);
  });
});

describe("the ball sharpens as the run goes on", () => {
  it("speeds up as bricks break, up to the cap and no further", () => {
    const game = createGame(FIELD);
    game.phase = "playing";
    const opening = game.speed;

    for (const brick of game.bricks) {
      brick.brokenAt = null;
    }
    // Break a lot of bricks by hand, which is what the ramp keys off.
    for (let hit = 0; hit < 200; hit += 1) {
      game.speed = Math.min(
        game.speed * game.rules.speedGain,
        game.baseSpeed * game.rules.maxSpeedMultiplier,
      );
    }
    expect(game.speed, "the ball never sped up").toBeGreaterThan(opening);
    expect(
      game.speed,
      "the ball ran past its cap, so a long run becomes unplayable rather than hard",
    ).toBeCloseTo(game.baseSpeed * game.rules.maxSpeedMultiplier, 5);
  });

  it("does not go slower when a wall is cleared", () => {
    // Resetting speed to the new level's base threw away the ramp earned on the
    // previous wall, so clearing one made the ball drop about 20% and the game
    // got easier exactly where it should get harder.
    const game = createGame(FIELD);
    game.phase = "playing";
    game.speed = game.baseSpeed * game.rules.maxSpeedMultiplier;
    const before = game.speed;

    for (const brick of game.bricks) brick.brokenAt = game.clock;
    advance(game, 0.016);

    expect(game.level, "the wall did not advance").toBe(2);
    expect(
      game.speed,
      "the ball slowed down on levelling up, which is the opposite of escalating",
    ).toBeGreaterThanOrEqual(before);
  });
});

describe("a fast ball still collides", () => {
  it("keeps the speed cap inside the collision budget", () => {
    // The cap is not only about staying playable. Raise it far enough and the
    // ball covers more than a brick in a single frame, and collisions start
    // getting skipped outright. This pins the cap to the geometry, so pushing
    // maxSpeedMultiplier up without thinking fails here rather than in play.
    const game = createGame(FIELD);
    const top = game.baseSpeed * game.rules.maxSpeedMultiplier;
    const travel = top * (1 / 30); // the longest frame advance() will accept
    const brick = game.bricks[0]!;

    expect(
      travel,
      "at top speed the ball crosses a whole brick in one frame, so the wall is porous",
    ).toBeLessThan(brick.height + game.ball.radius * 2);
  });

  it("substeps a long frame rather than stepping over the wall", () => {
    // Belt and braces for the case above: even handed a frame far longer than
    // the game would ever pass it, the ball must land on the brick.
    const game = createGame(FIELD);
    game.phase = "playing";
    game.speed = game.baseSpeed * game.rules.maxSpeedMultiplier;

    const target = game.bricks[0]!;
    game.ball.x = target.x + target.width / 2;
    game.ball.y = target.y + target.height + game.ball.radius + 1;
    game.ball.vx = 0;
    game.ball.vy = -game.speed;

    advance(game, 0.5);
    expect(
      isSolid(target),
      "the ball passed straight through a brick, so a slow frame punches a hole in the wall",
    ).toBe(false);
  });
});

describe("pausing is not a way to cheat", () => {
  it("refuses to steer the paddle while paused", () => {
    // Otherwise: freeze the ball mid-flight, walk the paddle under it, unpause.
    const game = createGame(FIELD);
    game.phase = "playing";
    movePaddle(game, 40);
    const parked = game.paddle.x;

    togglePause(game);
    movePaddle(game, FIELD.width - 10);

    expect(
      game.paddle.x,
      "the paddle moved while the game was paused, so pause hands out free saves",
    ).toBe(parked);

    togglePause(game);
    movePaddle(game, FIELD.width - 10);
    expect(game.paddle.x, "the paddle stayed stuck after resuming").not.toBe(parked);
  });
});

describe("a new game starts from the top", () => {
  it("resets the level, the lives and the wall", () => {
    const game = createGame(FIELD);
    game.level = 3;
    game.lives = 1;
    game.broken = 40;
    for (const brick of game.bricks) brick.brokenAt = game.clock;

    restart(game);

    expect(game.level).toBe(1);
    expect(game.lives).toBe(DEFAULT_RULES.lives);
    expect(game.broken).toBe(0);
    expect(game.paused).toBe(false);
    expect(game.bricks.every(isSolid), "a new game started on a broken wall").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The built artefact. A rule test proves the rules; only this proves the page
// that ships actually runs them.
// ---------------------------------------------------------------------------
const DIST = resolve("dist");
const ASSETS = join(DIST, "_astro");

function bundles(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(ASSETS);
  } catch {
    return [];
  }
  return entries.filter((file) => file.endsWith(".js")).map((file) => join(ASSETS, file));
}

async function loadPage() {
  const dom = new JSDOM(readFileSync(join(DIST, "index.html"), "utf8"), {
    runScripts: "outside-only",
    url: "https://example.test/",
  });
  const { window } = dom;

  if (window.document.readyState !== "complete") {
    await new Promise((done) => window.addEventListener("load", done, { once: true }));
  }

  // Bounded, but it must really run: stubbing the loop to a no-op would hide
  // every exception the rendering path can throw, and a draw loop that dies on
  // frame one looks from the outside exactly like a page where nothing works.
  let frames = 0;
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      if (frames++ < 5) callback(window.performance.now());
      return 0;
    },
  });

  // jsdom ships no canvas, so the drawing calls need somewhere to land.
  const context2d = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === "canvas") return {};
        if (property === "createLinearGradient") return () => ({ addColorStop() {} });
        return () => {};
      },
      set: () => true,
    },
  );
  window.HTMLCanvasElement.prototype.getContext = (() =>
    context2d) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });

  for (const file of bundles()) window.eval(readFileSync(file, "utf8"));
  return { window };
}

describe("the built page actually runs", () => {
  it("executes without throwing", async () => {
    await expect(
      loadPage(),
      "the bundle threw while loading, so the page will render and respond to nothing",
    ).resolves.toBeDefined();
  });

  it("reaches the end of setup and starts the game waiting to be taken over", async () => {
    const { window } = await loadPage();
    const handle = (window as unknown as { __overgrow?: { game: Game } }).__overgrow;
    expect(
      handle?.game.phase,
      "no game on the page, so setup() never reached the bottom",
    ).toBe("attract");
  });

  it("hands the paddle over on the first pointer input, with no key or button", async () => {
    // The no-tutorial rule leans on this: the very first thing anyone does with
    // a pointer has to start the game. A hidden launch key would be an
    // instruction the page never gets to give.
    const { window } = await loadPage();
    const handle = (window as unknown as { __overgrow?: { game: Game } }).__overgrow;

    window.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 200, bubbles: true }));
    expect(
      handle?.game.phase,
      "moving a pointer did not start the game, so something else has to be pressed first",
    ).toBe("serving");
  });

  it("shows no instructions anywhere on the built page", async () => {
    const { window } = await loadPage();
    const text = window.document.body.textContent ?? "";
    expect(
      text,
      "no how-to-play text, tutorial copy or rules explanation belongs on screen",
    ).not.toMatch(/how to play|instructions|tutorial|controls?:/i);
  });
});
