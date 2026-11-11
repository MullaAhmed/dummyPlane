import { describe, expect, it } from "vitest";
import type { ITheme } from "@xterm/xterm";
import { createStore } from "zustand";
import type { ThemeChoice } from "@/app/theme";
import { blend, contrast, luminance, oklabDistance, oklch } from "@/theme/colorMath";
import { cssBlock, readSource } from "@/theme/cssBlocks";
import { followPalette, TERMINAL_THEMES, terminalThemeFor, type TerminalTheme } from "./terminalTheme";

const tokens = readSource("theme/tokens.css");
const PALETTE_NAMES: ThemeChoice[] = ["calm", "electric", "expressive"];
const HUES = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const;
const bright = (name: string) => `bright${name[0].toUpperCase()}${name.slice(1)}` as keyof TerminalTheme;
/** The 16 ANSI colors, in xterm's order. */
const ANSI = [
  "black", ...HUES, "white",
  "brightBlack", ...HUES.map(bright), "brightWhite",
] as (keyof TerminalTheme)[];
/** xterm draws faint text (SGR 2) at half opacity (addon-webgl's DIM_OPACITY). */
const FAINT = 0.5;

it("draws xterm on the node's body color in every palette, dark in each (spec identité §4.2)", () => {
  const selectors = {
    calm: ':root[data-palette="calm"]',
    electric: ':root[data-palette="electric"]',
    expressive: ':root, :root[data-palette="expressive"]',
  } as const;
  for (const [palette, selector] of Object.entries(selectors) as [keyof typeof selectors, string][]) {
    expect(cssBlock(tokens, selector)["--dp-terminal"]).toBe(terminalThemeFor(palette).background);
    expect(luminance(terminalThemeFor(palette).background), palette).toBeLessThan(0.05);
  }
  expect(Object.keys(TERMINAL_THEMES).sort()).toEqual(PALETTE_NAMES);
});

it("leaves none of xterm's default colors: each palette sets the same full theme, in hex", () => {
  const keys = Object.keys(terminalThemeFor("expressive")).sort();
  expect(keys).toHaveLength(26);
  for (const palette of PALETTE_NAMES) {
    const theme = terminalThemeFor(palette);
    expect(Object.keys(theme).sort(), palette).toEqual(keys);
    for (const [key, value] of Object.entries(theme)) {
      // Only the scrollbar is translucent; the rest is opaque, so the ratios below are the ones drawn.
      expect(value, `${palette} ${key}`).toMatch(key.startsWith("scrollbar") ? /^#[0-9A-F]{8}$/ : /^#[0-9A-F]{6}$/);
    }
  }
});

it("writes the text, the cursor and the selected text in the palette's light color", () => {
  const light = { calm: "#EDE3CC", electric: "#F4F4F1", expressive: "#F4F4F1" };
  for (const palette of PALETTE_NAMES) {
    const t = terminalThemeFor(palette);
    expect([t.foreground, t.cursor, t.selectionForeground, t.brightWhite], palette).toEqual(Array(4).fill(light[palette]));
    expect(t.cursorAccent, palette).toBe(t.background);
  }
});

describe("legibility on the terminal's body (WCAG AA, 4.5:1)", () => {
  it("keeps every ANSI color but black at 4.5:1 at least, dim text (bright black) included", () => {
    for (const palette of PALETTE_NAMES) {
      const t = terminalThemeFor(palette);
      for (const name of ANSI.filter((name) => name !== "black")) {
        expect(contrast(t[name], t.background), `${palette} ${name}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t.foreground, t.background), `${palette} foreground`).toBeGreaterThanOrEqual(7);
    }
  });

  it("makes black a background the text reads on, a step off the body", () => {
    for (const palette of PALETTE_NAMES) {
      const t = terminalThemeFor(palette);
      expect(contrast(t.foreground, t.black), `${palette} text on black`).toBeGreaterThanOrEqual(7);
      expect(luminance(t.black), `${palette} black above the body`).toBeGreaterThan(luminance(t.background));
      expect(contrast(t.black, t.background), `${palette} black stays dark`).toBeLessThan(1.5);
    }
  });

  it("keeps faint text (SGR 2) readable in the dark palettes, and near it in calm", () => {
    for (const palette of PALETTE_NAMES) {
      const t = terminalThemeFor(palette);
      const faint = blend(t.background, t.foreground, FAINT);
      // Calm's cream is its lightest color: at half opacity on the green body it reaches 4.1:1, no more.
      expect(contrast(faint, t.background), `${palette} faint text`).toBeGreaterThanOrEqual(palette === "calm" ? 4 : 4.5);
    }
  });

  it("keeps the selected text readable, focused or not, and the selection visible", () => {
    for (const palette of PALETTE_NAMES) {
      const t = terminalThemeFor(palette);
      for (const selection of [t.selectionBackground, t.selectionInactiveBackground]) {
        expect(contrast(t.selectionForeground, selection), `${palette} text on ${selection}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t.selectionBackground, t.background), `${palette} selection`).toBeGreaterThanOrEqual(2);
      expect(contrast(t.selectionInactiveBackground, t.background), `${palette} unfocused selection`).toBeGreaterThanOrEqual(1.4);
      expect(luminance(t.selectionInactiveBackground), `${palette} unfocused is quieter`).toBeLessThan(luminance(t.selectionBackground));
    }
  });

  it("shows the cursor at 3:1 (a UI part), and the letter under a block cursor at 4.5:1", () => {
    for (const palette of PALETTE_NAMES) {
      const t = terminalThemeFor(palette);
      expect(contrast(t.cursor, t.background), palette).toBeGreaterThanOrEqual(3);
      expect(contrast(t.cursorAccent, t.cursor), palette).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("colors made for each palette, still red, green, yellow…", () => {
  // OKLCH hue bands: wide enough for each palette's tuning, apart enough that a red never reads magenta.
  const BANDS: Record<(typeof HUES)[number], [number, number]> = {
    red: [10, 45],
    yellow: [65, 100],
    green: [135, 165],
    cyan: [180, 215],
    blue: [235, 270],
    magenta: [305, 355],
  };

  it("keeps each of the six hues, normal and bright, in its own band", () => {
    for (const palette of PALETTE_NAMES) {
      const t = terminalThemeFor(palette);
      for (const name of HUES) {
        for (const key of [name, bright(name)]) {
          const { h, c } = oklch(t[key]);
          expect(h, `${palette} ${key} hue`).toBeGreaterThanOrEqual(BANDS[name][0]);
          expect(h, `${palette} ${key} hue`).toBeLessThanOrEqual(BANDS[name][1]);
          expect(c, `${palette} ${key} is a color, not a grey`).toBeGreaterThanOrEqual(0.06);
        }
      }
    }
  });

  it("gives red, green and yellow, normal and bright, the hue of the palette's danger, ok and wait (within 10°)", () => {
    const selectors: Record<ThemeChoice, string> = {
      calm: ':root[data-palette="calm"]',
      electric: ':root[data-palette="electric"]',
      expressive: ':root, :root[data-palette="expressive"]',
    };
    const STATUS = { red: "--dp-danger", green: "--dp-ok", yellow: "--dp-wait" } as const;
    for (const palette of PALETTE_NAMES) {
      const t = terminalThemeFor(palette);
      const block = cssBlock(tokens, selectors[palette]);
      for (const [name, token] of Object.entries(STATUS) as [keyof typeof STATUS, string][]) {
        for (const key of [name, bright(name)]) {
          const gap = Math.abs(oklch(t[key]).h - oklch(block[token]).h);
          expect(Math.min(gap, 360 - gap), `${palette} ${key} against ${token}`).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  it("keeps the six hues apart from one another, in normal and in bright", () => {
    for (const palette of PALETTE_NAMES) {
      const t = terminalThemeFor(palette);
      for (const set of [HUES.map((name) => t[name]), HUES.map((name) => t[bright(name)])]) {
        for (let i = 0; i < set.length; i++) {
          for (let j = i + 1; j < set.length; j++) {
            expect(oklabDistance(set[i], set[j]), `${palette} ${set[i]} / ${set[j]}`).toBeGreaterThanOrEqual(0.07);
          }
        }
      }
    }
  });

  it("makes every bright variant lighter than its normal one (bold text is drawn in it)", () => {
    for (const palette of PALETTE_NAMES) {
      const t = terminalThemeFor(palette);
      for (const name of ["black", ...HUES, "white"] as const) {
        expect(luminance(t[bright(name)]), `${palette} ${name}`).toBeGreaterThan(luminance(t[name]));
      }
    }
  });

  it("tunes each palette's colors its own way: no color is shared by two palettes but the off-white", () => {
    for (const name of ANSI.filter((name) => name !== "brightWhite")) {
      const values = PALETTE_NAMES.map((palette) => terminalThemeFor(palette)[name]);
      expect(new Set(values).size, name).toBe(3);
    }
  });

  it("draws the scrollbar in the light color at the alphas of the app's own scrollbars", () => {
    for (const palette of PALETTE_NAMES) {
      const t = terminalThemeFor(palette);
      expect([t.scrollbarSliderBackground, t.scrollbarSliderHoverBackground, t.scrollbarSliderActiveBackground], palette).toEqual(
        ["47", "70", "8C"].map((alpha) => `${t.foreground}${alpha}`),
      );
    }
  });
});

describe("terminals follow the palette chosen in Settings", () => {
  function fakeTerminal() {
    return { options: { theme: terminalThemeFor("expressive") as ITheme } };
  }

  it("gives every existing terminal the new palette's whole theme when the palette changes", () => {
    const store = createStore<{ choice: ThemeChoice }>()(() => ({ choice: "expressive" }));
    const terminals = [fakeTerminal(), fakeTerminal()];
    const stop = followPalette(store, () => terminals);
    store.setState({ choice: "calm" });
    for (const term of terminals) {
      expect(term.options.theme).toEqual(terminalThemeFor("calm"));
      expect(term.options.theme?.red).toBe(TERMINAL_THEMES.calm.red);
    }
    expect(terminals[0].options.theme, "each terminal has its own copy").not.toBe(terminals[1].options.theme);
    stop();
  });

  it("leaves terminals alone when the palette does not change", () => {
    const store = createStore<{ choice: ThemeChoice; transparency: boolean }>()(() => ({ choice: "calm", transparency: true }));
    const term = fakeTerminal();
    const stop = followPalette(store, () => [term]);
    store.setState({ transparency: false });
    expect(term.options.theme).toEqual(terminalThemeFor("expressive"));
    stop();
  });

  it("stops updating once unsubscribed, and never holds the terminals it is given", () => {
    const store = createStore<{ choice: ThemeChoice }>()(() => ({ choice: "expressive" }));
    const term = fakeTerminal();
    const stop = followPalette(store, () => [term]);
    stop();
    store.setState({ choice: "electric" });
    expect(term.options.theme).toEqual(terminalThemeFor("expressive"));
  });

  it("hands out copies: changing one leaves the palette's theme as it was", () => {
    const theme = terminalThemeFor("calm");
    theme.red = "#000000";
    expect(terminalThemeFor("calm").red).toBe(TERMINAL_THEMES.calm.red);
  });
});
