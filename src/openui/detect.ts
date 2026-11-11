/**
 * Whether generated text is meant as OpenUI Lang, without loading OpenUI: its
 * first line (blank ones aside) is `root = …`, the entry point every program
 * starts with. Only the first: Markdown that shows a program further down, in
 * a fence, stays Markdown (the parser skips what is not a statement, and the
 * prose around it would vanish). Text that passes is parsed (`./parse.ts`,
 * loaded on demand); any other text is Markdown and never costs the parser.
 */
export const ROOT_LINE = /^\s*root\s*=/;

export const looksLikeOpenUI = (text: string) => ROOT_LINE.test(text);

/**
 * A text an agent handed to a tool, split for where it goes: `text` for the
 * places that take a line or plain words (a line typed into a terminal, a card,
 * a hint, the fleet's tools), `ui` the OpenUI Lang program itself, for those that
 * draw it (`GeneratedText`). Markdown and plain text pass as they are, no `ui`.
 * A program with errors is refused (`errors`), before anything is done with it:
 * its text would hold only the part that parsed, and nobody would know.
 */
export async function splitGenerated(raw: string): Promise<{ text: string; ui?: string; errors?: string[] }> {
  if (!looksLikeOpenUI(raw)) return { text: raw };
  const [{ checkOpenUI }, { generatedAsText }] = await Promise.all([import("./parse"), import("./plainText")]);
  const { errors } = checkOpenUI(raw);
  if (errors.length) return { text: raw, errors };
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
