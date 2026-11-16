import { Fragment, useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, CircleCheck, Copy, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { usePalette } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { LINK_CLASS, renderInline, renderMarkdown, type MarkdownOptions } from "@/studio/markdown";
import { httpUrl, openLink, useOutputActions } from "./actions";
import type { Token } from "./highlight";
import { openuiMessages } from "./messages";
import { isTone, TONE_SOFT, TONE_TEXT, type Tone } from "./tones";

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

/** Side by side, wrapping when the node is narrow: each child takes an equal share, 7rem at least (four Stats fit an output's width). */
export function Row(props: { children: unknown; gap?: unknown; renderNode: RenderNode }) {
  return (
    <div className={cn("flex min-w-0 flex-wrap *:min-w-28 *:flex-1", gapOf(props.gap))}>
      <Children items={props.children} renderNode={props.renderNode} />
    </div>
  );
}

/** The house focus ring, on every control generated output draws. */
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/70";

/** A fold's chevron, turned while closed, as the agents panel's groups. */
const CHEVRON = "size-3.5 shrink-0 text-dp-text-2 transition-[rotate] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none";

/**
 * A titled group. With `collapsed` given (true or false) its title folds it,
 * the user's click: true starts it closed, for the details under the answer.
 */
export function Card(props: { title?: unknown; children: unknown; collapsed?: unknown; renderNode: RenderNode }) {
  const title = typeof props.title === "string" ? props.title : "";
  const foldable = typeof props.collapsed === "boolean";
  const [open, setOpen] = useState(props.collapsed !== true);
  const body = useId();
  if (!foldable)
    return (
      <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-dp-line bg-dp-card p-3">
        {title && <h3 className="text-sm font-medium text-dp-text">{title}</h3>}
        <Children items={props.children} renderNode={props.renderNode} />
      </section>
    );
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-dp-line bg-dp-card">
      <h3 className="text-sm font-medium text-dp-text">
        <button type="button" aria-expanded={open} aria-controls={body} onClick={() => setOpen((v) => !v)} className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-dp-hover", FOCUS)}>
          <ChevronDown aria-hidden className={cn(CHEVRON, !open && "-rotate-90")} />
          <span className="min-w-0 truncate">{title}</span>
        </button>
      </h3>
      {open && (
        <div id={body} className="flex min-w-0 flex-col gap-2 px-3 pb-3">
          <Children items={props.children} renderNode={props.renderNode} />
        </div>
      )}
    </section>
  );
}

type Element = { type: "element"; typeName: string; props: Record<string, unknown> };

/** A component OpenUI parsed, as it hands it over: inside a Table's cell, a Tab inside Tabs. */
export const isElement = (value: unknown): value is Element => typeof value === "object" && value !== null && (value as { type?: unknown }).type === "element";

/**
 * Peer groups the user switches between, one at a time: a report's categories,
 * so its first screen is not the first category's whole list. Each Tab is a
 * label, its children, and an optional count beside the label.
 */
export function Tabs(props: { tabs: unknown; renderNode: RenderNode }) {
  const tabs = (Array.isArray(props.tabs) ? props.tabs : []).filter(isElement);
  const [chosen, setChosen] = useState(0);
  const id = useId();
  if (tabs.length === 0) return null;
  const active = Math.min(chosen, tabs.length - 1);
  const tabId = (i: number) => `${id}-tab-${i}`;
  // The arrows move between tabs, as a tab list does; the canvas does not see them (it would move the node).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const index = (next + tabs.length) % tabs.length;
    setChosen(index);
    document.getElementById(tabId(index))?.focus();
  };
  const panel = tabs[active].props;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="tablist" onKeyDown={onKeyDown} className="flex min-w-0 flex-wrap gap-x-1 border-b border-dp-line">
        {tabs.map((tab, i) => {
          const count = tab.props.count;
          return (
            <button
              key={i}
              id={tabId(i)}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-controls={`${id}-panel`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setChosen(i)}
              className={cn(
                "-mb-px flex max-w-full items-baseline gap-1 border-b-2 px-1.5 py-1.5 text-(length:--text-ui) font-medium",
                FOCUS,
                i === active ? "border-dp-accent-ink text-dp-text" : "border-transparent text-dp-text-2 hover:text-dp-text",
              )}
            >
              <span className="truncate">{cellText(tab.props.label)}</span>
              {count != null && count !== "" && <span className="text-xs tabular-nums text-dp-text-3">{cellText(count)}</span>}
            </button>
          );
        })}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={tabId(active)} className="flex min-w-0 flex-col gap-3">
        <Children key={active} items={panel.children} renderNode={props.renderNode} />
      </div>
    </div>
  );
}

/** A Tab met outside Tabs: a titled group, its count beside the title. */
export function Tab(props: { label: unknown; children: unknown; count?: unknown; renderNode: RenderNode }) {
  const count = props.count == null || props.count === "" ? "" : ` · ${cellText(props.count)}`;
  return <Card title={`${cellText(props.label)}${count}`} renderNode={props.renderNode}>{props.children}</Card>;
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
const cellText = (value: unknown): string =>
  value == null ? "" : typeof value === "number" ? value.toLocaleString("en-US") : isElement(value) ? cellText(value.props.text ?? value.props.label ?? value.props.value) : String(value);

/** Past this many rows, a table shows this many and a button for the rest; a row or two more show whole. */
export const FOLD_ROWS = 8;
const FOLD_SLACK = 2;

type Sort = { column: number; descending: boolean };

/** What a cell sorts by: a number as a number, anything else (a Badge too) by its words, blanks last. */
const sortValue = (value: unknown): number | string | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(value).trim();
  return text ? text : null;
};

const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

function compareCells(a: unknown, b: unknown): number {
  const [x, y] = [sortValue(a), sortValue(b)];
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  if (typeof x === "number" && typeof y === "number") return x - y;
  if (typeof x === "number") return -1;
  if (typeof y === "number") return 1;
  return collator.compare(x, y);
}

/**
 * A table the user can work with: a click on a header sorts by that column
 * (again: the other way; a third time: as written), and a long one folds past
 * FOLD_ROWS rows behind a button. A cell is a string (inline Markdown), a
 * number (right-aligned) or a component, a Badge for a status.
 */
export function Table(props: { columns: unknown; rows: unknown; renderNode?: RenderNode }) {
  const t = useMessages(openuiMessages);
  const columns = Array.isArray(props.columns) ? props.columns.map(cellText) : [];
  const rows = useMemo(() => (Array.isArray(props.rows) ? props.rows.map((row) => (Array.isArray(row) ? row : [row])) : []), [props.rows]);
  const width = Math.max(columns.length, ...rows.map((row) => row.length), 0);
  const indexes = Array.from({ length: width }, (_, i) => i);
  // A column of numbers only (blanks aside) aligns right, its header too.
  const numeric = indexes.map((i) => rows.some((row) => isNumeric(row[i])) && rows.every((row) => row[i] == null || row[i] === "" || isNumeric(row[i])));
  const [sort, setSort] = useState<Sort | null>(null);
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const order = rows.map((row, at) => ({ row, at }));
    // Blanks stay last either way; equal cells keep the order written.
    order.sort((a, b) => {
      const blank = (sortValue(a.row[sort.column]) === null ? 1 : 0) - (sortValue(b.row[sort.column]) === null ? 1 : 0);
      if (blank) return blank;
      return (sort.descending ? -1 : 1) * compareCells(a.row[sort.column], b.row[sort.column]) || a.at - b.at;
    });
    return order.map(({ row }) => row);
  }, [rows, sort]);
  const folds = rows.length > FOLD_ROWS + FOLD_SLACK;
  const shown = folds && !all ? sorted.slice(0, FOLD_ROWS) : sorted;
  const cycle = (column: number) =>
    setSort((now) => (now?.column !== column ? { column, descending: false } : now.descending ? null : { column, descending: true }));
  const cell = (value: unknown) =>
    isElement(value) && props.renderNode ? props.renderNode(value) : typeof value === "string" ? inline(value) : cellText(value);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {columns.length > 0 && (
            <thead>
              <tr className="border-b border-dp-line">
                {indexes.map((i) => {
                  const by = sort?.column === i ? sort : null;
                  const Arrow = by?.descending ? ArrowDown : ArrowUp;
                  return (
                    <th
                      key={i}
                      scope="col"
                      aria-sort={by ? (by.descending ? "descending" : "ascending") : undefined}
                      className={cn("px-1 py-1 text-xs font-medium text-dp-text-2", numeric[i] ? "text-right" : "text-left")}
                    >
                      <button
                        type="button"
                        title={t.sortBy(columns[i] ?? "")}
                        onClick={() => cycle(i)}
                        className={cn("inline-flex max-w-full items-center gap-1 rounded-sm px-1 py-0.5 hover:text-dp-text", numeric[i] && "flex-row-reverse", by && "text-dp-text", FOCUS)}
                      >
                        <span className="truncate">{columns[i] ?? ""}</span>
                        {by && <Arrow aria-hidden className="size-3 shrink-0" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
          )}
          <tbody>
            {shown.map((row, r) => (
              <tr key={r} className="border-b border-dp-line last:border-b-0 hover:bg-dp-hover">
                {indexes.map((i) => (
                  <td key={i} className={cn("px-2 py-1.5 align-top text-dp-text", numeric[i] && "text-right tabular-nums")}>
                    {cell(row[i])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {folds && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className={cn("flex w-full items-center justify-center gap-1.5 rounded-sm border-t border-dp-line py-1.5 text-xs font-medium text-dp-text-2 hover:bg-dp-hover hover:text-dp-text", FOCUS)}
        >
          <ChevronDown aria-hidden className={cn(CHEVRON, all && "rotate-180")} />
          {all ? t.fewerRows : t.allRows(rows.length)}
        </button>
      )}
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

/** A figure, read first: its tone (other than neutral) inks the figure and its change line. */
export function Stat(props: { label: unknown; value: unknown; delta?: unknown; tone?: unknown }) {
  const tone = toneOf(props.tone, "neutral");
  const ink = tone === "neutral" ? "text-dp-text" : TONE_TEXT[tone];
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-xs text-dp-text-2">{cellText(props.label)}</span>
      <span className={cn("truncate text-2xl leading-8 font-medium tracking-tight tabular-nums", ink)}>{cellText(props.value)}</span>
      {props.delta != null && props.delta !== "" && <span className={cn("truncate text-xs tabular-nums", TONE_TEXT[tone])}>{cellText(props.delta)}</span>}
    </div>
  );
}

/** A status word on its tone's tint: in a Table's cell, a Row, a Card. */
export function Badge(props: { text: unknown; tone?: unknown }) {
  const tone = toneOf(props.tone, "neutral");
  return (
    <span className={cn("inline-flex w-fit max-w-full items-center truncate rounded-sm px-1.5 text-xs leading-5 font-medium", TONE_TEXT[tone], TONE_SOFT[tone])}>
      {cellText(props.text)}
    </span>
  );
}

const CALLOUT_ICONS: Record<Tone, typeof Info> = { neutral: Info, info: Info, success: CircleCheck, warning: TriangleAlert, danger: OctagonAlert };

/** What needs attention, on its tone's tint: the one block of an output that is not quiet. */
export function Callout(props: { tone: unknown; text: unknown; title?: unknown }) {
  const tone = toneOf(props.tone, "info");
  const Icon = CALLOUT_ICONS[tone];
  return (
    <div role="note" className={cn("flex min-w-0 gap-2.5 rounded-md px-3 py-2.5", TONE_SOFT[tone])}>
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
