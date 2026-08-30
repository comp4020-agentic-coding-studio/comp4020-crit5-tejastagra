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

const FIELD: Field = { width: 620, height: 880 };

/** Runs the game forward on a synthetic clock, so five simulated minutes cost nothing. */
function play(game: Game, steps: number, onFrame?: (game: Game) => void): number {
  let now = 0;
  for (let frame = 0; frame < steps; frame += 1) {
    now += 16;
    advance(game, 0.016, now);
    onFrame?.(game);
    if (game.phase === "won" || game.phase === "lost") break;
  }
  return now;
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
    const game = createGame(FIELD, 0);
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
    const game = createGame(FIELD, 0);
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
    const game = createGame(FIELD, 0);
    const brick = game.bricks[0]!;
    brick.brokenAt = 0;

    const partway = DEFAULT_RULES.regrowMs - 1;
    regrowBricks(game.bricks, partway);
    expect(regrowth(brick, partway)).toBeGreaterThan(0);
    expect(isSolid(brick), "a brick that is only part way back is already solid").toBe(false);
  });

  it("un-clears a wall the moment one brick returns", () => {
    const game = createGame(FIELD, 0);
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
    const game = createGame(FIELD, 0);
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

  it("ends in a win when the whole wall is down at once", () => {
    const game = createGame(FIELD, 0);
    game.phase = "playing";
    for (const brick of game.bricks) brick.brokenAt = 1;

    advance(game, 0.016, 2);
    expect(game.phase, "clearing every brick did not finish the game").toBe("won");
  });

  it("keeps a finished run finished until it is restarted", () => {
    const game = createGame(FIELD, 0);
    game.phase = "lost";
    const before = { ...game.ball };
    advance(game, 0.016, 5000);
    expect(game.ball.x).toBe(before.x);
    expect(game.ball.y).toBe(before.y);
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
