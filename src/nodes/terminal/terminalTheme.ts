/**
 * xterm's colors (spec identité §3): terminals stay dark in every palette, on the
 * node body's `--dp-terminal` (the palette's deepest color), and every color
 * xterm draws with is the palette's own, none left to xterm's defaults:
 *
 * - The text, the cursor and the selected text are the palette's light color:
 *   the off-white ink of the dark palettes, calm's cream canvas (its green ink
 *   would not show on the green body). `white` and `brightBlack` (dim text,
 *   hints) are that color a step and two steps toward the terminal's body,
 *   mixed in OKLab, so the dim text of electric is blue and calm's is sage.
 *   `black` is the body a step lighter.
 * - The six hues are tuned per palette in OKLCH: calm's earthy and low in
 *   chroma (terracotta, leaf, wheat, slate, dusty rose, sea glass), electric's
 *   vivid (coral, mint, sun, sky, orchid, aqua), expressive's matched to its
 *   status colors. In each, red, green and yellow sit within 10° of the hue of
 *   the palette's danger, ok and wait. Each reads at 5.4:1 at least on the body,
 *   its bright variant (bold text is drawn in it) lighter still, and no two of
 *   the six are closer than 0.07 in OKLab.
 * - The selection is the light color mixed into the body (30%, 18% when the
 *   terminal is unfocused), opaque, and its text is the light color: xterm draws
 *   a selected cell's text in it, whatever color the program chose.
 * - The scrollbar is the light color at the alphas of the app's own scrollbar
 *   thumbs (index.css): 28%, 44% under the pointer, 55% while dragged.
 *
 * terminalTheme.test.ts recomputes every ratio from these values.
 */
import type { ITheme } from "@xterm/xterm";
import type { StoreApi } from "zustand";
import type { ThemeChoice } from "@/app/theme";

/** Every color xterm draws with, but the overview ruler (off) and the 256-color cube (xterm's, by index). */
export type TerminalTheme = Required<Omit<ITheme, "overviewRulerBorder" | "extendedAnsi">>;

const TERMINAL_THEMES: Record<ThemeChoice, TerminalTheme> = {
  calm: {
    background: "#0F2921",
    foreground: "#EDE3CC",
    cursor: "#EDE3CC",
    cursorAccent: "#0F2921",
    selectionBackground: "#526154",
    selectionInactiveBackground: "#374A40",
    selectionForeground: "#EDE3CC",
    scrollbarSliderBackground: "#EDE3CC47",
    scrollbarSliderHoverBackground: "#EDE3CC70",
    scrollbarSliderActiveBackground: "#EDE3CC8C",
    black: "#223C33",
    red: "#E48A76",
    green: "#75B06F",
    yellow: "#D5AD67",
    blue: "#6B9ECE",
    magenta: "#CE8FB2",
    cyan: "#5BB3AD",
    white: "#BAB9A5",
    brightBlack: "#8E9482",
    brightRed: "#FEAC9A",
    brightGreen: "#94CF8D",
    brightYellow: "#E9C079",
    brightBlue: "#88BCED",
    brightMagenta: "#EFADD1",
    brightCyan: "#7BD3CD",
    brightWhite: "#EDE3CC",
  },
  electric: {
    background: "#0D1556",
    foreground: "#F4F4F1",
    cursor: "#F4F4F1",
    cursorAccent: "#0D1556",
    selectionBackground: "#525884",
    selectionInactiveBackground: "#373D72",
    selectionForeground: "#F4F4F1",
    scrollbarSliderBackground: "#F4F4F147",
    scrollbarSliderHoverBackground: "#F4F4F170",
    scrollbarSliderActiveBackground: "#F4F4F18C",
    black: "#1C2B6C",
    red: "#FC7981",
    green: "#2DB86C",
    yellow: "#D7AF05",
    blue: "#549EE6",
    magenta: "#CE86EB",
    cyan: "#0AB6C5",
    white: "#C0C6D3",
    brightBlack: "#7E8BAB",
    brightRed: "#FF969A",
    brightGreen: "#51D486",
    brightYellow: "#E7BE21",
    brightBlue: "#72B8FE",
    brightMagenta: "#E5A5FE",
    brightCyan: "#42D2E2",
    brightWhite: "#F4F4F1",
  },
  expressive: {
    background: "#0B0B0E",
    foreground: "#F4F4F1",
    cursor: "#F4F4F1",
    cursorAccent: "#0B0B0E",
    selectionBackground: "#515152",
    selectionInactiveBackground: "#353537",
    selectionForeground: "#F4F4F1",
    scrollbarSliderBackground: "#F4F4F147",
    scrollbarSliderHoverBackground: "#F4F4F170",
    scrollbarSliderActiveBackground: "#F4F4F18C",
    black: "#1C1C1F",
    red: "#EA7572",
    green: "#5BA86D",
    yellow: "#D1A057",
    blue: "#6091D8",
    magenta: "#C481C2",
    cyan: "#38AAB4",
    white: "#C5C6C4",
    brightBlack: "#7F7F7F",
    brightRed: "#FE9792",
    brightGreen: "#78C488",
    brightYellow: "#E3B067",
    brightBlue: "#7AACF5",
    brightMagenta: "#E29CDF",
    brightCyan: "#5AC7D1",
    brightWhite: "#F4F4F1",
  },
};

/** A copy: xterm and its callers may keep or change the object they are given. */
export function terminalThemeFor(palette: ThemeChoice): TerminalTheme {
  return { ...TERMINAL_THEMES[palette] };
}

/**
 * Every terminal follows the palette: when the choice changes, each terminal
 * `terminals()` lists gets the new theme at once, all of it (xterm applies
 * option changes live). Returns the unsubscribe function.
 */
export function followPalette<S extends { choice: ThemeChoice }>(
  store: StoreApi<S>,
  terminals: () => Iterable<{ options: { theme?: ITheme } }>,
): () => void {
  return store.subscribe((state, previous) => {
    if (state.choice === previous.choice) return;
    for (const term of terminals()) term.options.theme = terminalThemeFor(state.choice);
  });
}

export { TERMINAL_THEMES };
