import type { ThemeChoice } from "@/app/theme";

/**
 * The six syntax hues of each palette (what they are and how they were chosen:
 * `./syntaxTheme.ts`). Apart from the editor's highlight styles, so code shown
 * outside the Code Studio (an agent's output, its charts) takes them without
 * loading CodeMirror.
 */
export type SyntaxHue = "red" | "green" | "yellow" | "blue" | "magenta" | "cyan";

export const SYNTAX_HUES: Record<ThemeChoice, Record<SyntaxHue, string>> = {
  calm: { red: "#994735", green: "#326B2D", yellow: "#7E5904", blue: "#316390", magenta: "#864D6E", cyan: "#046B66" },
  electric: { red: "#FFC0C1", green: "#67E899", yellow: "#F4CC3F", blue: "#ABD4FF", magenta: "#ECC0FF", cyan: "#56E2F1" },
  expressive: { red: "#ED7874", green: "#5DAB6F", yellow: "#D1A057", blue: "#6B9DE5", magenta: "#C784C5", cyan: "#38AAB4" },
};
