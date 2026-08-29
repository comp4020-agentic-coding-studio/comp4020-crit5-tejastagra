import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// These answer this week's published spec (crits/05-game), not the
// invariants every prototype holds to. They start red: there is no game yet.
//
// Untestable by design, and judged at the crit instead — see the spec:
// - "it teaches itself: no instructions anywhere ... the opening screen
//   invites the first move" (whether the affordance actually reads as one)
// - "a stranger can pick it up and reach an ending inside five minutes"
// - "one change you made came from playing the finished game" / process
//   evidence (PROCESS.md, reflections/crit-5.md, check:evidence)
//
// "one rule of the game has a focused automated test" is on you once the
// mechanic exists: add it alongside these, testing the rule by running the
// built bundle (see loadPage below), not by reading markup.

const DIST = resolve("dist");
const ASSETS = join(DIST, "_astro");

function bundles(): string[] {
  // No client-side script has shipped yet if this directory doesn't exist —
  // a game with no client JS can't run, so that's still nothing to hide.
  let entries: string[];
  try {
    entries = readdirSync(ASSETS);
  } catch {
    return [];
  }
  return entries.filter((file) => file.endsWith(".js")).map((file) => join(ASSETS, file));
}

/** Loads the built page into a JSDOM window and actually runs its bundle. */
async function loadPage() {
  const dom = new JSDOM(readFileSync(join(DIST, "index.html"), "utf8"), {
    runScripts: "outside-only",
    url: "https://example.test/",
  });
  const { window } = dom;

  if (window.document.readyState !== "complete") {
    await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
  }

  // Bounded, so a self-rescheduling loop can't hang the test — it still runs
  // for real, so a draw/tick loop that throws on frame one is caught, not hidden.
  let frames = 0;
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      if (frames++ < 60) callback(window.performance.now());
      return 0;
    },
  });

  for (const file of bundles()) {
    window.eval(readFileSync(file, "utf8"));
  }
  return { window };
}

describe("the built game actually runs", () => {
  it("executes without throwing", async () => {
    await expect(
      loadPage(),
      "the bundle threw while loading, so the page will render and respond to nothing",
    ).resolves.toBeDefined();
  });

  it("shows no instructions anywhere on the built page", async () => {
    const { window } = await loadPage();
    const text = window.document.body.textContent ?? "";
    expect(
      text,
      "no how-to-play text, tutorial copy or rules explanation belongs on screen — the opening screen has to make the first move obvious on its own",
    ).not.toMatch(/how to play|instructions|tutorial|controls?:/i);
  });

  // The spec's whole point: "it can be lost ... play ends somewhere — a win,
  // a loss or a finish". This can't know your mechanic in advance, so it
  // floods the page with plausible input (keys, clicks, drags) for a few
  // seconds of simulated time and just asks whether *some* ending ever shows.
  // Announce it through `[data-testid="outcome"]` (or any `aria-live` region)
  // so a screen reader user gets it too — that's what this test actually
  // reads.
  it("reaches a distinguishable end state under play", async () => {
    const { window } = await loadPage();
    const document = window.document;

    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Enter"];
    for (let tick = 0; tick < 400; tick++) {
      const key = keys[tick % keys.length];
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
      window.dispatchEvent(new window.KeyboardEvent("keyup", { key, bubbles: true }));
      const target = document.elementFromPoint?.(tick % 800, (tick * 3) % 600) ?? document.body;
      target.dispatchEvent(
        new window.MouseEvent("pointerdown", {
          clientX: tick % 800,
          clientY: (tick * 3) % 600,
          bubbles: true,
        }),
      );
      target.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
    }

    const outcome =
      document.querySelector("[data-testid='outcome']") ??
      document.querySelector("[aria-live]");
    expect(
      outcome?.textContent?.trim(),
      "no [data-testid='outcome'] or [aria-live] region ever announced an ending, after a flood of keys and clicks — a game that can't be seen to end hasn't shipped the one thing this brief asks for",
    ).toMatch(/win|lost|lose|game over|finish|end/i);
  });
});
