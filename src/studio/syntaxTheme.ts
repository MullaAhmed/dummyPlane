/**
 * The code editor's syntax colors, one set per palette, so code reads on the
 * panel it sits on (the Code Studio, the notes' editor: `--dp-surface`), which
 * One Dark and CodeMirror's default style ignored (electric's comments fell to
 * 2.5:1).
 *
 * - The six hues are the terminals' (terminalTheme.ts), each kept at its OKLCH
 *   hue and stepped in lightness until it reads at 4.5:1 at least on the
 *   surface, on the active line (`--dp-hover` over it) and on the accent's tint
 *   (`--dp-accent-soft` over it: a search match, the line reached, a selection
 *   off the caret line): darker on calm's cream, lighter on electric's blue,
 *   expressive's as its terminals draw them, nudged where the tint asked for
 *   it. Where the gamut runs out, the chroma gives way, not the hue. On the
 *   caret's line inside a selection, where the hover stacks on the tint, they
 *   read about 4.1:1 (3.8 for expressive's blue): reaching 4.5 there would wash
 *   electric's red and blue out to near white.
 * - The rest is the palette's own ink: the text, operators and punctuation a
 *   step back (`--dp-text-2`), comments in `--dp-text-3` (italic), what is
 *   invalid in `--dp-danger`. Those follow a palette switch through the CSS.
 *
 * syntaxTheme.test.ts recomputes every ratio from tokens.css.
 */
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { ThemeChoice } from "@/app/theme";

export type SyntaxHue = "red" | "green" | "yellow" | "blue" | "magenta" | "cyan";

export const SYNTAX_HUES: Record<ThemeChoice, Record<SyntaxHue, string>> = {
  calm: { red: "#994735", green: "#326B2D", yellow: "#7E5904", blue: "#316390", magenta: "#864D6E", cyan: "#046B66" },
  electric: { red: "#FFC0C1", green: "#67E899", yellow: "#F4CC3F", blue: "#ABD4FF", magenta: "#ECC0FF", cyan: "#56E2F1" },
  expressive: { red: "#ED7874", green: "#5DAB6F", yellow: "#D1A057", blue: "#6B9DE5", magenta: "#C784C5", cyan: "#38AAB4" },
};

/** What each kind of token is drawn in: a hue of the palette, or one of its text roles. */
function specs(hue: Record<SyntaxHue, string>) {
  return [
    // Code.
    { tag: t.keyword, color: hue.magenta },
    { tag: [t.literal, t.number, t.bool, t.atom, t.null, t.unit, t.color, t.constant(t.name), t.special(t.variableName), t.changed], color: hue.yellow },
    { tag: [t.string, t.inserted], color: hue.green },
    { tag: [t.regexp, t.escape, t.special(t.string)], color: hue.red },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName, t.macroName], color: hue.blue },
    { tag: [t.typeName, t.className, t.namespace, t.url], color: hue.cyan },
    { tag: [t.operator, t.punctuation], color: "var(--dp-text-2)" },
    { tag: t.comment, color: "var(--dp-text-3)", fontStyle: "italic" },
    { tag: [t.meta, t.contentSeparator], color: "var(--dp-text-3)" },
    { tag: [t.invalid, t.deleted], color: "var(--dp-danger)" },
    // Prose (Markdown): the notes are edited here too.
    { tag: t.heading, fontWeight: "600" },
    { tag: t.strong, fontWeight: "600" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.link, color: hue.blue, textDecoration: "underline" },
    { tag: t.quote, color: "var(--dp-text-2)" },
  ];
}

const STYLES: Record<ThemeChoice, HighlightStyle> = {
  calm: HighlightStyle.define(specs(SYNTAX_HUES.calm)),
  electric: HighlightStyle.define(specs(SYNTAX_HUES.electric)),
  expressive: HighlightStyle.define(specs(SYNTAX_HUES.expressive)),
};

/** The palette's highlight style: made once, so a palette switch swaps one for another. */
export function syntaxStyleFor(palette: ThemeChoice): HighlightStyle {
  return STYLES[palette];
}
