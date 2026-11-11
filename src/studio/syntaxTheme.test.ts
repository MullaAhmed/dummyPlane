import { describe, expect, it } from "vitest";
import { tags } from "@lezer/highlight";
import type { ThemeChoice } from "@/app/theme";
import { TERMINAL_THEMES } from "@/nodes/terminal/terminalTheme";
import { blend, contrast, oklabDistance, oklch } from "@/theme/colorMath";
import { cssBlock, readSource } from "@/theme/cssBlocks";
import { SYNTAX_HUES, syntaxStyleFor, type SyntaxHue } from "./syntaxTheme";

/**
 * Code reads on the panel it sits on, in each palette (WCAG 1.4.3, 4.5:1): every color the
 * highlight style writes with, read from the style itself, against the editor's grounds,
 * computed from tokens.css.
 */
const tokens = readSource("theme/tokens.css");

const PALETTES: Record<ThemeChoice, string> = {
  calm: ':root[data-palette="calm"]',
  electric: ':root[data-palette="electric"]',
  expressive: ':root, :root[data-palette="expressive"]',
};

const HUES: SyntaxHue[] = ["red", "green", "yellow", "blue", "magenta", "cyan"];

/** An `rgba(r,g,b,a)` token over an opaque ground, composited as the browser does. */
function over(ground: string, value: string): string {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(value);
  if (!m) throw new Error(`not an rgba token: ${value}`);
  const top = "#" + m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  return blend(ground, top, Number(m[4]));
}

/** The grounds code is read on: the surface (the Code Studio's pane, the notes' dialog), the active line, the accent's tint. */
function grounds(t: Record<string, string>) {
  const surface = t["--dp-surface"];
  return { surface, activeLine: over(surface, t["--dp-hover"]), tint: over(surface, t["--dp-accent-soft"]) };
}

/** A spec's color as a hex: its own, or the token it names. */
function resolve(t: Record<string, string>, color: string): string {
  const token = /^var\((--dp-[\w-]+)\)$/.exec(color);
  const hex = token ? t[token[1]] : color;
  expect(hex, color).toMatch(/^#[0-9A-F]{6}$/i);
  return hex;
}

/** Every color the palette's highlight style writes with. */
function colors(palette: ThemeChoice): string[] {
  return syntaxStyleFor(palette)
    .specs.map((spec) => (spec as { color?: string }).color)
    .filter((color): color is string => color !== undefined);
}

describe("syntax colors made for each palette (P1-10)", () => {
  it("composites like the audit measured: One Dark's comment on electric's surface 2.51, on its active line 2.24", () => {
    const g = grounds(cssBlock(tokens, PALETTES.electric));
    expect(contrast("#7D8799", g.surface)).toBeCloseTo(2.51, 2);
    expect(contrast("#7D8799", g.activeLine)).toBeCloseTo(2.24, 1);
  });

  it("reads every token color at 4.5:1 on the surface and on the active line, in every palette", () => {
    for (const [palette, selector] of Object.entries(PALETTES) as [ThemeChoice, string][]) {
      const t = cssBlock(tokens, selector);
      const g = grounds(t);
      const used = colors(palette);
      expect(used.length, palette).toBeGreaterThan(8);
      for (const color of used) {
        for (const ground of ["surface", "activeLine"] as const) {
          expect(contrast(resolve(t, color), g[ground]), `${palette} ${color} on the ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps the six hues at 4.5:1 on the accent's tint: a search match, the line reached, a selection off the caret line", () => {
    for (const [palette, selector] of Object.entries(PALETTES) as [ThemeChoice, string][]) {
      const g = grounds(cssBlock(tokens, selector));
      for (const hue of HUES) {
        expect(contrast(SYNTAX_HUES[palette][hue], g.tint), `${palette} ${hue} on the tint`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("draws in the terminals' hues: each within 2° (OKLCH) of the terminal color of the same name", () => {
    for (const palette of Object.keys(PALETTES) as ThemeChoice[]) {
      for (const hue of HUES) {
        const [mine, terminal] = [oklch(SYNTAX_HUES[palette][hue]).h, oklch(TERMINAL_THEMES[palette][hue]).h];
        const gap = Math.min(Math.abs(mine - terminal), 360 - Math.abs(mine - terminal));
        expect(gap, `${palette} ${hue}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("keeps the six hues apart from one another and from the plain text (0.07 in OKLab)", () => {
    for (const [palette, selector] of Object.entries(PALETTES) as [ThemeChoice, string][]) {
      const text = cssBlock(tokens, selector)["--dp-text"];
      const set = SYNTAX_HUES[palette];
      for (const [i, a] of HUES.entries()) {
        expect(oklabDistance(set[a], text), `${palette} ${a} vs the text`).toBeGreaterThanOrEqual(0.07);
        for (const b of HUES.slice(i + 1)) expect(oklabDistance(set[a], set[b]), `${palette} ${a} vs ${b}`).toBeGreaterThanOrEqual(0.07);
      }
    }
  });

  it("styles code and prose alike: keywords, strings, comments, headings, emphasis, links and errors each get a style", () => {
    const wanted = [tags.keyword, tags.string, tags.number, tags.comment, tags.typeName, tags.function(tags.variableName), tags.heading, tags.strong, tags.emphasis, tags.strikethrough, tags.link, tags.invalid];
    for (const palette of Object.keys(PALETTES) as ThemeChoice[]) {
      const style = syntaxStyleFor(palette);
      for (const tag of wanted) expect(style.style([tag]), `${palette} styles ${String(tag)}`).not.toBeNull();
    }
  });

  it("gives each palette its own style, so a palette switch recolors the code", () => {
    const [calm, electric, expressive] = (["calm", "electric", "expressive"] as const).map((p) => syntaxStyleFor(p).style([tags.keyword]));
    expect(new Set([calm, electric, expressive]).size).toBe(3);
  });

  it("no longer reads One Dark or CodeMirror's default highlighting", () => {
    expect(readSource("studio/CodeEditor.tsx")).not.toMatch(/oneDarkHighlightStyle|defaultHighlightStyle/);
  });
});
