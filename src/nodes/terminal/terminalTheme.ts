/**
 * xterm's colors (spec identité §3): terminals stay dark in every palette, on the
 * node body's `--dp-terminal` (the palette's deepest color), with the palette's
 * light color as cursor: the off-white ink of the dark palettes, calm's cream
 * canvas (its green ink would not show on the green body).
 */
import type { ITheme } from "@xterm/xterm";
import type { StoreApi } from "zustand";
import type { ThemeChoice } from "@/app/theme";

export interface TerminalColors {
  background: string;
  cursor: string;
  selectionBackground: string;
}

const TERMINAL_COLORS: Record<ThemeChoice, TerminalColors> = {
  calm: { background: "#0F2921", cursor: "#EDE3CC", selectionBackground: "#EDE3CC55" },
  electric: { background: "#0D1556", cursor: "#F4F4F1", selectionBackground: "#F4F4F155" },
  expressive: { background: "#0B0B0E", cursor: "#F4F4F1", selectionBackground: "#F4F4F155" },
};

export function terminalThemeFor(palette: ThemeChoice): TerminalColors {
  return { ...TERMINAL_COLORS[palette] };
}

/**
 * Every terminal follows the palette: when the choice changes, each terminal
 * `terminals()` lists gets the new colors at once (xterm applies option changes
 * live). Returns the unsubscribe function.
 */
export function followPalette<S extends { choice: ThemeChoice }>(
  store: StoreApi<S>,
  terminals: () => Iterable<{ options: { theme?: ITheme } }>,
): () => void {
  return store.subscribe((state, previous) => {
    if (state.choice === previous.choice) return;
    const colors = terminalThemeFor(state.choice);
    for (const term of terminals()) term.options.theme = { ...colors };
  });
}

export { TERMINAL_COLORS };
