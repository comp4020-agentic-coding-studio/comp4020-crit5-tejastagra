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
/** Longest frame the physics will accept, so a slow frame cannot teleport the ball. */
const MAX_FRAME_SECONDS = 1 / 30;
const TRAIL_LENGTH = 12;
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
let trail: Array<{ x: number; y: number }> = [];
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

function ratio(): number {
  return Math.min(3, window.devicePixelRatio || 1);
}

function measure(): { width: number; height: number } {
  const cssWidth = Math.max(1, window.innerWidth);
  const available = Math.max(1, window.innerHeight - BAR_HEIGHT);
  const width = Math.min(cssWidth, MAX_FIELD_WIDTH);
  // A phone is far taller than it is wide and a desktop is not, so the field
  // takes what it can get vertically rather than copying the desktop shape.
  const height = Math.min(available, MAX_FIELD_HEIGHT, width * 2.3);
  offsetX = (cssWidth - width) / 2;
  offsetY = BAR_HEIGHT + (available - height) / 2;
  return { width, height };
}

function fitCanvas(): void {
  if (!canvas || !context) return;
  const scale = ratio();
  const cssWidth = Math.max(1, window.innerWidth);
  const cssHeight = Math.max(1, window.innerHeight);
  canvas.width = Math.round(cssWidth * scale);
  canvas.height = Math.round(cssHeight * scale);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  context.setTransform(scale, 0, 0, scale, 0, 0);
}

/** Turns a pointer's page position into a field coordinate, or null if the canvas has no size. */
function fieldX(event: { clientX: number }): number | null {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return null;
  return event.clientX - rect.left - offsetX;
}

function hue(row: number): number {
  // Each level shifts the whole wall round the wheel, so escalation is
  // something you see rather than something a label tells you.
  const levelShift = (game.level - 1) * 58;
  return 168 + (row / Math.max(1, game.rules.rows - 1)) * 82 + levelShift;
}

function drawBrick(ctx: CanvasRenderingContext2D, brick: Brick): void {
  const growth = regrowth(brick, game.clock, game.rules);
  const tone = hue(brick.row);
  const radius = Math.min(6, brick.height / 2);

  // Every broken brick keeps an outline of the slot it left behind, so the wall
  // coming back is something you watch approaching rather than discover. Playing
  // it is what set these numbers: at the first, fainter values the slots read as
  // empty background and the regrow arrived as a surprise, which is exactly the
  // rule the game most needs a player to learn without being told.
  if (!isSolid(brick)) {
    ctx.save();
    ctx.strokeStyle = `hsl(${tone} 55% 62% / ${22 + growth * 45}%)`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(growth > 0 ? [] : [5, 4]);
    ctx.beginPath();
    ctx.roundRect(brick.x + 0.75, brick.y + 0.75, brick.width - 1.5, brick.height - 1.5, radius);
    ctx.stroke();
    ctx.restore();
    if (growth <= 0) return;
  }

  const scale = isSolid(brick) ? 1 : 0.62 + growth * 0.38;
  const alpha = isSolid(brick) ? 1 : growth;
  const centreX = brick.x + brick.width / 2;
  const centreY = brick.y + brick.height / 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(centreX, centreY);
  ctx.scale(scale, scale);
  ctx.translate(-centreX, -centreY);

  const gradient = ctx.createLinearGradient(brick.x, brick.y, brick.x, brick.y + brick.height);
  gradient.addColorStop(0, `hsl(${tone} 62% 62%)`);
  gradient.addColorStop(1, `hsl(${tone} 58% 44%)`);
  ctx.fillStyle = gradient;
  ctx.shadowColor = `hsl(${tone} 70% 55% / 45%)`;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.roundRect(brick.x, brick.y, brick.width, brick.height, radius);
  ctx.fill();
  ctx.restore();
}

function drawLives(ctx: CanvasRenderingContext2D): void {
  const size = Math.max(4, game.field.height * 0.007);
  const gap = size * 3;
  const baseY = game.field.height - size * 3;
  for (let index = 0; index < game.lives; index += 1) {
    ctx.beginPath();
    ctx.fillStyle = "hsl(38deg 90% 62% / 70%)";
    ctx.arc(size * 3 + index * gap, baseY, size, 0, Math.PI * 2);
    ctx.fill();
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

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.fillStyle = "hsl(210deg 35% 72% / 38%)";
  ctx.font = "500 11px system-ui, sans-serif";
  ctx.letterSpacing = "0.16em";
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.letterSpacing = "0px";
}

function value(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.fillStyle = "hsl(210deg 45% 92% / 82%)";
  ctx.font = "600 26px system-ui, sans-serif";
  ctx.fillText(text, x, y);
}

/**
 * On a wide screen the field leaves a lot of room either side. Rather than
 * leave it black, the margins carry the run: what is happening on the left,
 * what the wall is about to do on the right. Never drawn on a phone, where
 * there is no margin and the field is the whole screen.
 */
function drawPanels(ctx: CanvasRenderingContext2D): void {
  if (offsetX < PANEL_MIN_MARGIN) return;
  const gutter = 34;
  const leftX = offsetX - gutter - 150;
  const rightX = offsetX + game.field.width + gutter;
  let y = offsetY + 26;

  ctx.save();
  ctx.textBaseline = "alphabetic";

  label(ctx, "level", leftX, y);
  value(ctx, `${game.level}/${game.baseRules.levels}`, leftX, y + 30);
  y += 78;

  label(ctx, "time", leftX, y);
  value(ctx, clock(), leftX, y + 30);
  y += 78;

  label(ctx, "broken", leftX, y);
  value(ctx, String(game.broken), leftX, y + 30);
  y += 78;

  label(ctx, "lives", leftX, y);
  for (let index = 0; index < game.baseRules.lives; index += 1) {
    ctx.beginPath();
    ctx.fillStyle =
      index < game.lives ? "hsl(38deg 92% 64% / 88%)" : "hsl(38deg 30% 60% / 18%)";
    ctx.arc(leftX + 7 + index * 22, y + 22, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Right side: the wall itself, which is the thing the whole game is a race against.
  let rightY = offsetY + 26;
  const down = game.bricks.filter((brick) => !isSolid(brick)).length;

  label(ctx, "wall down", rightX, rightY);
  value(ctx, `${down}/${game.bricks.length}`, rightX, rightY + 30);
  rightY += 78;

  label(ctx, "next back", rightX, rightY);
  const served = nextReturn();
  const barWidth = 150;
  ctx.beginPath();
  ctx.fillStyle = "hsl(210deg 40% 70% / 12%)";
  ctx.roundRect(rightX, rightY + 14, barWidth, 8, 4);
  ctx.fill();
  if (served !== null) {
    ctx.beginPath();
    ctx.fillStyle = served > 0.85 ? "hsl(8deg 85% 62% / 90%)" : "hsl(168deg 60% 55% / 70%)";
    ctx.roundRect(rightX, rightY + 14, Math.max(4, barWidth * served), 8, 4);
    ctx.fill();
  }
  rightY += 74;

  label(ctx, "regrow", rightX, rightY);
  value(ctx, `${(game.rules.regrowMs / 1000).toFixed(0)}s`, rightX, rightY + 30);
  rightY += 78;

  if (best) {
    label(ctx, "best", rightX, rightY);
    value(ctx, `L${best.level} · ${Math.floor(best.seconds / 60)}:${String(best.seconds % 60).padStart(2, "0")}`, rightX, rightY + 30);
  }

  ctx.restore();
}

function draw(now: number): void {
  if (!context || !canvas) return;
  const ctx = context;
  const { field, ball, paddle } = game;

  ctx.save();
  ctx.setTransform(ratio(), 0, 0, ratio(), 0, 0);
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.restore();

  drawPanels(ctx);

  ctx.save();
  const jolt = shake > 0 ? (Math.random() - 0.5) * shake : 0;
  ctx.translate(offsetX + jolt, offsetY);

  ctx.fillStyle = "#0b1120";
  ctx.beginPath();
  ctx.roundRect(0, 0, field.width, field.height, 14);
  ctx.fill();
  ctx.strokeStyle = "hsl(210deg 40% 70% / 10%)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, field.width, field.height, 14);
  ctx.clip();

  for (const brick of game.bricks) drawBrick(ctx, brick);

  if (!reducedMotion) {
    trail.forEach((point, index) => {
      const strength = (index + 1) / trail.length;
      ctx.beginPath();
      ctx.fillStyle = `hsl(200deg 100% 88% / ${strength * 22}%)`;
      ctx.arc(point.x, point.y, ball.radius * strength * 0.85, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.save();
  ctx.shadowColor = "hsl(196deg 100% 75% / 80%)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#f2fbff";
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // In attract the paddle breathes, which is the only invitation the screen makes.
  const pulse =
    game.phase === "attract" && !reducedMotion ? 0.55 + Math.sin(now / 420) * 0.45 : 0.35;
  ctx.save();
  ctx.shadowColor = `hsl(38deg 95% 60% / ${40 + pulse * 45}%)`;
  ctx.shadowBlur = 12 + pulse * 18;
  ctx.fillStyle = "hsl(38deg 92% 64%)";
  ctx.beginPath();
  ctx.roundRect(paddle.x, paddle.y, paddle.width, paddle.height, paddle.height / 2);
  ctx.fill();
  ctx.restore();

  if (offsetX < PANEL_MIN_MARGIN) drawLives(ctx);

  // Paused has to be unmistakable, not a subtle change in a corner: the field
  // dims and the pause mark sits in the middle of it, so the state is obvious
  // from wherever the player's eyes were when they hit the key.
  if (game.paused) {
    ctx.fillStyle = "hsl(220deg 45% 4% / 62%)";
    ctx.fillRect(0, 0, field.width, field.height);

    const barHeight = Math.min(74, field.height * 0.09);
    const barWidth = barHeight * 0.3;
    const centreX = field.width / 2;
    const centreY = field.height / 2;
    ctx.fillStyle = "hsl(38deg 92% 66% / 92%)";
    for (const direction of [-1, 1]) {
      ctx.beginPath();
      ctx.roundRect(
        centreX + direction * barWidth * 0.75 - barWidth / 2,
        centreY - barHeight / 2,
        barWidth,
        barHeight,
        barWidth / 2.5,
      );
      ctx.fill();
    }
  }

  // A new wall announces itself with a sweep of its own colour, so levelling up
  // is legible without a word of copy.
  const sinceLevel = game.clock - game.levelStartedAt;
  if (game.level > 1 && sinceLevel < 900 && !reducedMotion) {
    ctx.fillStyle = `hsl(${hue(0)} 70% 60% / ${(1 - sinceLevel / 900) * 16}%)`;
    ctx.fillRect(0, 0, field.width, field.height);
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

  if (game.phase === "playing" && !game.paused && !reducedMotion) {
    trail.push({ x: game.ball.x, y: game.ball.y });
    if (trail.length > TRAIL_LENGTH) trail.shift();
  } else if (game.phase !== "playing") {
    trail = [];
  }

  announce();
  syncControls();
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

  window.addEventListener("pointerdown", onPointer);
  window.addEventListener("pointermove", onPointer);
  window.addEventListener("resize", () => {
    fitCanvas();
    resize(game, measure());
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
