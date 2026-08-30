/**
 * Everything that touches the page: canvas rendering, pointer input, the
 * controls, and the one line of DOM that announces an ending. The rules live in
 * game.ts and know nothing about any of this.
 *
 * Input is pointer-only on purpose. Pointer Events already cover mouse, trackpad
 * and touch through one path, and arrow keys would leave the phone viewport
 * with no way to play at all. Dragging anywhere on the screen steers, so a
 * thumb never has to sit on top of the paddle it is trying to see.
 *
 * The controls are real DOM buttons rather than shapes drawn on the canvas, so
 * they can be tabbed to and read aloud. That costs one thing: a pointer event
 * that starts on a button must not also fling the paddle across the field, so
 * the paddle handler ignores anything originating inside the control bar.
 */

import {
  advance,
  createGame,
  isSolid,
  movePaddle,
  regrowth,
  resize,
  restart,
  setPaused,
  takeControl,
  togglePause,
} from "./game.ts";
import type { Brick, Game } from "./game.ts";

const MAX_FIELD_WIDTH = 620;
const MAX_FIELD_HEIGHT = 880;
/** Height reserved at the top of the screen for the controls. */
const BAR_HEIGHT = 44;
/** Below this much margin beside the field there is no room for a side panel. */
const PANEL_MIN_MARGIN = 210;
/**
 * How many screen pixels one game pixel occupies. The whole game is drawn into
 * a backing store this many times smaller than the screen and then blown up
 * with smoothing off, so every edge lands on a chunky pixel boundary the way it
 * did on a 320x240 handset. Faking the look with styling alone leaves
 * antialiased curves underneath; rendering low and upscaling does not.
 */
const PIXEL = 3;

/**
 * A handheld LCD rather than a backlit screen: a pale green panel with dark
 * pixels on it. Flat and saturated, no gradients, one hue per row, shifting to
 * a second set on the second wall.
 */
const PALETTES = [
  ["#c2352f", "#c97f14", "#2f7d3a"],
  ["#6b3fa0", "#1f5fa8", "#0f7a70"],
];
/** The LCD panel the game is played on. */
const FIELD_BG = "#c3cdb4";
/** The bezel drawn around it. */
const BEZEL = "#5c6357";
const INK = "#20241d";
const PADDLE_INK = "#3c4238";
const SLOT = "#8a9578";
/** Longest frame the physics will accept, so a slow frame cannot teleport the ball. */
const MAX_FRAME_SECONDS = 1 / 30;
const BEST_KEY = "overgrow:best";

const canvas = document.querySelector<HTMLCanvasElement>("#play");
const outcome = document.querySelector<HTMLElement>("[data-testid='outcome']");
const outcomePanel = document.querySelector<HTMLElement>("[data-outcome-panel]");
const controls = document.querySelector<HTMLElement>("[data-controls]");
const pauseButton = document.querySelector<HTMLButtonElement>("[data-action='pause']");
const newGameButton = document.querySelector<HTMLButtonElement>("[data-action='new-game']");
const context = canvas?.getContext("2d") ?? null;

const reducedMotion =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

let game: Game;
let offsetX = 0;
let offsetY = 0;
let shake = 0;
let lastFrame = 0;
let announced = "";
let best = readBest();

interface Best {
  level: number;
  seconds: number;
}

function readBest(): Best | null {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Best;
    return typeof parsed?.level === "number" ? parsed : null;
  } catch {
    // Private windows and blocked site data both throw here. A missing best
    // score is not worth breaking the game over.
    return null;
  }
}

function writeBest(value: Best): void {
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify(value));
  } catch {
    /* nothing to do: the run just will not be remembered */
  }
}

/** Screen size in game pixels. Everything below works in these units. */
function screen(): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(window.innerWidth / PIXEL)),
    height: Math.max(1, Math.floor(window.innerHeight / PIXEL)),
  };
}

function measure(): { width: number; height: number } {
  const view = screen();
  const bar = Math.round(BAR_HEIGHT / PIXEL);
  const available = Math.max(1, view.height - bar);
  const width = Math.floor(Math.min(view.width, MAX_FIELD_WIDTH / PIXEL));
  // A phone is far taller than it is wide and a desktop is not, so the field
  // takes what it can get vertically rather than copying the desktop shape.
  const height = Math.floor(Math.min(available, MAX_FIELD_HEIGHT / PIXEL, width * 2.3));
  offsetX = Math.round((view.width - width) / 2);
  offsetY = bar + Math.round((available - height) / 2);
  return { width, height };
}

function fitCanvas(): void {
  if (!canvas || !context) return;
  const view = screen();
  canvas.width = view.width;
  canvas.height = view.height;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = false;
}

/** Turns a pointer's page position into a field coordinate, or null if the canvas has no size. */
function fieldX(event: { clientX: number }): number | null {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return null;
  return (event.clientX - rect.left) / PIXEL - offsetX;
}

function shade(colour: string, amount: number): string {
  // Flat colours with a hand-mixed bevel, rather than a gradient: the original
  // had no gradients anywhere, just a lighter edge and a darker one.
  const value = Number.parseInt(colour.slice(1), 16);
  const mix = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel + (amount > 0 ? (255 - channel) : channel) * amount)));
  const r = mix((value >> 16) & 255);
  const g = mix((value >> 8) & 255);
  const b = mix(value & 255);
  return `rgb(${r} ${g} ${b})`;
}

function brickColour(row: number): string {
  const palette = PALETTES[(game.level - 1) % PALETTES.length]!;
  return palette[row % palette.length]!;
}

/** A bevelled block: flat fill, one lit edge, one shadowed edge. One pixel each. */
function block(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = shade(colour, 0.42);
  ctx.fillRect(x, y, width, 1);
  ctx.fillRect(x, y, 1, height);
  ctx.fillStyle = shade(colour, -0.4);
  ctx.fillRect(x, y + height - 1, width, 1);
  ctx.fillRect(x + width - 1, y, 1, height);
}

function drawBrick(ctx: CanvasRenderingContext2D, brick: Brick): void {
  const growth = regrowth(brick, game.clock, game.rules);
  const colour = brickColour(brick.row);
  const x = Math.round(brick.x);
  const y = Math.round(brick.y);
  const width = Math.round(brick.width);
  const height = Math.round(brick.height);

  // Every broken brick keeps an outline of the slot it left behind, so the wall
  // coming back is something you watch approaching rather than discover. Playing
  // it is what set this: with the slot invisible, a regrow arrived as a
  // surprise, and that is the one rule the game most needs to teach wordlessly.
  if (!isSolid(brick)) {
    ctx.save();
    ctx.strokeStyle = growth > 0 ? shade(colour, -0.1) : SLOT;
    ctx.lineWidth = 1;
    ctx.setLineDash(growth > 0 ? [] : [2, 2]);
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.restore();
    if (growth <= 0) return;
    // Grows back from the middle outwards, in whole pixels.
    const inset = Math.round((height / 2) * (1 - growth));
    if (height - inset * 2 < 2) return;
    block(ctx, x, y + inset, width, height - inset * 2, shade(colour, -0.25 + growth * 0.25));
    return;
  }

  block(ctx, x, y, width, height, colour);
}

function drawLives(ctx: CanvasRenderingContext2D): void {
  const size = 3;
  for (let index = 0; index < game.lives; index += 1) {
    block(ctx, 5 + index * (size + 3), game.field.height - size - 5, size, size, PADDLE_INK);
  }
}

function clock(): string {
  const total = Math.floor(game.clock / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The soonest brick to return, as a 0..1 fraction of its wait already served. */
function nextReturn(): number | null {
  let soonest: number | null = null;
  for (const brick of game.bricks) {
    if (brick.brokenAt === null) continue;
    const served = (game.clock - brick.brokenAt) / game.rules.regrowMs;
    if (soonest === null || served > soonest) soonest = served;
  }
  return soonest;
}

const stats = new Map<string, HTMLElement>();
for (const node of document.querySelectorAll<HTMLElement>("[data-stat]")) {
  stats.set(node.dataset.stat ?? "", node);
}

/** Writes only when the text actually changed, so this is not 60 DOM writes a second. */
function put(key: string, text: string): void {
  const node = stats.get(key);
  if (node && node.textContent !== text) node.textContent = text;
}

function syncStats(): void {
  put("level", `${game.level}/${game.baseRules.levels}`);
  put("time", clock());
  put("broken", String(game.broken));
  put("lives", "\u25AA".repeat(game.lives) || "\u2013");
  put("down", `${game.bricks.filter((brick) => !isSolid(brick)).length}/${game.bricks.length}`);
  put("regrow", `${(game.rules.regrowMs / 1000).toFixed(0)}s`);

  const served = nextReturn();
  const meter = stats.get("next");
  if (meter) {
    meter.style.width = `${Math.round((served ?? 0) * 100)}%`;
    meter.dataset.soon = String(served !== null && served > 0.85);
  }

  const bestRow = stats.get("best-row");
  if (bestRow) {
    bestRow.hidden = best === null;
    if (best) put("best", `L${best.level} · ${Math.floor(best.seconds / 60)}:${String(best.seconds % 60).padStart(2, "0")}`);
  }
}

/** Tells the CSS where the field landed, so the panels can sit beside it. */
function publishLayout(): void {
  const root = document.documentElement;
  root.style.setProperty("--field-left", `${offsetX * PIXEL}px`);
  root.style.setProperty("--field-top", `${offsetY * PIXEL}px`);
  root.style.setProperty("--field-width", `${game.field.width * PIXEL}px`);
  root.style.setProperty("--field-height", `${game.field.height * PIXEL}px`);
  root.dataset.panels = String(offsetX >= PANEL_MIN_MARGIN / PIXEL);
}

function draw(now: number): void {
  if (!context || !canvas) return;
  const ctx = context;
  const { field, ball, paddle } = game;
  const view = screen();

  ctx.clearRect(0, 0, view.width, view.height);

  ctx.save();
  const jolt = shake > 0 ? Math.round((Math.random() - 0.5) * shake) : 0;
  ctx.translate(offsetX + jolt, offsetY);

  // The screen: a flat LCD panel with a hard one-pixel bezel, like a device cutout.
  ctx.fillStyle = FIELD_BG;
  ctx.fillRect(0, 0, field.width, field.height);
  ctx.strokeStyle = BEZEL;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, field.width - 1, field.height - 1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(1, 1, field.width - 2, field.height - 2);
  ctx.clip();

  for (const brick of game.bricks) drawBrick(ctx, brick);

  // A square ball, drawn on the pixel grid. No trail and no glow: neither
  // existed on the handset, and both fight the flat look.
  const size = Math.max(2, Math.round(ball.radius * 1.6));
  ctx.fillStyle = INK;
  ctx.fillRect(Math.round(ball.x - size / 2), Math.round(ball.y - size / 2), size, size);

  // The paddle is the one steel object on screen, so it reads as the thing you hold.
  const paddleY = Math.round(paddle.y);
  const paddleX = Math.round(paddle.x);
  const paddleW = Math.round(paddle.width);
  const paddleH = Math.max(3, Math.round(paddle.height));
  block(ctx, paddleX, paddleY, paddleW, paddleH, PADDLE_INK);

  // In attract the paddle blinks, which is the only invitation the screen makes.
  if (game.phase === "attract" && !reducedMotion && Math.floor(now / 420) % 2 === 0) {
    ctx.fillStyle = FIELD_BG;
    ctx.fillRect(paddleX + 1, paddleY + 1, paddleW - 2, paddleH - 2);
  }

  if (offsetX < PANEL_MIN_MARGIN / PIXEL) drawLives(ctx);

  // A new wall announces itself with a flash of the field, so levelling up is
  // legible without a word of copy.
  const sinceLevel = game.clock - game.levelStartedAt;
  if (game.level > 1 && sinceLevel < 600 && !reducedMotion && Math.floor(sinceLevel / 100) % 2 === 0) {
    ctx.fillStyle = "#20241d1f";
    ctx.fillRect(0, 0, field.width, field.height);
  }

  // Paused has to be unmistakable, not a subtle change in a corner: the field
  // dims and the pause mark sits in the middle of it, so the state is obvious
  // from wherever the player's eyes were when they hit the key.
  if (game.paused) {
    ctx.fillStyle = "#c3cdb4d6";
    ctx.fillRect(0, 0, field.width, field.height);
    const barHeight = Math.max(10, Math.round(field.height * 0.06));
    const barWidth = Math.max(3, Math.round(barHeight * 0.32));
    const centreX = Math.round(field.width / 2);
    const centreY = Math.round(field.height / 2);
    for (const direction of [-1, 1]) {
      block(
        ctx,
        centreX + direction * barWidth - (direction < 0 ? barWidth : 0),
        centreY - Math.round(barHeight / 2),
        barWidth,
        barHeight,
        PADDLE_INK,
      );
    }
  }

  ctx.restore();
  ctx.restore();
}

function announce(): void {
  if (!outcome) return;
  const word = game.phase === "won" ? "You win" : game.phase === "lost" ? "Game over" : "";
  if (word === announced) return;
  announced = word;
  outcome.textContent = word;
  if (outcomePanel) outcomePanel.dataset.shown = word === "" ? "false" : "true";
}

function syncControls(): void {
  if (!pauseButton) return;
  const ended = game.phase === "won" || game.phase === "lost";
  pauseButton.disabled = ended || game.phase === "attract";
  pauseButton.setAttribute("aria-pressed", String(game.paused));
  pauseButton.setAttribute("aria-label", game.paused ? "Resume" : "Pause");
  if (controls) controls.dataset.paused = String(game.paused);
}

function recordBest(): void {
  const seconds = Math.floor(game.clock / 1000);
  const reached = { level: game.level, seconds };
  if (!best || reached.level > best.level || (reached.level === best.level && seconds < best.seconds)) {
    best = reached;
    writeBest(reached);
  }
}

function frame(timestamp: number): void {
  const dt = Math.min(MAX_FRAME_SECONDS, (timestamp - lastFrame) / 1000 || 0);
  lastFrame = timestamp;

  const wasPlaying = game.phase !== "won" && game.phase !== "lost";
  const result = advance(game, dt);
  if (result.broke > 0) shake = Math.min(6, shake + 2.5);
  if (result.lostLife) shake = 9;
  if (result.levelUp) shake = 5;
  shake *= 0.88;
  if (shake < 0.05) shake = 0;

  if (wasPlaying && (game.phase === "won" || game.phase === "lost")) recordBest();

  if (game.phase === "attract") {
    // The paddle drifts by itself until someone takes it over. A still screen
    // invites nothing; a moving one says "this part is yours" without a word.
    const drift = Math.sin(timestamp / 1600) * (game.field.width * 0.22);
    movePaddle(game, game.field.width / 2 + drift);
  }

  announce();
  syncControls();
  syncStats();
  draw(timestamp);
  window.requestAnimationFrame(frame);
}

function onPointer(event: PointerEvent): void {
  // A press that started on a button is for that button, not for the paddle.
  if (controls && event.target instanceof Node && controls.contains(event.target)) return;

  if (game.phase === "won" || game.phase === "lost") {
    if (event.type === "pointerdown") {
      restart(game);
      announce();
      syncControls();
    }
    return;
  }
  takeControl(game);
  const x = fieldX(event);
  if (x !== null) movePaddle(game, x);
}

function setup(): void {
  if (!canvas || !context) return;
  fitCanvas();
  game = createGame(measure());
  publishLayout();

  window.addEventListener("pointerdown", onPointer);
  window.addEventListener("pointermove", onPointer);
  window.addEventListener("resize", () => {
    fitCanvas();
    resize(game, measure());
    publishLayout();
  });

  // Nobody has to find these, but a player who reaches for them should not be
  // told no. They are a convenience on top of the pointer, never the way in.
  window.addEventListener("keydown", (event) => {
    const pauseKey = event.key === "Escape" || event.key === " " || event.key.toLowerCase() === "p";
    // event.repeat guards a held key, which would otherwise flap the pause on
    // and off many times a second for as long as it is down.
    if (!pauseKey || event.repeat) return;
    event.preventDefault();
    togglePause(game);
    syncControls();
  });

  // Losing the tab should not cost a life, and must not let the wall grow back
  // unwatched. The game clock stops with the pause, so it cannot.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setPaused(game, true);
    syncControls();
  });

  pauseButton?.addEventListener("click", () => {
    togglePause(game);
    syncControls();
  });
  newGameButton?.addEventListener("click", () => {
    restart(game);
    announce();
    syncControls();
  });

  syncControls();

  // A debug handle, and the only way spec/crit-5.test.ts can ask the built
  // bundle whether it actually wired itself up rather than merely loaded.
  (window as unknown as { __overgrow?: unknown }).__overgrow = {
    get game() {
      return game;
    },
  };

  lastFrame = performance.now();
  window.requestAnimationFrame(frame);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setup, { once: true });
} else {
  setup();
}
