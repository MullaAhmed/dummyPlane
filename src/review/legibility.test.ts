import { expect, it } from "vitest";
import { blend, contrast } from "@/theme/colorMath";
import { cssBlock, readSource } from "@/theme/cssBlocks";

/**
 * The inks of the review's tinted rows (P1-14): a diff line's gutter on the add and delete
 * tints and their hover steps, and the selected file's letter and counts on the accent's tint.
 * The review panel is a raised surface, so every tint lies over `--dp-surface`.
 */
const tokens = readSource("theme/tokens.css");
const diffRow = readSource("review/DiffRow.tsx");
const panel = readSource("review/ReviewPanel.tsx");

const PALETTES = {
  calm: ':root[data-palette="calm"]',
  electric: ':root[data-palette="electric"]',
  expressive: ':root, :root[data-palette="expressive"]',
};

/** A token as an opaque colour over `ground`: an `rgba(…)` one composited, a `#rrggbb` one as is. */
function over(value: string, ground: string): string {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(value);
  if (!m) return value;
  const hex = "#" + m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  return blend(ground, hex, Number(m[4]));
}

/** The tints DiffRow names, e.g. `bg-dp-ok/16` and `hover:bg-dp-danger/24`, with their alphas. */
const tints = [...diffRow.matchAll(/bg-dp-(ok|danger)\/(\d+)/g)].map((m) => ({ role: m[1], alpha: Number(m[2]) / 100 }));

it("finds the diff's four tints in DiffRow", () => {
  expect(tints.map((t) => `${t.role}/${t.alpha * 100}`).sort()).toEqual(["danger/16", "danger/24", "ok/16", "ok/24"]);
});

it("writes a diff line's gutter in text-2, which every tint and hover step reads at 4.5:1 (text-3 fell to 3.58)", () => {
  const gutter = [...diffRow.matchAll(/w-(?:10|4) shrink-0[^"]*text-dp-(text-\d)/g)].map((m) => m[1]);
  expect(gutter).toEqual(["text-2", "text-2", "text-2"]);
  for (const [palette, selector] of Object.entries(PALETTES)) {
    const t = cssBlock(tokens, selector);
    for (const { role, alpha } of tints) {
      const row = blend(t["--dp-surface"], t[`--dp-${role}`], alpha);
      expect(contrast(t["--dp-text-2"], row), `${palette} text-2 on ${role}/${alpha * 100}`).toBeGreaterThanOrEqual(4.5);
      // The keyboard's ring on the line, inside it, still clears 3:1 on its tint.
      expect(contrast(blend(row, t["--dp-accent"], 0.7), row), `${palette} ring on ${role}/${alpha * 100}`).toBeGreaterThanOrEqual(3);
    }
  }
});

it("reads the selected file's row in text-2 on the accent's tint, where danger fell to 4.03 and text-3 to 4.21", () => {
  expect(panel).toMatch(/current \? "text-dp-text-2" : status\.tone/);
  expect(panel).toMatch(/current \? "text-dp-text-2" : "text-dp-danger"/);
  expect(panel).toMatch(/current \? "text-dp-text-2" : "text-dp-ok"/);
  for (const [palette, selector] of Object.entries(PALETTES)) {
    const t = cssBlock(tokens, selector);
    const selected = over(t["--dp-accent-soft"], t["--dp-surface"]);
    expect(contrast(t["--dp-text-2"], selected), `${palette} text-2 on accent-soft`).toBeGreaterThanOrEqual(4.5);
  }
});
