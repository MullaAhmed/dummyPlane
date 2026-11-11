import { createParser, type ParseResult } from "@openuidev/react-lang";
import { ROOT_LINE } from "./detect";
import { outputLibrary } from "./library";

/**
 * Reading generated text: OpenUI Lang or not, and what is wrong with it.
 * The text is OpenUI Lang only when a line starts with `root =`, the entry
 * point every program defines, and it parses to a root: any other text (a
 * summary, Markdown, a paragraph that happens to hold `a = b`) is Markdown.
 */

let parser: ReturnType<typeof createParser> | null = null;
const parse = (text: string): ParseResult => {
  parser ??= createParser(outputLibrary.toJSONSchema(), outputLibrary.root);
  return parser.parse(text);
};

/** The parse of `text` when it is OpenUI Lang with a root; null for anything else. */
export function readOpenUI(text: string): ParseResult | null {
  if (!ROOT_LINE.test(text)) return null;
  try {
    const result = parse(text);
    return result.root ? result : null;
  } catch {
    return null;
  }
}

/** The most an output may hold, its source: past it, a node and the saved scene would carry too much. */
export const MAX_OUTPUT_CHARS = 200_000;

export interface OpenUICheck {
  /** What prevents showing it, each in a line an agent can act on; empty when it can be shown. */
  errors: string[];
  /** What shows, but not as the agent may think. */
  warnings: string[];
}

/** Whether `text` can be shown as an output, and if not, why, in plain words (show_output's answer). */
export function checkOpenUI(text: string): OpenUICheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!text.trim()) return { errors: ["The ui is empty: write an OpenUI Lang program, starting with root = Stack([...])."], warnings };
  if (text.length > MAX_OUTPUT_CHARS) return { errors: [`The ui is ${text.length} characters long; the most is ${MAX_OUTPUT_CHARS}. Show less, or split it into several outputs.`], warnings };
  if (!ROOT_LINE.test(text)) return { errors: ["No root statement: the first line must be root = Stack([...]) (or another component)."], warnings };
  let result: ParseResult;
  try {
    result = parse(text);
  } catch (error) {
    return { errors: [`The ui could not be read: ${error instanceof Error ? error.message : String(error)}`], warnings };
  }
  if (result.meta.incomplete) errors.push("The program ends in the middle of a statement: a string, bracket or parenthesis is not closed.");
  for (const error of result.meta.errors) {
    const where = error.statementId ? `In ${error.statementId}: ` : "";
    const line = `${where}${error.message}`;
    if ((error as { severity?: string }).severity === "warning") warnings.push(line);
    else errors.push(line);
  }
  if (result.meta.unresolved.length) errors.push(`Used but never defined: ${result.meta.unresolved.join(", ")}.`);
  if (result.queryStatements.length || result.mutationStatements.length) errors.push("Query() and Mutation() are not supported: output is static; write the data itself.");
  if (Object.keys(result.stateDeclarations).length) errors.push("$variables are not supported: output is static.");
  if (!result.root && errors.length === 0) errors.push("Nothing to show: root does not resolve to a component.");
  if (result.meta.orphaned.length) warnings.push(`Defined but not reachable from root, so not shown: ${result.meta.orphaned.join(", ")}.`);
  return { errors, warnings };
}
