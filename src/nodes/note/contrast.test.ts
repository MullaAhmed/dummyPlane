import { expect, it } from "vitest";
import { blend, contrast } from "@/theme/colorMath";
import { cssBlock, readSource } from "@/theme/cssBlocks";

/**
 * A quick note reads in the three palettes (docs/design-system.md): what it
 * writes, it writes on its own ground, computed from tokens.css. Its card
 * takes the panels' surface, never a terminal's colours (calm's ink is 1.3:1
 * on a terminal's body).
 */

const tokens = readSource("theme/tokens.css");
const card = readSource("nodes/note/NoteNode.tsx");

const PALETTES = {
  calm: ':root[data-palette="calm"]',
  electric: ':root[data-palette="electric"]',
  expressive: ':root, :root[data-palette="expressive"]',
};

/** The colour tokens the card's classes name, by role: `bg-dp-surface` → `--dp-surface`. */
const used = (prefix: string) => new Set([...card.matchAll(new RegExp(`\\b${prefix}-dp-([a-z0-9-]+)`, "g"))].map((m) => `--dp-${m[1]}`));

it("draws on the panels' surface, with the text roles, and nothing of a terminal's", () => {
  expect([...used("bg")]).toEqual(["--dp-surface"]);
  expect([...used("text")].sort()).toEqual(["--dp-text", "--dp-text-2", "--dp-text-3"]);
  expect(card).not.toMatch(/dp-terminal|#[0-9a-f]{3,8}\b|\b(black|white)\b/i);
});

it("keeps its title, its text and its placeholder at 4.5:1 on its card in every palette", () => {
  for (const [palette, selector] of Object.entries(PALETTES)) {
    const t = cssBlock(tokens, selector);
    for (const ink of used("text")) {
      expect(contrast(t[ink], t["--dp-surface"]), `${palette} ${ink} on --dp-surface`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("rings its focused text at 3:1 at least on its card in every palette", () => {
  const alphas = [...card.matchAll(/focus-visible:ring-dp-accent\/(\d+)/g)].map((m) => Number(m[1]) / 100);
  expect(alphas.length).toBeGreaterThan(0);
  for (const [palette, selector] of Object.entries(PALETTES)) {
    const t = cssBlock(tokens, selector);
    for (const alpha of alphas) {
      const ring = blend(t["--dp-surface"], t["--dp-accent"], alpha);
      expect(contrast(ring, t["--dp-surface"]), `${palette} ring /${alpha * 100}`).toBeGreaterThanOrEqual(3);
    }
  }
});
