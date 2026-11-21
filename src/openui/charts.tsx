import { Fragment, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { usePalette } from "@/app/theme";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { SYNTAX_HUES } from "@/studio/syntaxHues";
import { openuiMessages } from "./messages";
import { isTone, SERIES_HUES, TONES, TONE_TOKEN, type Tone } from "./tones";

/**
 * Small charts for an output. Every word (title, labels, values, legend) is
 * HTML in the text roles, so text keeps its size and its ink at any width and
 * never wears a series' colour: a swatch or a line key beside it carries the
 * identity. Bars are HTML too, capped at 24px and rounded at their end only;
 * lines are SVG stretched to their box, over hairline gridlines on round
 * ticks. A bar takes the accent's ink; a line series takes the palette's
 * syntax hues in this order, each at 4.5:1 or more on the surface
 * (`@/studio/syntaxTheme`).
 */

const finite = (values: readonly unknown[]) => values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));

const formatNumber = (value: number) => (Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/** A bar's fill: the accent's ink (`./tones.ts` BAR_TOKEN), measured at 3:1 on every ground. */
const BAR = "bg-dp-accent-ink";

function Figure(props: { title?: string; children: ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2.5">
      {props.title && <figcaption className="text-sm font-medium text-dp-text">{props.title}</figcaption>}
      {props.children}
    </figure>
  );
}

function Empty() {
  const t = useMessages(openuiMessages);
  return <p className="text-xs text-dp-text-3">{t.chartEmpty}</p>;
}

/** Past this many bars, or a label longer than SHORT_LABEL, bars lie down: a row each, its label in full beside it. */
export const MAX_COLUMNS = 12;
export const SHORT_LABEL = 6;

/** Whether bars with these labels stand as columns (Mon, Q1, v1.2) rather than lie as rows (file names, endpoints). */
export const standsUp = (labels: readonly string[]) => labels.length <= MAX_COLUMNS && labels.every((label) => [...label].length <= SHORT_LABEL);

/**
 * Named amounts. Short labels stand as columns on one baseline, each value on
 * its bar's end; longer ones lie as rows, label, bar and value, the bars on
 * one left edge so their lengths compare. Never a number past its bar.
 */
export function BarChart(props: { labels: readonly string[]; values: readonly unknown[]; title?: string }) {
  const values = finite(props.values);
  const count = Math.min(props.labels.length || values.length, values.length);
  if (count === 0)
    return (
      <Figure title={props.title}>
        <Empty />
      </Figure>
    );
  const shown = values.slice(0, count);
  const labels = Array.from({ length: count }, (_, i) => String(props.labels[i] ?? ""));
  const summary = labels.map((label, i) => `${label}: ${formatNumber(shown[i])}`).join(", ");
  return (
    <Figure title={props.title}>
      {standsUp(labels) ? <Columns labels={labels} values={shown} summary={summary} /> : <Rows labels={labels} values={shown} summary={summary} />}
    </Figure>
  );
}

function Columns(props: { labels: string[]; values: number[]; summary: string }) {
  const { labels, values } = props;
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const span = top - bottom || 1;
  /** Where a value sits in the plot, in % from its top. */
  const y = (v: number) => ((top - v) / span) * 100;
  const negative = bottom < 0;
  return (
    <div role="img" aria-label={props.summary} className="grid" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
      {values.map((v, i) => (
        <div key={i} className="relative h-32" title={`${labels[i]}: ${formatNumber(v)}`}>
          {/* Room above (and below, with negatives) for the value on the bar's end. */}
          <div className={cn("absolute inset-x-0 top-5", negative ? "bottom-5" : "bottom-0")}>
            <div className="absolute inset-x-0 border-t border-dp-line" style={{ top: `${y(0)}%` }} />
            <div
              data-bar
              className={cn("absolute left-1/2 w-[min(1.5rem,70%)] -translate-x-1/2", BAR, v >= 0 ? "rounded-t-sm" : "rounded-b-sm")}
              style={{ top: `${y(Math.max(v, 0))}%`, height: `${(Math.abs(v) / span) * 100}%`, minHeight: 1 }}
            />
            <span
              className="absolute inset-x-0 truncate text-center text-xs leading-4 tabular-nums text-dp-text"
              style={v >= 0 ? { bottom: `calc(${100 - y(v)}% + 2px)` } : { top: `calc(${y(v)}% + 2px)` }}
            >
              {formatNumber(v)}
            </span>
          </div>
        </div>
      ))}
      {labels.map((label, i) => (
        <span key={i} className="truncate px-0.5 pt-1.5 text-center text-xs leading-4 text-dp-text-2" title={label}>
          {label}
        </span>
      ))}
    </div>
  );
}

function Rows(props: { labels: string[]; values: number[]; summary: string }) {
  const { labels, values } = props;
  const most = Math.max(...values.map(Math.abs)) || 1;
  return (
    <div role="img" aria-label={props.summary} className="grid grid-cols-[fit-content(40%)_minmax(3rem,1fr)_auto] items-center gap-x-3 gap-y-2 text-xs leading-4">
      {values.map((v, i) => (
        <Fragment key={i}>
          <span className="truncate text-dp-text-2" title={labels[i]}>
            {labels[i]}
          </span>
          <span className="relative h-3" title={`${labels[i]}: ${formatNumber(v)}`}>
            <span data-bar className={cn("absolute inset-y-0 left-0 rounded-r-sm", BAR)} style={{ width: `${(Math.abs(v) / most) * 100}%`, minWidth: 1 }} />
          </span>
          <span className="text-right tabular-nums text-dp-text">{formatNumber(v)}</span>
        </Fragment>
      ))}
    </div>
  );
}

export interface Part {
  label: string;
  value: unknown;
  tone?: unknown;
}

/**
 * A toned part's fill: the tone's ink, but neutral, the rest of the whole,
 * a light step back, where the calm palette's neutral ink is one more dark
 * green. That light fill is under a graphic's 3:1, so its edge is drawn in
 * NEUTRAL_EDGE, which is not.
 */
export const NEUTRAL_EDGE = "--dp-text-3";
export const PART_COLOR: Record<Tone, string> = {
  ...(Object.fromEntries(TONES.map((tone) => [tone, `var(${TONE_TOKEN[tone]})`])) as Record<Tone, string>),
  neutral: `color-mix(in srgb, var(${NEUTRAL_EDGE}) 45%, transparent)`,
};
const EDGE = { boxShadow: `inset 0 0 0 1px var(${NEUTRAL_EDGE})` };

const percentOf = (value: number, total: number) => {
  const percent = (value / total) * 100;
  return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
};

/**
 * Parts of a whole, at a glance: one bar split in proportion, then a key
 * that carries each part's figure and share. A part's tone inks it (success,
 * warning, danger…); untoned parts take the line series' hues in order.
 */
export function Breakdown(props: { items: readonly unknown[]; title?: string }) {
  const palette = usePalette();
  let hue = 0;
  const parts = props.items
    .filter((item): item is Part => typeof item === "object" && item !== null)
    .map((item) => {
      const value = typeof item.value === "number" && Number.isFinite(item.value) && item.value > 0 ? item.value : 0;
      const color = isTone(item.tone) ? PART_COLOR[item.tone] : SYNTAX_HUES[palette][SERIES_HUES[hue++ % SERIES_HUES.length]];
      return { label: String(item.label ?? ""), value, color, edge: item.tone === "neutral" ? EDGE : undefined };
    });
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (total === 0)
    return (
      <Figure title={props.title}>
        <Empty />
      </Figure>
    );
  const summary = parts.map((part) => `${part.label}: ${formatNumber(part.value)} (${percentOf(part.value, total)})`).join(", ");
  return (
    <Figure title={props.title}>
      <div role="img" aria-label={summary} className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-sm">
        {parts.map((part, i) =>
          part.value > 0 ? <div key={i} title={`${part.label}: ${formatNumber(part.value)}`} className="h-full min-w-1" style={{ flex: `${part.value} 1 0`, background: part.color, ...part.edge }} /> : null,
        )}
      </div>
      <ul className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
        {parts.map((part, i) => (
          <li key={i} className="flex max-w-full min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-dp-text-2">
              <span aria-hidden className="size-2 shrink-0 rounded-sm" style={{ background: part.color, ...part.edge }} />
              <span className="truncate" title={part.label}>
                {part.label}
              </span>
            </span>
            <span className="flex items-baseline gap-1.5 pl-3.5">
              <span className="text-lg leading-7 font-medium text-dp-text">{formatNumber(part.value)}</span>
              <span className="text-xs tabular-nums text-dp-text-2">{percentOf(part.value, total)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Figure>
  );
}

export interface Series {
  name: string;
  values: readonly unknown[];
}

/** A round step for about `target` intervals over `range`: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(range: number, target: number): number {
  const raw = range / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
}

/** Round ticks that cover `low` to `high`, about three intervals: what a line chart's gridlines and axis say. */
export function ticksOf(low: number, high: number): number[] {
  if (low === high) {
    const pad = Math.abs(low) / 10 || 1;
    [low, high] = [low - pad, high + pad];
  }
  const step = niceStep(high - low, 3);
  const first = Math.floor(low / step) * step;
  const ticks: number[] = [];
  // Rounded to the step's own precision: 0.1 + 0.2 is not 0.3.
  const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  for (let tick = first; tick < high + step / 2; tick += step) ticks.push(Number(tick.toFixed(digits)));
  if (ticks[ticks.length - 1] < high) ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(digits)));
  return ticks;
}

/** The labels an x axis can show without crowding: all of up to MANY_LABELS, else about five spread evenly, the first and last among them. */
const MANY_LABELS = 7;
export function shownLabels(count: number): number[] {
  if (count <= MANY_LABELS) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / 4;
  return [...new Set(Array.from({ length: 5 }, (_, i) => Math.round(i * step)))];
}

/**
 * Lines over labels, on round ticks with hairline gridlines. Each series ends
 * on a dot; the legend under it reads each series' value at the last label,
 * or at the one under the pointer (a hairline marks it), or the one the arrow
 * keys reach once the chart has focus.
 */
export function LineChart(props: { labels: readonly string[]; series: readonly Series[]; title?: string }) {
  const palette = usePalette();
  const [at, setAt] = useState<number | null>(null);
  const series = props.series.filter((s) => s && Array.isArray(s.values) && s.values.length > 0).map((s) => ({ name: String(s.name ?? ""), values: finite(s.values) }));
  const count = Math.max(props.labels.length, ...series.map((s) => s.values.length), 0);
  if (series.length === 0 || count === 0)
    return (
      <Figure title={props.title}>
        <Empty />
      </Figure>
    );
  const all = series.flatMap((s) => s.values);
  const ticks = ticksOf(Math.min(...all), Math.max(...all));
  const [bottom, top] = [ticks[0], ticks[ticks.length - 1]];
  const x = (i: number) => (count === 1 ? 50 : (i / (count - 1)) * 100);
  const y = (v: number) => ((top - v) / (top - bottom)) * 100;
  const color = (i: number) => SYNTAX_HUES[palette][SERIES_HUES[i % SERIES_HUES.length]];
  const label = (i: number) => String(props.labels[i] ?? "");
  const index = at ?? count - 1;
  const valueAt = (s: { values: number[] }) => (index < s.values.length ? s.values[index] : null);
  const summary = series.map((s) => `${s.name}: ${formatNumber(s.values[0])} to ${formatNumber(s.values[s.values.length - 1])}`).join(", ");

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    setAt(Math.round(ratio * (count - 1)));
  };
  // The arrows move along the labels, as a slider does; the canvas does not see them (it would move the node).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: count - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    setAt(Math.min(Math.max(next, 0), count - 1));
  };

  return (
    <Figure title={props.title}>
      <div className="flex min-w-0 items-start gap-2">
        {/* The axis, as tall as the plot: its widest tick, hidden, gives the column its width. */}
        <div aria-hidden className="relative h-32 shrink-0 text-right text-xs leading-4 tabular-nums text-dp-text-3">
          <span className="invisible block">{ticks.map(formatNumber).reduce((a, b) => (b.length > a.length ? b : a), "")}</span>
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(tick)}%` }}>
              {formatNumber(tick)}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div
            tabIndex={0}
            role="group"
            aria-label={props.title || summary}
            onPointerMove={pick}
            onPointerLeave={() => setAt(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setAt(null)}
            className="relative h-32 rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/70"
          >
            {ticks.map((tick) => (
              <div key={tick} data-grid className="absolute inset-x-0 border-t border-dp-line" style={{ top: `${y(tick)}%` }} />
            ))}
            {at !== null && <div aria-hidden className="absolute inset-y-0 w-px -translate-x-1/2 bg-dp-line-strong" style={{ left: `${x(at)}%` }} />}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" role="img" aria-label={summary}>
              {series.map((s, i) => (
                <polyline
                  key={i}
                  points={s.values.map((v, n) => `${x(n)},${y(v)}`).join(" ")}
                  fill="none"
                  stroke={color(i)}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{s.name}</title>
                </polyline>
              ))}
            </svg>
            {series.map((s, i) => {
              const v = valueAt(s);
              return v === null ? null : (
                <span key={i} aria-hidden data-dot className="absolute size-2 -translate-1/2 rounded-full" style={{ left: `${x(index)}%`, top: `${y(v)}%`, background: color(i) }} />
              );
            })}
          </div>
          <div aria-hidden className="relative h-4 text-xs leading-4 text-dp-text-2">
            {shownLabels(count).map((i) => {
              // The first and last labels align on the plot's edges, the others centre on their point.
              const edge = count > 1 && (i === 0 || i === count - 1);
              return (
                <span
                  key={i}
                  className={cn("absolute top-0 max-w-[30%] truncate", edge ? (i === 0 ? "left-0" : "right-0") : "-translate-x-1/2")}
                  style={edge ? undefined : { left: `${x(i)}%` }}
                >
                  {label(i)}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      {/* The legend, and what the chart reads at a label: each series' value there. */}
      <div aria-live="polite" className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-xs leading-4">
        {label(index) && <span className="font-medium text-dp-text-2">{label(index)}</span>}
        <ul className="contents">
          {series.map((s, i) => {
            const v = valueAt(s);
            return (
              <li key={i} className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-xs" style={{ background: color(i) }} />
                <span data-series className="truncate text-dp-text-2">
                  {s.name}
                </span>
                {v !== null && <span className="font-medium tabular-nums text-dp-text">{formatNumber(v)}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </Figure>
  );
}
