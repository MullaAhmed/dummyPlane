import { createContext, Fragment, useContext, useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, ChevronDown, CircleCheck, Copy, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { usePalette } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { Hint } from "@/shell/buttons";
import { GreyedHint } from "@/shell/GreyedHint";
import { LINK_CLASS, renderInline, renderMarkdown, type MarkdownOptions } from "@/studio/markdown";
import { httpUrl, openLink, useOutputActions } from "./actions";
import type { Token } from "./highlight";
import { openuiMessages } from "./messages";
import { isTone, TONE_FILL, TONE_SOFT, TONE_TEXT, type Tone } from "./tones";

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
      <Hint key={key} label={<span className="break-all">{href}</span>}>
        <button type="button" className={LINK_CLASS} onClick={() => openLink(href)}>
          {label}
        </button>
      </Hint>
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
const isGap = (gap: unknown): gap is Gap => typeof gap === "string" && gap in GAPS;
const gapOf = (gap: unknown, fallback: Gap = "md") => GAPS[isGap(gap) ? gap : fallback];

/**
 * How deep a part sits: the output's own sections (its root Stack's children)
 * stand further apart than the lines of one group, tight inside, generous
 * between. A panel's small print (`compact`) starts one level down.
 */
export const Depth = createContext(0);

/** `children` one level deeper. */
function Deeper(props: { children: ReactNode }) {
  return <Depth.Provider value={useContext(Depth) + 1}>{props.children}</Depth.Provider>;
}

/** Between the root's sections, unless the agent gave a gap: a step past lg. */
export const SECTION_GAP = "gap-5";

export function Stack(props: { children: unknown; gap?: unknown; renderNode: RenderNode }) {
  const root = useContext(Depth) === 0;
  return (
    <div className={cn("flex min-w-0 flex-col", root && !isGap(props.gap) ? SECTION_GAP : gapOf(props.gap))}>
      <Deeper>
        <Children items={props.children} renderNode={props.renderNode} />
      </Deeper>
    </div>
  );
}

const listOf = (items: unknown): unknown[] => (Array.isArray(items) ? items : items == null ? [] : [items]);

/** What keeps its own width in a Row: a control or a word, never stretched to a share. */
const FIT = new Set(["Button", "Badge", "Link"]);
const fits = (item: unknown) => isElement(item) && FIT.has(item.typeName);

/**
 * Side by side, wrapping when the node is narrow. Stats only: one strip of
 * figures. Buttons, Links and Badges keep their own width, a cluster; any
 * other child takes an equal share, 7rem at least.
 */
export function Row(props: { children: unknown; gap?: unknown; renderNode: RenderNode }) {
  const items = listOf(props.children);
  if (items.length > 1 && items.every((item) => isElement(item) && item.typeName === "Stat")) return <Stats items={items} renderNode={props.renderNode} />;
  const cluster = items.every(fits);
  return (
    <div className={cn("flex min-w-0 flex-wrap", items.some(fits) && "items-center", gapOf(props.gap, cluster ? "sm" : "md"))}>
      {items.map((item, i) => (
        <div key={i} className={fits(item) ? "max-w-full min-w-0 flex-none" : "flex min-w-28 flex-1 flex-col *:grow"}>
          <Children items={[item]} renderNode={props.renderNode} />
        </div>
      ))}
    </div>
  );
}

/**
 * A Row of Stats: one strip, a hairline between figures, in as many columns as
 * fit (four across an output) and onto a second line when narrow. The grid is
 * pulled a pixel up and left under its clipped frame, so the first row and
 * column draw no line of their own against it.
 */
function Stats(props: { items: unknown[]; renderNode: RenderNode }) {
  return (
    <div data-stats className="min-w-0 overflow-hidden rounded-lg border border-dp-line">
      <div className="-mt-px -ml-px grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]">
        {props.items.map((item, i) => (
          <div key={i} className="min-w-0 border-t border-l border-dp-line px-3 py-2.5">
            {props.renderNode(item)}
          </div>
        ))}
      </div>
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
        <Deeper>
          <Children items={props.children} renderNode={props.renderNode} />
        </Deeper>
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
          <Deeper>
            <Children items={props.children} renderNode={props.renderNode} />
          </Deeper>
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
                "-mb-px flex max-w-full items-center gap-1.5 border-b-2 px-1.5 py-1.5 text-(length:--text-ui) font-medium",
                FOCUS,
                i === active ? "border-dp-accent-ink text-dp-text" : "border-transparent text-dp-text-2 hover:text-dp-text",
              )}
            >
              <span className="truncate">{cellText(tab.props.label)}</span>
              {count != null && count !== "" && <span className={cn("rounded-sm px-1 text-xs leading-4 tabular-nums", TONE_TEXT.neutral, TONE_SOFT.neutral)}>{cellText(count)}</span>}
            </button>
          );
        })}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={tabId(active)} className="flex min-w-0 flex-col gap-3">
        <Deeper>
          <Children key={active} items={panel.children} renderNode={props.renderNode} />
        </Deeper>
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
  // More air above a heading than below it: it opens what follows.
  return <Tag className={cn("text-balance text-dp-text not-first:mt-2", HEADINGS[level - 1])}>{inline(props.text)}</Tag>;
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

/** A short cell of one word (an id, a file, a version) stays on one line: OPE-2396 would break at its hyphen beside a long column. */
const MAX_WORD = 24;
const isWord = (value: unknown) => typeof value === "string" && value.length <= MAX_WORD && !/\s/.test(value);

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
  // The outer columns sit on the output's edges, as its other parts do: their text and their rules stop where a Stat's frame or a Tab's line does.
  const flush = (i: number) => cn(i === 0 && "pl-0", i === width - 1 && "pr-0");
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
                      className={cn("px-1 py-1 text-xs font-medium text-dp-text-2", numeric[i] ? "text-right" : "text-left", flush(i))}
                    >
                      <Hint label={t.sortBy(columns[i] ?? "")}>
                        <button
                          type="button"
                          onClick={() => cycle(i)}
                          className={cn("inline-flex max-w-full items-center gap-1 rounded-sm px-1 py-0.5 hover:text-dp-text", numeric[i] && "flex-row-reverse", by && "text-dp-text", FOCUS, flush(i))}
                        >
                          <span className="truncate">{columns[i] ?? ""}</span>
                          {by && <Arrow aria-hidden className="size-3 shrink-0" />}
                        </button>
                      </Hint>
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
                  <td key={i} className={cn("px-2 py-1.5 align-top text-dp-text", numeric[i] && "text-right tabular-nums", isWord(row[i]) && "whitespace-nowrap", flush(i))}>
                    {cell(row[i])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="py-2 text-xs text-dp-text-3">{t.tableEmpty}</p>}
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
    <dl className="grid grid-cols-[fit-content(40%)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {items.map((item, i) => (
        <Fragment key={i}>
          <dt className="truncate text-dp-text-2" title={cellText(item.label)}>{cellText(item.label)}</dt>
          <dd className="min-w-0 text-dp-text [overflow-wrap:anywhere]">{typeof item.value === "string" ? inline(item.value) : cellText(item.value)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

const toneOf = (tone: unknown, fallback: Tone): Tone => (isTone(tone) ? tone : fallback);

/** A change's direction, from its sign: "+12", "−22 ms" (a minus, an en dash or a hyphen). */
export function trendOf(delta: string): "up" | "down" | null {
  const sign = /^\s*([+\-\u2212\u2013])\s*\d/.exec(delta)?.[1];
  return sign === undefined ? null : sign === "+" ? "up" : "down";
}

/**
 * A figure, read first: its tone (other than neutral) inks the figure and its
 * change line, which draws an arrow from its sign. A lone figure keeps the
 * font's own digits; columns of them (a Table) take tabular ones.
 */
export function Stat(props: { label: unknown; value: unknown; delta?: unknown; tone?: unknown }) {
  const tone = toneOf(props.tone, "neutral");
  const ink = tone === "neutral" ? "text-dp-text" : TONE_TEXT[tone];
  const label = cellText(props.label);
  const value = cellText(props.value);
  const delta = props.delta == null ? "" : cellText(props.delta);
  const trend = trendOf(delta);
  const Arrow = trend === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-xs text-dp-text-2" title={label}>{label}</span>
      <span className={cn("truncate text-2xl leading-8 font-medium tracking-tight", ink)} title={value}>{value}</span>
      {delta && (
        <span className={cn("flex min-w-0 items-center gap-0.5 text-xs tabular-nums", TONE_TEXT[tone])}>
          {trend && <Arrow aria-hidden data-trend={trend} className="size-3 shrink-0" />}
          <span className="truncate">{delta}</span>
        </span>
      )}
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
      <pre className="overflow-x-auto py-2 pr-9 pl-2.5 font-mono text-xs leading-5 text-dp-text" data-lang={language || undefined}>
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
      <Hint label={t.copyCode}>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t.copyCode} onClick={copy} className="absolute top-1 right-1 text-dp-text-2">
          <Copy />
        </Button>
      </Hint>
    </div>
  );
}

/**
 * A ratio against its limit: the bar in the accent, or in its tone's ink when
 * the ratio is news (coverage under its floor, a quota nearly spent). Out of a
 * max other than 100, the figures show beside the share.
 */
export function Progress(props: { value: unknown; max?: unknown; label?: unknown; tone?: unknown }) {
  const max = typeof props.max === "number" && props.max > 0 ? props.max : 100;
  const value = typeof props.value === "number" && Number.isFinite(props.value) ? Math.min(Math.max(props.value, 0), max) : 0;
  const percent = Math.round((value / max) * 100);
  const label = typeof props.label === "string" ? props.label : "";
  const fill = isTone(props.tone) ? TONE_FILL[props.tone] : "bg-dp-accent";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-dp-text-2">{label}</span>
        <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
          {max !== 100 && <span className="text-dp-text-2">{`${cellText(value)} / ${cellText(max)}`}</span>}
          <span className="font-medium text-dp-text">{percent}%</span>
        </span>
      </div>
      <div role="progressbar" aria-label={label || undefined} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 overflow-hidden rounded-sm bg-dp-line">
        <div className={cn("h-full rounded-sm", fill)} style={{ width: `${percent}%` }} />
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
    <Hint label={<span className="break-all">{t.openLink(url)}</span>}>
      <button type="button" className={cn(LINK_CLASS, "w-fit text-left text-sm")} onClick={() => openLink(url)}>
        {label}
      </button>
    </Hint>
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
    <GreyedHint label={send ? message : t.noAgent} className="flex w-fit max-w-full">
      <Button type="button" variant="outline" size="sm" className="w-fit max-w-full" disabled={disabled} onClick={() => send?.(message, label)}>
        <span className="truncate">{label}</span>
      </Button>
    </GreyedHint>
  );
}
