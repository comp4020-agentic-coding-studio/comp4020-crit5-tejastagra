/**
 * Everything that touches the page: canvas rendering, pointer input, and the
 * one line of DOM that announces an ending. The rules live in game.ts and know
 * nothing about any of this.
 *
 * Input is pointer-only on purpose. Pointer Events already cover mouse, trackpad
 * and touch through one path, and arrow keys would leave the phone viewport
 * with no way to play at all. Dragging anywhere on the screen steers, so a
 * thumb never has to sit on top of the paddle it is trying to see.
 */

import {
  advance,
  createGame,
  isSolid,
  movePaddle,
  regrowth,
  resize,
  restart,
  takeControl,
} from "./game.ts";
import type { Brick, Game } from "./game.ts";

const MAX_FIELD_WIDTH = 620;
const MAX_FIELD_HEIGHT = 880;
/** Longest frame the physics will accept, so a backgrounded tab cannot teleport the ball. */
const MAX_FRAME_SECONDS = 1 / 30;
const TRAIL_LENGTH = 12;

const canvas = document.querySelector<HTMLCanvasElement>("#play");
const outcome = document.querySelector<HTMLElement>("[data-testid='outcome']");
const outcomePanel = document.querySelector<HTMLElement>("[data-outcome-panel]");
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

function measure(): { width: number; height: number } {
  const cssWidth = Math.max(1, window.innerWidth);
  const cssHeight = Math.max(1, window.innerHeight);
  const width = Math.min(cssWidth, MAX_FIELD_WIDTH);
  // A phone is far taller than it is wide and a desktop is not, so the field
  // takes what it can get vertically rather than copying the desktop shape.
  const height = Math.min(cssHeight, MAX_FIELD_HEIGHT, width * 2.3);
  offsetX = (cssWidth - width) / 2;
  offsetY = (cssHeight - height) / 2;
  return { width, height };
}

function fitCanvas(): void {
  if (!canvas || !context) return;
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  const cssWidth = Math.max(1, window.innerWidth);
  const cssHeight = Math.max(1, window.innerHeight);
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

/** Turns a pointer's page position into a field coordinate, or null if the canvas has no size yet. */
function fieldX(event: { clientX: number }): number | null {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return null;
  return event.clientX - rect.left - offsetX;
}

function hue(row: number): number {
  return 168 + (row / Math.max(1, game.rules.rows - 1)) * 82;
}

function drawBrick(ctx: CanvasRenderingContext2D, brick: Brick, now: number): void {
  const growth = regrowth(brick, now);
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
    ctx.fillStyle = "hsl(38 90% 62% / 70%)";
    ctx.arc(size * 3 + index * gap, baseY, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function draw(now: number): void {
  if (!context || !canvas) return;
  const ctx = context;
  const { field, ball, paddle } = game;

  ctx.save();
  ctx.setTransform(
    Math.min(3, window.devicePixelRatio || 1),
    0,
    0,
    Math.min(3, window.devicePixelRatio || 1),
    0,
    0,
  );
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.restore();

  ctx.save();
  const jolt = shake > 0 ? (Math.random() - 0.5) * shake : 0;
  ctx.translate(offsetX + jolt, offsetY);

  // The play area, so the edges the ball bounces off are visible on a wide screen.
  ctx.fillStyle = "#0b1120";
  ctx.beginPath();
  ctx.roundRect(0, 0, field.width, field.height, 14);
  ctx.fill();
  ctx.strokeStyle = "hsl(210 40% 70% / 10%)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, field.width, field.height, 14);
  ctx.clip();

  for (const brick of game.bricks) drawBrick(ctx, brick, now);

  if (!reducedMotion) {
    trail.forEach((point, index) => {
      const strength = (index + 1) / trail.length;
      ctx.beginPath();
      ctx.fillStyle = `hsl(200 100% 88% / ${strength * 22}%)`;
      ctx.arc(point.x, point.y, ball.radius * strength * 0.85, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.save();
  ctx.shadowColor = "hsl(196 100% 75% / 80%)";
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
  ctx.shadowColor = `hsl(38 95% 60% / ${40 + pulse * 45}%)`;
  ctx.shadowBlur = 12 + pulse * 18;
  ctx.fillStyle = "hsl(38 92% 64%)";
  ctx.beginPath();
  ctx.roundRect(paddle.x, paddle.y, paddle.width, paddle.height, paddle.height / 2);
  ctx.fill();
  ctx.restore();

  drawLives(ctx);
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

function frame(timestamp: number): void {
  const dt = Math.min(MAX_FRAME_SECONDS, (timestamp - lastFrame) / 1000 || 0);
  lastFrame = timestamp;

  const result = advance(game, dt, timestamp);
  if (result.broke > 0) shake = Math.min(6, shake + 2.5);
  if (result.lostLife) shake = 9;
  shake *= 0.88;
  if (shake < 0.05) shake = 0;

  if (game.phase === "attract") {
    // The paddle drifts by itself until someone takes it over. A still screen
    // invites nothing; a moving one says "this part is yours" without a word.
    const drift = Math.sin(timestamp / 1600) * (game.field.width * 0.22);
    movePaddle(game, game.field.width / 2 + drift);
  }

  if (game.phase === "playing" && !reducedMotion) {
    trail.push({ x: game.ball.x, y: game.ball.y });
    if (trail.length > TRAIL_LENGTH) trail.shift();
  } else if (game.phase !== "playing") {
    trail = [];
  }

  announce();
  draw(timestamp);
  window.requestAnimationFrame(frame);
}

function onPointer(event: PointerEvent): void {
  const now = performance.now();
  if (game.phase === "won" || game.phase === "lost") {
    if (event.type === "pointerdown") {
      restart(game, now);
      announce();
    }
    return;
  }
  takeControl(game, now);
  const x = fieldX(event);
  if (x !== null) movePaddle(game, x);
}

function setup(): void {
  if (!canvas || !context) return;
  fitCanvas();
  game = createGame(measure(), performance.now());

  window.addEventListener("pointerdown", onPointer);
  window.addEventListener("pointermove", onPointer);
  window.addEventListener("resize", () => {
    fitCanvas();
    resize(game, measure());
  });

  // A debug handle, and the only way spec/crit-5.test.ts can ask the built
  // bundle whether it actually wired itself up rather than merely loaded.
  (window as unknown as { __overgrow?: unknown }).__overgrow = { get game() { return game; } };

  lastFrame = performance.now();
  window.requestAnimationFrame(frame);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setup, { once: true });
} else {
  setup();
}
