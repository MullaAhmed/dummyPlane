import { describe, expect, it } from "vitest";
import { PALETTES } from "@/app/theme";
import { cssBlock, readSource } from "./cssBlocks";

const tokens = readSource("theme/tokens.css");
const index = readSource("index.css");

/** The selector of each palette's block. `expressive` is also the `:root` default. */
export const PALETTE_SELECTORS = {
  calm: ':root[data-palette="calm"]',
  electric: ':root[data-palette="electric"]',
  expressive: ':root, :root[data-palette="expressive"]',
} as const;
export type PaletteId = keyof typeof PALETTE_SELECTORS;

/** The user's hex values, kept exactly: each palette is two colors, the canvas and the ink, which is also the accent. */
const MAIN: Record<PaletteId, Record<string, string>> = {
  calm: { "--dp-canvas": "#EDE3CC", "--dp-secondary": "#173F32", "--dp-accent": "#173F32" },
  electric: { "--dp-canvas": "#263CF5", "--dp-secondary": "#F4F4F1", "--dp-accent": "#F4F4F1" },
  expressive: { "--dp-canvas": "#101014", "--dp-secondary": "#F4F4F1", "--dp-accent": "#F4F4F1" },
};

const SCHEME: Record<PaletteId, "light" | "dark"> = { calm: "light", electric: "dark", expressive: "dark" };

/** Every token the components read, in each palette. */
const REQUIRED = [
  "canvas", "dot", "surface", "card", "field", "line", "line-strong", "hover", "selection", "text", "text-2", "text-3", "secondary",
  "accent", "accent-ink", "accent-soft", "on-accent", "on-role", "on-wait", "wait", "ok", "danger", "terminal", "terminal-head",
  "tray", "tab-on", "shadow", "float-shadow", "draw",
].map((name) => `--dp-${name}`);

/** The surfaces things are drawn on: opaque hexes in every palette, never an alpha. */
const SURFACES = ["--dp-canvas", "--dp-surface", "--dp-card", "--dp-terminal", "--dp-terminal-head"];

/** Retired effects: kept as no-ops in the shared block until no component reads them, defined by no palette. */
const RETIRED = { "--dp-glow-1": "transparent", "--dp-glow-2": "transparent", "--dp-glow-3": "transparent" };

/** The red, green, blue and alpha of an `rgba(r,g,b,a)` token. */
function rgba(value: string): [number, number, number, number] {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(value);
  expect(m, value).not.toBeNull();
  return m!.slice(1).map(Number) as [number, number, number, number];
}

/** The red, green and blue of a `#rrggbb` token. */
function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** The `color-scheme` a palette's block declares (cssBlock reads custom properties only). */
function schemeOf(palette: PaletteId): string {
  const at = tokens.indexOf(`${PALETTE_SELECTORS[palette]} {`);
  expect(at, `${palette} has its block`).toBeGreaterThanOrEqual(0);
  return /color-scheme:\s*(\w+);/.exec(tokens.slice(at))![1];
}

describe("design tokens (spec identité §4.2)", () => {
  it("defines every token in each of the three palettes", () => {
    for (const palette of Object.keys(PALETTE_SELECTORS) as PaletteId[]) {
      const block = cssBlock(tokens, PALETTE_SELECTORS[palette]);
      for (const name of REQUIRED) expect(block, `${palette} ${name}`).toHaveProperty(name);
    }
  });

  it("keeps the user's main hexes exactly in each palette", () => {
    for (const palette of Object.keys(MAIN) as PaletteId[]) {
      expect(cssBlock(tokens, PALETTE_SELECTORS[palette])).toMatchObject(MAIN[palette]);
    }
  });

  it("draws each palette in its two colors: the ink writes the text and is the accent, written on in the canvas color", () => {
    for (const palette of Object.keys(PALETTE_SELECTORS) as PaletteId[]) {
      const t = cssBlock(tokens, PALETTE_SELECTORS[palette]);
      for (const name of ["--dp-secondary", "--dp-accent", "--dp-accent-ink", "--dp-draw"]) {
        expect(t[name], `${palette} ${name}`).toBe(t["--dp-text"]);
      }
      expect(t["--dp-on-accent"], `${palette} --dp-on-accent`).toBe(t["--dp-canvas"]);
    }
  });

  it("draws hairlines, hovers and the selection in the ink at a low alpha, a selection at least twice a hover", () => {
    for (const palette of Object.keys(PALETTE_SELECTORS) as PaletteId[]) {
      const t = cssBlock(tokens, PALETTE_SELECTORS[palette]);
      const ink = rgb(t["--dp-text"]);
      for (const name of ["--dp-line", "--dp-hover", "--dp-accent-soft"]) {
        expect(rgba(t[name]).slice(0, 3), `${palette} ${name} is the ink`).toEqual(ink);
      }
      const alpha = rgba(t["--dp-line"])[3];
      expect(alpha, `${palette} --dp-line: a hairline, 6 to 10%`).toBeGreaterThanOrEqual(0.06);
      expect(alpha, `${palette} --dp-line: a hairline, 6 to 10%`).toBeLessThanOrEqual(0.1);
      expect(rgba(t["--dp-accent-soft"])[3], palette).toBeGreaterThanOrEqual(2 * rgba(t["--dp-hover"])[3]);
    }
  });

  it("gives depth with surface steps and hairlines: a small neutral shadow in the light palette, none in the dark ones", () => {
    for (const palette of Object.keys(PALETTE_SELECTORS) as PaletteId[]) {
      const t = cssBlock(tokens, PALETTE_SELECTORS[palette]);
      const shadow = SCHEME[palette] === "light" ? "0 8px 24px rgba(0,0,0,0.06)" : "0 0 #0000";
      expect(t["--dp-shadow"], palette).toBe(shadow);
      expect(t["--dp-float-shadow"], palette).toBe(shadow);
    }
  });

  it("retires the glows: no-ops in the shared block, in no palette, read nowhere in index.css", () => {
    expect(cssBlock(tokens, ":root")).toMatchObject(RETIRED);
    for (const palette of Object.keys(PALETTE_SELECTORS) as PaletteId[]) {
      const block = cssBlock(tokens, PALETTE_SELECTORS[palette]);
      for (const name of Object.keys(RETIRED)) expect(block, `${palette} ${name}`).not.toHaveProperty(name);
    }
    expect(index).not.toMatch(/--dp-glow|--dp-glass-hi|--dp-glass-edge|radial-gradient/);
  });

  it("keeps the accent PALETTES carries (what the wires are drawn in) the same as --dp-accent", () => {
    for (const palette of Object.keys(MAIN) as PaletteId[]) {
      expect(PALETTES[palette].accent, palette).toBe(MAIN[palette]["--dp-accent"]);
    }
  });

  it("declares the color scheme of each palette: calm light, electric and expressive dark", () => {
    for (const palette of Object.keys(SCHEME) as PaletteId[]) expect(schemeOf(palette), palette).toBe(SCHEME[palette]);
  });

  it("makes expressive the :root default, so nothing paints unstyled before the palette is set", () => {
    expect(cssBlock(tokens, PALETTE_SELECTORS.expressive)).toMatchObject(MAIN.expressive);
    expect(tokens).toContain(':root, :root[data-palette="expressive"] {');
  });

  it("keeps the habillage names as aliases until R2 and R3 rebuild their components", () => {
    const shared = cssBlock(tokens, ":root");
    for (const alias of ["--dp-surface-2", "--dp-command", "--dp-selected", "--dp-working", "--dp-waiting", "--dp-idle", "--dp-done", "--dp-live"]) {
      expect(shared[alias], alias).toMatch(/^var\(--dp-/);
    }
  });

  it("moves on one ease-out curve, quick for feedback and a little longer for menus", () => {
    const shared = cssBlock(tokens, ":root");
    expect(shared["--dp-ease-out"]).toBe("cubic-bezier(0.22,1,0.36,1)");
    const ms = (value: string) => Number(/^(\d+)ms$/.exec(value)![1]);
    expect(ms(shared["--dp-dur-fast"])).toBeGreaterThanOrEqual(120);
    expect(ms(shared["--dp-dur-fast"])).toBeLessThanOrEqual(180);
    expect(ms(shared["--dp-dur"])).toBeGreaterThanOrEqual(160);
    expect(ms(shared["--dp-dur"])).toBeLessThanOrEqual(220);
  });

  it("rounds by size: controls 8, cards and menus 12, panels and dialogs 16", () => {
    const theme = cssBlock(index, "@theme inline");
    expect(theme).toMatchObject({ "--radius-sm": "6px", "--radius-md": "8px", "--radius-lg": "var(--radius)", "--radius-xl": "16px" });
    expect(cssBlock(index, ":root")["--radius"]).toBe("12px");
  });

  it("no longer defines the old Argile and Ivoire themes", () => {
    expect(tokens).not.toMatch(/data-theme=/);
    expect(tokens).not.toMatch(/Argile|Ivoire/);
  });

  it("keeps every surface opaque in each palette: no glass tokens, no blur, no transparency fallback", () => {
    for (const palette of Object.keys(PALETTE_SELECTORS) as PaletteId[]) {
      const t = cssBlock(tokens, PALETTE_SELECTORS[palette]);
      for (const name of SURFACES) expect(t[name], `${palette} ${name}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    expect(tokens).not.toMatch(/--dp-glass|--dp-blur|--dp-head\b|data-transparency|prefers-reduced-transparency|blur\(/);
  });

  it("offers raised surfaces built on these tokens: the opaque surface, a hairline and the float shadow, nothing blurred", () => {
    const glass = /\.dp-glass,\s*\.dp-glass-strong \{([^}]*)\}/.exec(index);
    expect(glass, "dp-glass and dp-glass-strong share one rule").not.toBeNull();
    expect(glass![1]).toMatch(/^\s*background: var\(--dp-surface\);\s*border: 1px solid var\(--dp-line\);\s*box-shadow: var\(--dp-float-shadow\);\s*$/);
  });

  it("paints the app's ground flat, in the canvas color", () => {
    expect(index).toMatch(/\.dp-ambient \{\s*background-color: var\(--dp-canvas\);\s*\}/);
  });

  it("sets section labels in sentence case: 12 px, medium, the secondary text role, no tracking", () => {
    const label = /\.dp-label \{([^}]*)\}/.exec(index)![1];
    expect(label).toContain("@apply text-xs font-medium text-dp-text-2;");
    expect(label).not.toMatch(/uppercase|tracking/);
  });
});
