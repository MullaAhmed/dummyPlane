import { Fragment, useEffect, useState, type ReactNode } from "react";
import { CircleCheck, Copy, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { usePalette } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { LINK_CLASS, renderInline, renderMarkdown, type MarkdownOptions } from "@/studio/markdown";
import { httpUrl, openLink, useOutputActions } from "./actions";
import type { Token } from "./highlight";
import { openuiMessages } from "./messages";
import { isTone, TONE_BORDER, TONE_RULE, TONE_TEXT, type Tone } from "./tones";

/**
 * What generated output is drawn with: plain React on the palette's tokens.
 * `./library.ts` hands each to OpenUI with its schema; `./GeneratedText.tsx`
 * uses `Markdown` on its own for text that is not OpenUI Lang. No raw HTML
 * anywhere: every string is a text node.
 */

export type RenderNode = (value: unknown) => ReactNode;

/** Markdown's links, through the opener, http(s) only; any other link reads as its label. */
const MARKDOWN: MarkdownOptions = {
  link: (href, label, key) =>
    httpUrl(href) ? (
      <button key={key} type="button" title={href} className={LINK_CLASS} onClick={() => openLink(href)}>
        {label}
      </button>
    ) : null,
};

const inline = (text: unknown) => renderInline(String(text ?? ""), MARKDOWN);

/** A component's children: elements through OpenUI, a bare string or number as a paragraph. */
export function Children(props: { items: unknown; renderNode: RenderNode }) {
  const items = Array.isArray(props.items) ? props.items : props.items == null ? [] : [props.items];
  return items.map((item, i) =>
    typeof item === "string" || typeof item === "number" ? (
      <p key={i} className="text-sm text-dp-text">
        {inline(item)}
      </p>
    ) : (
      <Fragment key={i}>{props.renderNode(item)}</Fragment>
    ),
  );
}

const GAPS = { sm: "gap-2", md: "gap-3", lg: "gap-4" } as const;
type Gap = keyof typeof GAPS;
const gapOf = (gap: unknown) => GAPS[(gap as Gap) in GAPS ? (gap as Gap) : "md"];

export function Stack(props: { children: unknown; gap?: unknown; renderNode: RenderNode }) {
  return <div className={cn("flex min-w-0 flex-col", gapOf(props.gap))}><Children items={props.children} renderNode={props.renderNode} /></div>;
}

/** Side by side, wrapping when the node is narrow: each child takes an equal share, 8rem at least. */
export function Row(props: { children: unknown; gap?: unknown; renderNode: RenderNode }) {
  return (
    <div className={cn("flex min-w-0 flex-wrap *:min-w-32 *:flex-1", gapOf(props.gap))}>
      <Children items={props.children} renderNode={props.renderNode} />
    </div>
  );
}

export function Card(props: { title?: unknown; children: unknown; renderNode: RenderNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-dp-line bg-dp-card p-3">
      {typeof props.title === "string" && props.title && <h3 className="text-sm font-medium text-dp-text">{props.title}</h3>}
      <Children items={props.children} renderNode={props.renderNode} />
    </section>
  );
}

/** Hierarchy from size, at one weight, as the Markdown renderer's headings. */
const HEADINGS = ["text-lg font-medium", "text-base font-medium", "text-sm font-medium"];

export function Heading(props: { text: unknown; level?: unknown }) {
  const level = props.level === 2 || props.level === 3 ? props.level : 1;
  const Tag = `h${level + 1}` as "h2";
  return <Tag className={cn("text-dp-text", HEADINGS[level - 1])}>{inline(props.text)}</Tag>;
}

export function Text(props: { text: unknown; tone?: unknown }) {
  return <p className={cn("text-sm whitespace-pre-line", props.tone === "muted" ? "text-dp-text-2" : "text-dp-text")}>{inline(props.text)}</p>;
}

/** The raw text, as written: what the user can always get back to. */
export function Source({ text }: { text: string }) {
  return <pre className="max-h-96 overflow-auto rounded-md border border-dp-line bg-dp-surface p-2 font-mono text-xs whitespace-pre-wrap break-words text-dp-text select-text">{text}</pre>;
}

/** A panel's small print: the edit panel's last report, a subagent's answer. */
export const COMPACT = "gap-1.5 text-xs";

export function Markdown(props: { text: unknown; className?: string; compact?: boolean }) {
  return (
    <div className={cn("min-w-0 break-words", props.className)}>
      {renderMarkdown(String(props.text ?? ""), props.compact ? { ...MARKDOWN, className: COMPACT } : MARKDOWN)}
    </div>
  );
}

export function List(props: { items: unknown; ordered?: unknown }) {
  const items = Array.isArray(props.items) ? props.items : [];
  const Tag = props.ordered === true ? "ol" : "ul";
  return (
    <Tag className={cn("flex flex-col gap-1 pl-5 text-sm text-dp-text", props.ordered === true ? "list-decimal" : "list-disc")}>
      {items.map((item, i) => (
        <li key={i}>{inline(item)}</li>
      ))}
    </Tag>
  );
}

const isNumeric = (value: unknown) => typeof value === "number";
const cellText = (value: unknown) => (value == null ? "" : typeof value === "number" ? value.toLocaleString("en-US") : String(value));

export function Table(props: { columns: unknown; rows: unknown }) {
  const columns = Array.isArray(props.columns) ? props.columns.map(cellText) : [];
  const rows = Array.isArray(props.rows) ? props.rows.map((row) => (Array.isArray(row) ? row : [row])) : [];
  const width = Math.max(columns.length, ...rows.map((row) => row.length), 0);
  const indexes = Array.from({ length: width }, (_, i) => i);
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {columns.length > 0 && (
          <thead>
            <tr className="border-b border-dp-line">
              {indexes.map((i) => (
                <th key={i} scope="col" className="px-2 py-1.5 text-left text-xs font-medium text-dp-text-2">
                  {columns[i] ?? ""}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-dp-line last:border-b-0">
              {indexes.map((i) => (
                <td key={i} className={cn("px-2 py-1.5 align-top text-dp-text", isNumeric(row[i]) && "text-right tabular-nums")}>
                  {typeof row[i] === "string" ? inline(row[i]) : cellText(row[i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyValue(props: { items: unknown }) {
  const items = (Array.isArray(props.items) ? props.items : []).filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  return (
    <dl className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      {items.map((item, i) => (
        <Fragment key={i}>
          <dt className="truncate text-dp-text-2" title={cellText(item.label)}>{cellText(item.label)}</dt>
          <dd className="min-w-0 break-words text-dp-text">{typeof item.value === "string" ? inline(item.value) : cellText(item.value)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

const toneOf = (tone: unknown, fallback: Tone): Tone => (isTone(tone) ? tone : fallback);

export function Stat(props: { label: unknown; value: unknown; delta?: unknown; tone?: unknown }) {
  const tone = toneOf(props.tone, "neutral");
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-xs text-dp-text-2">{cellText(props.label)}</span>
      <span className="truncate text-lg font-medium tabular-nums text-dp-text">{cellText(props.value)}</span>
      {props.delta != null && props.delta !== "" && <span className={cn("truncate text-xs tabular-nums", TONE_TEXT[tone])}>{cellText(props.delta)}</span>}
    </div>
  );
}

export function Badge(props: { text: unknown; tone?: unknown }) {
  const tone = toneOf(props.tone, "neutral");
  return (
    <span className={cn("inline-flex w-fit max-w-full items-center truncate rounded-sm border px-1.5 text-xs leading-5", TONE_TEXT[tone], TONE_BORDER[tone])}>
      {cellText(props.text)}
    </span>
  );
}

const CALLOUT_ICONS: Record<Tone, typeof Info> = { neutral: Info, info: Info, success: CircleCheck, warning: TriangleAlert, danger: OctagonAlert };

export function Callout(props: { tone: unknown; text: unknown; title?: unknown }) {
  const tone = toneOf(props.tone, "info");
  const Icon = CALLOUT_ICONS[tone];
  return (
    <div role="note" className={cn("flex min-w-0 gap-2 rounded-md border border-l-2 border-dp-line bg-dp-card px-3 py-2", TONE_RULE[tone])}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[tone])} />
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        {typeof props.title === "string" && props.title && <span className={cn("font-medium", TONE_TEXT[tone])}>{props.title}</span>}
        <span className="break-words text-dp-text">{inline(props.text)}</span>
      </div>
    </div>
  );
}

/** Code on the surface, even inside a Card: its colours are the Code Studio's, measured there. */
export function Code(props: { code: unknown; language?: unknown }) {
  const t = useMessages(openuiMessages);
  const palette = usePalette();
  const code = String(props.code ?? "");
  const language = typeof props.language === "string" ? props.language : "";
  const [lines, setLines] = useState<Token[][] | null>(null);
  useEffect(() => {
    let live = true;
    setLines(null);
    if (language)
      void import("./highlight")
        .then((m) => live && setLines(m.highlight(code, language, palette)))
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [code, language, palette]);
  const copy = () => void navigator.clipboard.writeText(code).then(() => toast(t.copied), () => undefined);
  return (
    <div className="group/code relative min-w-0 rounded-md border border-dp-line bg-dp-surface">
      <pre className="overflow-x-auto p-2 font-mono text-xs leading-5 text-dp-text" data-lang={language || undefined}>
        <code>
          {lines
            ? lines.map((line, i) => (
                <Fragment key={i}>
                  {i > 0 && "\n"}
                  {line.map((token, n) => (
                    <span key={n} style={token.style}>
                      {token.text}
                    </span>
                  ))}
                </Fragment>
              ))
            : code}
        </code>
      </pre>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={t.copyCode} title={t.copyCode} onClick={copy} className="absolute top-1 right-1 text-dp-text-2">
        <Copy />
      </Button>
    </div>
  );
}

export function Progress(props: { value: unknown; max?: unknown; label?: unknown }) {
  const max = typeof props.max === "number" && props.max > 0 ? props.max : 100;
  const value = typeof props.value === "number" && Number.isFinite(props.value) ? Math.min(Math.max(props.value, 0), max) : 0;
  const percent = Math.round((value / max) * 100);
  const label = typeof props.label === "string" ? props.label : "";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-dp-text-2">{label}</span>
        <span className="tabular-nums text-dp-text">{percent}%</span>
      </div>
      <div role="progressbar" aria-label={label || undefined} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-1.5 overflow-hidden rounded-sm bg-dp-line">
        <div className="h-full bg-dp-accent" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function Link(props: { label: unknown; url: unknown }) {
  const t = useMessages(openuiMessages);
  const url = httpUrl(props.url);
  const label = cellText(props.label) || String(props.url ?? "");
  if (!url) return <span className="text-sm text-dp-text">{label}</span>;
  return (
    <button type="button" title={t.openLink(url)} className={cn(LINK_CLASS, "w-fit text-left text-sm")} onClick={() => openLink(url)}>
      {label}
    </button>
  );
}

export function Divider() {
  return <hr className="border-dp-line" />;
}

/** Sends its message to the output's agent, on a click only; disabled where no agent listens. */
export function ActionButton(props: { label: unknown; message: unknown }) {
  const t = useMessages(openuiMessages);
  const { send } = useOutputActions();
  const label = cellText(props.label);
  const message = cellText(props.message).trim();
  const disabled = !send || !message;
  return (
    <Button type="button" variant="outline" size="sm" className="w-fit max-w-full" disabled={disabled} title={send ? message : t.noAgent} onClick={() => send?.(message, label)}>
      <span className="truncate">{label}</span>
    </Button>
  );
}
