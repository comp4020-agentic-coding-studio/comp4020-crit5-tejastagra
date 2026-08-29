import { defineConfig } from "astro/config";

// GitHub Pages serves this repo at
// https://comp4020-agentic-coding-studio.github.io/comp4020-crit5-tejastagra/,
// so every asset/link needs that path prefix — `base` handles it project-wide.
export default defineConfig({
  base: "/comp4020-crit5-tejastagra",
});
