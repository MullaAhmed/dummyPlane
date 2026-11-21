import { createParser, type ParseResult } from "@openuidev/react-lang";
import { ROOT_LINE } from "./detect";
import { outputLibrary } from "./library";

/**
 * Reading generated text: OpenUI Lang or not, and what is wrong with it.
 * The text is OpenUI Lang only when its first line is `root = …`, the entry
 * point every program starts with (`./detect.ts`), and it parses to a root:
 * any other text (a summary, Markdown, Markdown showing a program in a fence)
 * is Markdown.
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

/** What the check knows beyond the program: the output's title, which its header shows. */
export interface CheckContext {
  title?: string;
}

/** Whether `text` can be shown as an output, and if not, why, in plain words (show_output's answer). */
export function checkOpenUI(text: string, context: CheckContext = {}): OpenUICheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!text.trim()) return { errors: ["The ui is empty: write an OpenUI Lang program, starting with root = Stack([...])."], warnings };
  if (text.length > MAX_OUTPUT_CHARS) return { errors: [`The ui is ${text.length} characters long; the most is ${MAX_OUTPUT_CHARS}. Show less, or split it into several outputs.`], warnings };
  if (!ROOT_LINE.test(text)) return { errors: ["The first line must be the root statement: root = Stack([...]) (or another component), then the others."], warnings };
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
  if (errors.length === 0) warnings.push(...readability(result.root, context));
  return { errors, warnings };
}

/**
 * Past these, an output reads like the terminal it should beat, or breaks the
 * design rules (`./skill/SKILL.md`): show_output says so, and shows it anyway.
 */
export const LONG_TEXT = 320;
export const LONG_ITEM = 140;
export const MANY_ITEMS = 8;
export const MANY_CARDS = 3;
/** One verdict stands out; past two, none does. */
export const MANY_CALLOUTS = 2;
/** A strip of figures holds four across an output. */
export const MANY_STATS = 4;
/** One or two bars are figures, not a chart. */
export const FEW_BARS = 3;
/** Past six parts, a split bar's slivers cannot be told apart. */
export const MANY_PARTS = 6;
/** Past four lines, a chart is a tangle. */
export const MANY_SERIES = 4;
/** Past five columns, a Table crowds a 560-pixel output and may scroll sideways. */
export const MANY_COLUMNS = 5;
const MAX_READABILITY_WARNINGS = 5;

type Element = { type: "element"; typeName: string; props: Record<string, unknown> };
const isElement = (value: unknown): value is Element => typeof value === "object" && value !== null && (value as { type?: unknown }).type === "element";

/** The first words of a text, to name it in a warning. */
const opening = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
};

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
const plain = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * What will read badly in an output that parses: long prose, lists of
 * sentences, a column of open Cards, a Card in a Card, the title said twice,
 * too many Callouts, a strip of too many figures, a chart of one bar or of too
 * many parts or lines, a Table wider than the output.
 */
function readability(root: unknown, context: CheckContext): string[] {
  const warnings: string[] = [];
  let callouts = 0;
  let headings = 0;
  const title = plain(context.title ?? "");
  const visit = (node: unknown, inCard = false): void => {
    if (Array.isArray(node)) return node.forEach((child) => visit(child, inCard));
    if (!isElement(node)) return;
    const p = node.props;
    const text = typeof p.text === "string" ? p.text : "";
    const name = typeof p.title === "string" ? p.title : "";
    if (node.typeName === "Callout") callouts++;
    if (node.typeName === "Heading" && headings++ === 0 && title && plain(text) === title)
      warnings.push(`The Heading "${opening(text)}" repeats the output's title, which its header already shows: remove it.`);
    if (node.typeName === "Card" && inCard) warnings.push(`The Card "${opening(name)}" sits inside another Card: lay its content out in the outer one, or make the two Tabs.`);
    if (node.typeName === "Row" && Array.isArray(p.children)) {
      const stats = p.children.filter((child) => isElement(child) && child.typeName === "Stat").length;
      if (stats > MANY_STATS) warnings.push(`A Row of ${stats} Stats: keep two to four headline figures; put the rest in a Table, or a Breakdown when they add up to a whole.`);
    }
    if (node.typeName === "BarChart" && count(p.values) > 0 && count(p.values) < FEW_BARS)
      warnings.push(`The BarChart${name ? ` "${opening(name)}"` : ""} has ${count(p.values)} bar${count(p.values) === 1 ? "" : "s"}: show ${count(p.values) === 1 ? "it as a Stat" : "them as Stats in a Row"}, or a Progress for a share of a limit.`);
    if (node.typeName === "Breakdown" && count(p.items) > MANY_PARTS)
      warnings.push(`The Breakdown${name ? ` "${opening(name)}"` : ""} has ${count(p.items)} parts: fold the smallest into "Other", or compare them in a BarChart.`);
    if (node.typeName === "LineChart" && count(p.series) > MANY_SERIES)
      warnings.push(`The LineChart${name ? ` "${opening(name)}"` : ""} has ${count(p.series)} lines: keep the four that matter, or split them into two charts.`);
    if (node.typeName === "Table" && count(p.columns) > MANY_COLUMNS)
      warnings.push(`A Table of ${count(p.columns)} columns crowds the output and may scroll sideways: keep five, and fold the rest into a collapsed Card or a Tab.`);
    if ((node.typeName === "Text" || node.typeName === "Markdown") && text.length > LONG_TEXT)
      warnings.push(
        `The ${node.typeName} "${opening(text)}" runs ${text.length} characters: an output is looked at, not read. Cut it to a sentence or two, or fold it in a Card with collapsed true.`,
      );
    if (node.typeName === "List" && Array.isArray(p.items)) {
      const long = p.items.filter((item) => typeof item === "string" && item.length > LONG_ITEM).length;
      if (p.items.length > MANY_ITEMS || long)
        warnings.push(
          `The List "${opening(String(p.items[0] ?? ""))}" has ${p.items.length} items${long ? `, ${long} over ${LONG_ITEM} characters` : ""}: make it a Table, one row per item, its status a Badge cell.`,
        );
    }
    if (node.typeName === "Stack" && Array.isArray(p.children)) {
      const open = p.children.filter((child) => isElement(child) && child.typeName === "Card" && child.props.collapsed !== true).length;
      if (open > MANY_CARDS) warnings.push(`${open} open Cards one under another: put them in Tabs, one Tab each with its count, or fold the details with collapsed true.`);
    }
    for (const value of Object.values(p)) if (typeof value === "object" && value !== null) visit(value, inCard || node.typeName === "Card");
  };
  visit(root);
  if (callouts > MANY_CALLOUTS) warnings.push(`${callouts} Callouts: when everything stands out, nothing does. Keep one verdict, two at most; make the rest Badges in a Table.`);
  return warnings.slice(0, MAX_READABILITY_WARNINGS);
}
