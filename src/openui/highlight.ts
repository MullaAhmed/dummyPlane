import type { CSSProperties } from "react";
import { highlightCode, tagHighlighter } from "@lezer/highlight";
import type { LanguageSupport } from "@codemirror/language";
import type { ThemeChoice } from "@/app/theme";
import { languageFor } from "@/studio/languages";
import { syntaxSpecs } from "@/studio/syntaxTheme";

/**
 * Static highlighting for a Code block of generated output: the Code Studio's
 * parsers and its palette's colours (`@/studio/syntaxTheme`), without an
 * editor. Loaded on demand (`import("./highlight")`): CodeMirror stays out of
 * the canvas's bundle until some output shows code.
 */

export interface Token {
  text: string;
  style?: CSSProperties;
}

/** A fence's language name as the Code Studio knows it, by the extension it would have. */
const EXTENSION: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  rust: "rs",
  markdown: "md",
  jsonc: "json",
  xml: "html",
};

function supportFor(language: string): LanguageSupport | null {
  const name = language.trim().toLowerCase();
  const extension = EXTENSION[name] ?? name;
  if (!/^[a-z0-9]+$/.test(extension)) return null;
  const support = languageFor(`code.${extension}`);
  return Array.isArray(support) ? null : (support as LanguageSupport);
}

/** The code's lines as styled tokens; null for a language the Code Studio does not highlight. */
export function highlight(code: string, language: string, palette: ThemeChoice): Token[][] | null {
  const support = supportFor(language);
  if (!support) return null;
  const specs = syntaxSpecs(palette);
  const highlighter = tagHighlighter(specs.map((spec, i) => ({ tag: spec.tag, class: `s${i}` })));
  const styleOf = (classes: string): CSSProperties =>
    Object.assign(
      {},
      ...classes.split(" ").map((name) => {
        const { color, fontStyle, fontWeight, textDecoration } = specs[Number(name.slice(1))] as { color?: string; fontStyle?: string; fontWeight?: string; textDecoration?: string };
        return { color, fontStyle, fontWeight, textDecoration };
      }),
    );
  const lines: Token[][] = [[]];
  highlightCode(
    code,
    support.language.parser.parse(code),
    highlighter,
    (text, classes) => lines[lines.length - 1].push(classes ? { text, style: styleOf(classes) } : { text }),
    () => lines.push([]),
  );
  return lines;
}
