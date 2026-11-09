/**
 * xterm's colors (spec identité §3): terminals stay dark in every palette, on the
 * node body's `--dp-terminal` (the palette's deepest color), with the palette's
 * accent as cursor.
 */
import type { ThemeChoice } from "@/app/theme";

export interface TerminalColors {
  background: string;
  cursor: string;
  selectionBackground: string;
}

const TERMINAL_COLORS: Record<ThemeChoice, TerminalColors> = {
  calm: { background: "#0F2921", cursor: "#F52B94", selectionBackground: "#F52B9455" },
  electric: { background: "#0D1556", cursor: "#B6F52B", selectionBackground: "#B6F52B55" },
  expressive: { background: "#0B0B0E", cursor: "#FF781B", selectionBackground: "#FF781B55" },
};

export function terminalThemeFor(palette: ThemeChoice): TerminalColors {
  return { ...TERMINAL_COLORS[palette] };
}

export { TERMINAL_COLORS };
