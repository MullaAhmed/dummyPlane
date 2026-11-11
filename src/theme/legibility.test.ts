import { expect, it, vi } from "vitest";

// Slow under the load of the full suite: this file's tests get their own timeout.
vi.setConfig({ testTimeout: 30_000 });
import { contrast } from "./colorMath";
import { cssBlock, readSource, sourceFiles } from "./cssBlocks";

const tokens = readSource("theme/tokens.css");

const PALETTES = {
  calm: ':root[data-palette="calm"]',
  electric: ':root[data-palette="electric"]',
  expressive: ':root, :root[data-palette="expressive"]',
};

it("writes on role colors with one dark ink, the same in every palette", () => {
  // Role colors do not change with the palette; the canvas colors would read at 2:1 on them.
  for (const selector of Object.values(PALETTES)) {
    expect(cssBlock(tokens, selector)["--dp-on-role"]).toBe("#1F1E1D");
  }
});

it("keeps text readable at WCAG AA (4.5:1) on the canvas, the surfaces and the cards, in each palette", () => {
  for (const [palette, selector] of Object.entries(PALETTES)) {
    const t = cssBlock(tokens, selector);
    for (const ink of ["--dp-text", "--dp-text-2", "--dp-text-3"]) {
      for (const bg of ["--dp-canvas", "--dp-surface", "--dp-card"]) {
        expect(contrast(t[ink], t[bg]), `${palette} ${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

it("writes on the accent at 4.5:1, and reads the accent as text through its ink variant", () => {
  for (const [palette, selector] of Object.entries(PALETTES)) {
    const t = cssBlock(tokens, selector);
    expect(contrast(t["--dp-on-accent"], t["--dp-accent"]), `${palette} on-accent on accent`).toBeGreaterThanOrEqual(4.5);
    for (const bg of ["--dp-canvas", "--dp-surface", "--dp-card"]) {
      expect(contrast(t["--dp-accent-ink"], t[bg]), `${palette} accent-ink on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("keeps the functional colors (wait, ok, danger) readable as text on the canvas", () => {
  for (const [palette, selector] of Object.entries(PALETTES)) {
    const t = cssBlock(tokens, selector);
    for (const role of ["--dp-wait", "--dp-ok", "--dp-danger"]) {
      expect(contrast(t[role], t["--dp-canvas"]), `${palette} ${role} on canvas`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("never inks with the canvas color, nor with an agent's raw tint", () => {
  for (const [file, text] of Object.entries(sourceFiles())) {
    expect(/text-dp-canvas/.test(text), `${file} : texte couleur du canvas`).toBe(false);
    expect(/color:\s*(meta|AGENTS\[[^\]]+\])\.tint\b/.test(text), `${file} : teinte brute en couleur de texte`).toBe(false);
  }
});
