import { describe, expect, it, vi } from "vitest";

// Slow under the load of the full suite: this file's tests get their own timeout.
vi.setConfig({ testTimeout: 30_000 });
import { cssBlock, readSource, sourceFiles } from "./cssBlocks";

/**
 * Focus has to be found: a focus ring is a state indicator, so it needs 3:1 against
 * what it is drawn on (WCAG 1.4.11, 2.4.7). The ratios are computed from tokens.css,
 * and the alphas are read from the components, so a weaker ring anywhere fails here.
 */
const tokens = readSource("theme/tokens.css");

const PALETTES = {
  calm: ':root[data-palette="calm"]',
  electric: ':root[data-palette="electric"]',
  expressive: ':root, :root[data-palette="expressive"]',
};

/** The grounds a ring is drawn over: the canvas, the panels and menus, the cards, a terminal's head. */
const GROUNDS = ["--dp-canvas", "--dp-surface", "--dp-card", "--dp-terminal-head"];

/** Lines another branch owns, still on the old ring: they move to /70 with that branch. */
const PENDING: string[] = [];

type Rgb = [number, number, number];

/** The red, green and blue of a `#rrggbb` token, with the alpha of an `rgba(r,g,b,a)` one. */
function color(value: string): { rgb: Rgb; alpha: number } {
  if (value.startsWith("#")) return { rgb: [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb, alpha: 1 };
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(value);
  if (!m) throw new Error(`not a colour: ${value}`);
  return { rgb: m.slice(1, 4).map(Number) as Rgb, alpha: Number(m[4]) };
}

/** `fg` at `alpha` over an opaque `bg`, composited the way the browser does (gamma-encoded sRGB). */
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as Rgb;

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A ring of `token` at `alpha` against the ground it is drawn on. */
function ringOn(t: Record<string, string>, token: string, alpha: number, ground: Rgb): number {
  return contrast(over(color(t[token]).rgb, alpha, ground), ground);
}

/** Every focus ring written in `text` in `tone` (`accent`, `danger`), with its alpha (1 when none is given). */
function focusRings(text: string, tone: "accent" | "danger"): number[] {
  const ring = new RegExp(`[^\\s"'\`]*focus[^\\s"'\`]*:ring-dp-${tone}(?:/(\\d+))?(?![\\w/-])`, "g");
  return [...text.matchAll(ring)].map((m) => (m[1] ? Number(m[1]) / 100 : 1));
}

/** The class string of a shadcn part, as written in its file: the string right after `data-slot="<slot>"`. */
function slotClasses(file: string, slot: string): string {
  const text = readSource(file);
  const at = text.indexOf(`data-slot="${slot}"`);
  expect(at, `${file} renders ${slot}`).toBeGreaterThanOrEqual(0);
  return /"([^"]*)"/.exec(text.slice(text.indexOf("className", at)))![1];
}

describe("focus rings clear 3:1 in every palette", () => {
  it("composites like the audit measured: calm /50 on a surface 2.71, /70 4.51; electric /70 on the canvas 3.79", () => {
    const calm = cssBlock(tokens, PALETTES.calm);
    const electric = cssBlock(tokens, PALETTES.electric);
    expect(ringOn(calm, "--dp-accent", 0.5, color(calm["--dp-surface"]).rgb)).toBeCloseTo(2.71, 2);
    expect(ringOn(calm, "--dp-accent", 0.7, color(calm["--dp-surface"]).rgb)).toBeCloseTo(4.51, 2);
    expect(ringOn(electric, "--dp-accent", 0.7, color(electric["--dp-canvas"]).rgb)).toBeCloseTo(3.79, 2);
  });

  it("draws the shared ring in the accent at /70, which every ground of every palette reads at 3:1 or more", () => {
    expect(focusRings(readSource("components/ui/button.tsx"), "accent")).toEqual([0.7]);
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      for (const ground of GROUNDS) {
        expect(ringOn(t, "--dp-accent", 0.7, color(t[ground]).rgb), `${palette} ring on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("writes no weaker focus ring in any component: each alpha clears 3:1 on every ground", () => {
    for (const [file, text] of Object.entries(sourceFiles())) {
      if (PENDING.includes(file)) continue;
      const alphas = focusRings(text, "accent");
      for (const alpha of alphas) {
        for (const [palette, selector] of Object.entries(PALETTES)) {
          const t = cssBlock(tokens, selector);
          for (const ground of GROUNDS) {
            expect(ringOn(t, "--dp-accent", alpha, color(t[ground]).rgb), `${file}: ring /${alpha * 100} in ${palette} on ${ground}`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it("gives a destructive control a danger ring that clears 3:1, on the grounds and on its own tinted fill", () => {
    const destructive = /destructive:\s*"([^"]*)"/.exec(readSource("components/ui/button.tsx"))![1];
    const alphas = focusRings(destructive, "danger");
    expect(alphas, "the destructive variant names its own focus ring").toHaveLength(1);
    const everywhere = Object.values(sourceFiles()).flatMap((text) => focusRings(text, "danger"));
    for (const alpha of [...alphas, ...everywhere]) {
      for (const [palette, selector] of Object.entries(PALETTES)) {
        const t = cssBlock(tokens, selector);
        for (const ground of GROUNDS) {
          expect(ringOn(t, "--dp-danger", alpha, color(t[ground]).rgb), `${palette} danger ring /${alpha * 100} on ${ground}`).toBeGreaterThanOrEqual(3);
        }
        // The destructive button's fill: danger at 10% on a surface.
        const fill = over(color(t["--dp-danger"]).rgb, 0.1, color(t["--dp-surface"]).rgb);
        expect(ringOn(t, "--dp-danger", alpha, fill), `${palette} danger ring on the danger/10 fill`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("shows the keyboard's place in menus and selects with an inset ring that clears 3:1 on the row's hover fill", () => {
    const rows: [string, string][] = [
      ["components/ui/dropdown-menu.tsx", "dropdown-menu-item"],
      ["components/ui/dropdown-menu.tsx", "dropdown-menu-checkbox-item"],
      ["components/ui/dropdown-menu.tsx", "dropdown-menu-radio-item"],
      ["components/ui/dropdown-menu.tsx", "dropdown-menu-sub-trigger"],
      ["components/ui/select.tsx", "select-item"],
    ];
    for (const [file, slot] of rows) {
      const classes = slotClasses(file, slot).split(/\s+/);
      // The pointer keeps the fill; the keyboard adds the ring, inset so the next row does not cover it.
      expect(classes, `${slot} keeps the pointer's fill`).toContain("focus:bg-dp-hover");
      expect(classes, `${slot} rings the keyboard's row`).toEqual(expect.arrayContaining(["focus-visible:ring-1", "focus-visible:ring-inset"]));
      // Never data-highlighted: Radix sets it on pointer move too.
      expect(classes.filter((c) => c.startsWith("data-highlighted:")), slot).toEqual([]);
      const alphas = focusRings(classes.join(" "), "accent");
      expect(alphas, `${slot} draws its ring in the accent`).toHaveLength(1);
      for (const [palette, selector] of Object.entries(PALETTES)) {
        const t = cssBlock(tokens, selector);
        const surface = color(t["--dp-surface"]).rgb;
        const hover = color(t["--dp-hover"]);
        const lit = over(hover.rgb, hover.alpha, surface);
        expect(ringOn(t, "--dp-accent", alphas[0], lit), `${palette} ${slot} ring on its hover fill`).toBeGreaterThanOrEqual(3);
        expect(ringOn(t, "--dp-accent", alphas[0], surface), `${palette} ${slot} ring on the menu`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("never fades a focus ring in: no transition list names box-shadow, the property a ring is drawn with", () => {
    for (const [file, text] of Object.entries(sourceFiles())) {
      if (PENDING.includes(file)) continue;
      expect(text.match(/transition-\[[^\]]*box-shadow[^\]]*\]|transition-shadow\b/g) ?? [], file).toEqual([]);
    }
  });

  it("draws the browser's own focus outline at the same /70, where a control has no ring of its own", () => {
    const base = /@apply border-border outline-ring\/(\d+);/.exec(readSource("index.css"));
    expect(base, "index.css sets the base outline colour").not.toBeNull();
    // --ring is the accent (index.css).
    expect(readSource("index.css")).toMatch(/--ring: var\(--dp-accent\);/);
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      for (const ground of GROUNDS) {
        expect(ringOn(t, "--dp-accent", Number(base![1]) / 100, color(t[ground]).rgb), `${palette} outline on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps the design system's page on the value the code uses", () => {
    const doc = readSource("../docs/design-system.md");
    expect(doc).toContain("focus-visible:ring-dp-accent/70");
    expect(doc).not.toContain("ring-dp-accent/50");
  });
});
