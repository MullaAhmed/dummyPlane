import { readOpenUI } from "./parse";

/**
 * Generated output as Markdown text: what "Copy as text" puts on the
 * clipboard and what read_node gives an agent. Text that is not OpenUI Lang
 * is returned as it is.
 */

type Element = { type: "element"; typeName: string; props: Record<string, unknown> };

const isElement = (value: unknown): value is Element => typeof value === "object" && value !== null && (value as { type?: unknown }).type === "element";
const str = (value: unknown) => (value == null ? "" : typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** A table cell on one line: a component in it (a Badge) as its words. */
const cell = (value: unknown) => (isElement(value) ? toText(value) : str(value)).replace(/\|/g, "\\|").replace(/\n/g, " ");

function table(columns: unknown[], rows: unknown[][]): string {
  const width = Math.max(columns.length, ...rows.map((row) => row.length), 0);
  if (width === 0) return "";
  const line = (cells: unknown[]) => `| ${Array.from({ length: width }, (_, i) => cell(cells[i])).join(" | ")} |`;
  return [line(columns), `|${" --- |".repeat(width)}`, ...rows.map(line)].join("\n");
}

function blocks(values: unknown): string {
  return list(values).map(toText).filter(Boolean).join("\n\n");
}

function toText(value: unknown): string {
  if (!isElement(value)) return str(value);
  const p = value.props;
  switch (value.typeName) {
    case "Stack":
    case "Row":
      return blocks(p.children);
    case "Card":
      return [str(p.title) && `### ${str(p.title)}`, blocks(p.children)].filter(Boolean).join("\n\n");
    case "Tabs":
      return blocks(p.tabs);
    case "Tab":
      return [`### ${str(p.label)}${str(p.count) ? ` (${str(p.count)})` : ""}`, blocks(p.children)].join("\n\n");
    case "Heading":
      return `${"#".repeat(p.level === 2 || p.level === 3 ? p.level : 1)} ${str(p.text)}`;
    case "Text":
    case "Markdown":
      return str(p.text);
    case "List":
      return list(p.items).map((item, i) => `${p.ordered === true ? `${i + 1}.` : "-"} ${str(item)}`).join("\n");
    case "Table":
      return table(list(p.columns), list(p.rows).map(list));
    case "KeyValue":
      return list(p.items).map((item) => `- ${str((item as Record<string, unknown>)?.label)}: ${str((item as Record<string, unknown>)?.value)}`).join("\n");
    case "Stat":
      return `${str(p.label)}: ${str(p.value)}${str(p.delta) ? ` (${str(p.delta)})` : ""}`;
    case "Badge":
      return `[${str(p.text)}]`;
    case "Breakdown": {
      const parts = list(p.items).map((item) => (typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}));
      const total = parts.reduce((sum, part) => sum + (typeof part.value === "number" && part.value > 0 ? part.value : 0), 0);
      const share = (value: unknown) => (total > 0 && typeof value === "number" && value > 0 ? ` (${Math.round((value / total) * 100)}%)` : "");
      return [str(p.title), parts.map((part) => `- ${str(part.label)}: ${str(part.value)}${share(part.value)}`).join("\n")].filter(Boolean).join("\n\n");
    }
    case "Callout":
      return `> ${str(p.title) ? `**${str(p.title)}** ` : ""}${str(p.text)}`;
    case "Code": {
      // A fence longer than any run of backticks in the code, as CommonMark reads one: the code's own ``` never closes it.
      const code = str(p.code);
      const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      return `${fence}${str(p.language)}\n${code}\n${fence}`;
    }
    case "Progress": {
      const max = typeof p.max === "number" && p.max > 0 ? p.max : 100;
      // As the bar draws it (`P.Progress`): a value that is no finite number (1e999 reads as Infinity) is 0%.
      const value = typeof p.value === "number" && Number.isFinite(p.value) ? Math.min(Math.max(p.value, 0), max) : 0;
      const percent = Math.round((value / max) * 100);
      return `${str(p.label) || "Progress"}: ${percent}%`;
    }
    case "Link":
      return `[${str(p.label) || str(p.url)}](${str(p.url)})`;
    case "Divider":
      return "---";
    case "BarChart": {
      const values = list(p.values);
      return [str(p.title), table(["", "Value"], list(p.labels).map((label, i) => [label, values[i]]))].filter(Boolean).join("\n\n");
    }
    case "LineChart": {
      const series = list(p.series).map((s) => s as Record<string, unknown>);
      const rows = list(p.labels).map((label, i) => [label, ...series.map((s) => list(s?.values)[i])]);
      return [str(p.title), table(["", ...series.map((s) => s?.name)], rows)].filter(Boolean).join("\n\n");
    }
    case "Button":
      return "";
    default:
      return blocks(Object.values(p).filter((v) => Array.isArray(v)).flat());
  }
}

/** `text` as Markdown: an OpenUI Lang program walked component by component, anything else as written. */
export function generatedAsText(text: string): string {
  const parsed = readOpenUI(text);
  return parsed?.root ? toText(parsed.root) : text;
}
