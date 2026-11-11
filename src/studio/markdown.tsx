import type { ReactNode } from "react";
import { messages } from "@/i18n";
import { studioMessages } from "./messages";

/** The file's extension, lower case, without the dot; "" when it has none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export const isMarkdown = (path: string) => ["md", "markdown", "mdx"].includes(extensionOf(path));

/**
 * Small, safe Markdown renderer producing React elements.
 * Never uses innerHTML: raw HTML in the source is shown as literal text.
 */

const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const INLINE =
  /`([^`]+)`|!\[([^\]]*)\]\(([^)\s]*)\)|\[([^\]]+)\]\(([^)\s]*)\)|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|\b_([^_\s][^_]*?)_\b/g;

/** A link in running text: the accent's ink, underlined, with the shared focus ring. */
export const LINK_CLASS =
  "rounded-sm text-dp-accent-ink underline underline-offset-2 transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none hover:bg-dp-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/70";

/** Hierarchy from size, then from ink, at one weight. */
const HEADING_CLASSES = [
  "text-lg font-medium",
  "text-base font-medium",
  "text-sm font-medium",
  "text-sm font-medium",
  "text-sm font-medium text-dp-text-2",
  "text-sm font-medium text-dp-text-2",
];

/** Returns the href if it is http(s), mailto or relative; otherwise null. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  // Strip whitespace and control chars so "java\tscript:" cannot sneak through.
  const compact = href.replace(/[\u0000- ]/g, "").toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(compact);
  if (!scheme) return href;
  return ["http", "https", "mailto"].includes(scheme[1]) ? href : null;
}

/**
 * How a caller draws a link instead of a plain `<a>`: generated text opens its
 * links through the opener, http(s) only (`@/openui/actions`). Null draws the
 * label as plain text.
 */
export type LinkRenderer = (href: string, label: ReactNode[], key: number) => ReactNode | null;

export interface MarkdownOptions {
  link?: LinkRenderer;
}

/** Renders inline formatting: code, bold, italic, links, images (as text). */
export function renderInline(text: string, options: MarkdownOptions = {}): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    last = start + m[0].length;
    const k = key++;
    if (m[1] !== undefined) {
      out.push(
        <code key={k} className="rounded-sm bg-dp-field px-1 font-mono text-[0.9em]">
          {m[1]}
        </code>,
      );
    } else if (m[2] !== undefined) {
      out.push(<span key={k} className="text-dp-text-3">[{m[2] || messages(studioMessages).markdownImage}]</span>);
    } else if (m[4] !== undefined) {
      const href = safeHref(m[5]);
      const label = renderInline(m[4], options);
      const custom = href !== null && options.link ? options.link(href, label, k) : undefined;
      if (custom !== undefined) out.push(custom ?? <span key={k}>{label}</span>);
      else if (href === null) out.push(<span key={k}>{label}</span>);
      else
        out.push(
          <a key={k} href={href} target="_blank" rel="noreferrer noopener" className={LINK_CLASS}>
            {label}
          </a>,
        );
    } else if (m[6] !== undefined || m[7] !== undefined) {
      out.push(<strong key={k}>{renderInline(m[6] ?? m[7], options)}</strong>);
    } else {
      out.push(<em key={k}>{renderInline(m[8] ?? m[9], options)}</em>);
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Splits a table row into trimmed cells, ignoring outer pipes. */
function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** True when a line starts a non-paragraph block. */
function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) ||
    UL.test(line) || OL.test(line) || (line.includes("|") && next !== undefined && TABLE_SEP.test(next))
  );
}

/** Renders a Markdown string as React nodes; `options.link` draws its links. */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): ReactNode {
  const inline = (text: string) => renderInline(text, options);
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = blocks.length;
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      i++;
    } else if ((m = FENCE.exec(line))) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key} className="overflow-x-auto rounded-md border border-dp-line bg-dp-field p-2">
          <code className="font-mono text-xs" data-lang={m[1] || undefined}>
            {code.join("\n")}
          </code>
        </pre>,
      );
    } else if ((m = HEADING.exec(line))) {
      const level = m[1].length;
      const Tag = `h${level}` as "h1";
      blocks.push(<Tag key={key} className={`text-dp-text ${HEADING_CLASSES[level - 1]}`}>{inline(m[2])}</Tag>);
      i++;
    } else if (HR.test(line)) {
      blocks.push(<hr key={key} className="border-dp-line" />);
      i++;
    } else if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && (m = QUOTE.exec(lines[i]))) {
        inner.push(m[1]);
        i++;
      }
      blocks.push(
        <blockquote key={key} className="border-l-2 border-dp-line pl-3 text-dp-text-2">
          {renderMarkdown(inner.join("\n"), options)}
        </blockquote>,
      );
    } else if (UL.test(line) || OL.test(line)) {
      const ordered = OL.test(line);
      const re = ordered ? OL : UL;
      const items: string[] = [];
      while (i < lines.length && (m = re.exec(lines[i]))) {
        items.push(m[1]);
        i++;
      }
      const children = items.map((item, n) => <li key={n}>{inline(item)}</li>);
      blocks.push(
        ordered ? (
          <ol key={key} className="list-decimal pl-5">{children}</ol>
        ) : (
          <ul key={key} className="list-disc pl-5">{children}</ul>
        ),
      );
    } else if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      blocks.push(
        <table key={key} className="border-collapse text-sm">
          <thead>
            <tr>{head.map((c, n) => <th key={n} className="border border-dp-line px-2 py-1 text-left">{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>{row.map((c, n) => <td key={n} className="border border-dp-line px-2 py-1">{inline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
    } else {
      const para: string[] = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++]);
      blocks.push(<p key={key}>{inline(para.join(" "))}</p>);
    }
  }
  return <div className="flex flex-col gap-2 text-sm text-dp-text">{blocks}</div>;
}
