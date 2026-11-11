/**
 * Whether generated text is meant as OpenUI Lang, without loading OpenUI: a
 * line starts with `root =`, the entry point every program defines. Text
 * that passes is parsed (`./parse.ts`, loaded on demand); any other text is
 * Markdown and never costs the parser.
 */
export const ROOT_LINE = /^\s*root\s*=/m;

export const looksLikeOpenUI = (text: string) => ROOT_LINE.test(text);

/**
 * A text an agent handed to a tool, split for where it goes: `text` for the
 * places that take a line or plain words (a line typed into a terminal, a card,
 * a hint, the fleet's tools), `ui` the OpenUI Lang program itself, for those that
 * draw it (`GeneratedText`). Markdown and plain text pass as they are, no `ui`.
 */
export async function splitGenerated(raw: string): Promise<{ text: string; ui?: string }> {
  if (!looksLikeOpenUI(raw)) return { text: raw };
  const { generatedAsText } = await import("./plainText");
  const text = generatedAsText(raw).trim();
  return text && text !== raw.trim() ? { text, ui: raw } : { text: raw };
}

/**
 * The library's components by name, as `./library.tsx` defines them: what the
 * show_output tool's description lists, kept here so listing the tools does
 * not load OpenUI (library.test.tsx checks both agree).
 */
export const COMPONENT_NAMES = [
  "Stack",
  "Row",
  "Card",
  "Heading",
  "Text",
  "Markdown",
  "List",
  "Table",
  "KeyValue",
  "Stat",
  "Badge",
  "Callout",
  "Code",
  "Progress",
  "Link",
  "Divider",
  "BarChart",
  "LineChart",
  "Button",
] as const;
