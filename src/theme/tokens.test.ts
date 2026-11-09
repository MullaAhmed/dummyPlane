import { describe, expect, it } from "vitest";
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

/** The user's hex values, kept exactly: 60% canvas, 30% text and surfaces, 10% accent. */
const MAIN: Record<PaletteId, Record<string, string>> = {
  calm: { "--ov-canvas": "#EDE3CC", "--ov-secondary": "#173F32", "--ov-accent": "#F52B94" },
  electric: { "--ov-canvas": "#263CF5", "--ov-secondary": "#F4F4F1", "--ov-accent": "#B6F52B" },
  expressive: { "--ov-canvas": "#101014", "--ov-secondary": "#2864F5", "--ov-accent": "#FF781B" },
};

const SCHEME: Record<PaletteId, "light" | "dark"> = { calm: "light", electric: "dark", expressive: "dark" };

/** Every token the components read, in each palette. */
const REQUIRED = [
  "canvas", "dot", "surface", "card", "field", "line", "hover", "text", "text-2", "text-3", "secondary",
  "accent", "accent-ink", "accent-soft", "on-accent", "on-role", "wait", "ok", "danger", "terminal", "terminal-head",
  "glass", "glass-strong", "glass-line", "glass-hi", "glass-edge", "tray", "head", "tab-on",
  "glow-1", "glow-2", "glow-3", "shadow", "float-shadow", "draw",
].map((name) => `--ov-${name}`);

const OPAQUE = { "--ov-glass": "var(--ov-surface)", "--ov-glass-strong": "var(--ov-surface)", "--ov-head": "var(--ov-terminal-head)", "--ov-blur": "none" };

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

  it("declares the color scheme of each palette: calm light, electric and expressive dark", () => {
    for (const palette of Object.keys(SCHEME) as PaletteId[]) expect(schemeOf(palette), palette).toBe(SCHEME[palette]);
  });

  it("makes expressive the :root default, so nothing paints unstyled before the palette is set", () => {
    expect(cssBlock(tokens, PALETTE_SELECTORS.expressive)).toMatchObject(MAIN.expressive);
    expect(tokens).toContain(':root, :root[data-palette="expressive"] {');
  });

  it("keeps the habillage names as aliases until R2 and R3 rebuild their components", () => {
    const shared = cssBlock(tokens, ":root");
    for (const alias of ["--ov-surface-2", "--ov-command", "--ov-selected", "--ov-working", "--ov-waiting", "--ov-idle", "--ov-done", "--ov-live"]) {
      expect(shared[alias], alias).toMatch(/^var\(--ov-/);
    }
    expect(shared["--ov-blur"]).toBe("blur(18px) saturate(150%)");
  });

  it("no longer defines the old Argile and Ivoire themes", () => {
    expect(tokens).not.toMatch(/data-theme=/);
    expect(tokens).not.toMatch(/Argile|Ivoire/);
  });

  it("turns every glass opaque without transparency, from the reduced-transparency setting or from OpenVibe's", () => {
    expect(tokens).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(
      cssBlock(
        tokens,
        ':root[data-palette="calm"], :root[data-palette="electric"], :root[data-palette="expressive"]',
        "@media (prefers-reduced-transparency: reduce)",
      ),
    ).toMatchObject(OPAQUE);
    expect(cssBlock(tokens, ':root[data-palette][data-transparency="off"]')).toMatchObject(OPAQUE);
  });

  it("offers the glass and ambient utilities built on these tokens", () => {
    expect(index).toMatch(/\.ov-glass \{[^}]*var\(--ov-glass\)[^}]*var\(--ov-blur\)/);
    expect(index).toMatch(/\.ov-glass-strong \{[^}]*var\(--ov-glass-strong\)[^}]*var\(--ov-blur\)/);
    expect(index).toMatch(/\.ov-ambient \{[^}]*var\(--ov-glow-1\)[^}]*var\(--ov-glow-2\)[^}]*var\(--ov-glow-3\)/);
  });
});
