import type { ReactNode } from "react";
import { usePalette } from "@/app/theme";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { SYNTAX_HUES } from "@/studio/syntaxHues";
import { openuiMessages } from "./messages";
import { isTone, SERIES_HUES, TONES, TONE_TOKEN, type Tone } from "./tones";

/**
 * Two small charts in SVG. The marks are SVG, stretched to the box; every word
 * (title, labels, values, legend) is HTML, so text keeps its size and its ink
 * at any width. A bar takes the accent's ink; a line series takes the palette's
 * syntax hues in this order, each at 4.5:1 or more on the surface
 * (`@/studio/syntaxTheme`).
 */

/** Past this many labels, an axis shows its first and last only. */
const MANY_LABELS = 8;

const finite = (values: readonly unknown[]) => values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));

const formatNumber = (value: number) => (Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 2 }));

function Figure(props: { title?: string; children: ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      {props.title && <figcaption className="text-sm font-medium text-dp-text">{props.title}</figcaption>}
      {props.children}
    </figure>
  );
}

function Empty() {
  const t = useMessages(openuiMessages);
  return <p className="text-xs text-dp-text-3">{t.chartEmpty}</p>;
}

export function BarChart(props: { labels: readonly string[]; values: readonly unknown[]; title?: string }) {
  const values = finite(props.values);
  const count = Math.min(props.labels.length || values.length, values.length);
  if (count === 0) return <Figure title={props.title}><Empty /></Figure>;
  const shown = values.slice(0, count);
  const top = Math.max(0, ...shown);
  const bottom = Math.min(0, ...shown);
  const span = top - bottom || 1;
  const y = (v: number) => ((top - v) / span) * 100;
  return (
    <Figure title={props.title}>
      <svg viewBox={`0 0 ${count} 100`} preserveAspectRatio="none" className="h-32 w-full" role="img" aria-label={props.title}>
        {shown.map((v, i) => (
          <rect key={i} x={i + 0.15} width={0.7} y={Math.min(y(v), y(0))} height={Math.max(Math.abs(y(v) - y(0)), 0.5)} className="fill-dp-accent-ink">
            <title>{`${props.labels[i] ?? ""}: ${formatNumber(v)}`}</title>
          </rect>
        ))}
      </svg>
      <div className="flex gap-1">
        {shown.map((v, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center text-center text-xs leading-4">
            <span className="w-full truncate text-dp-text-2" title={props.labels[i]}>{props.labels[i] ?? ""}</span>
            <span className="tabular-nums text-dp-text">{formatNumber(v)}</span>
          </div>
        ))}
      </div>
    </Figure>
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
  if (total === 0) return <Figure title={props.title}><Empty /></Figure>;
  const summary = parts.map((part) => `${part.label}: ${formatNumber(part.value)} (${percentOf(part.value, total)})`).join(", ");
  return (
    <Figure title={props.title}>
      <div role="img" aria-label={summary} className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-sm">
        {parts.map((part, i) =>
          part.value > 0 ? <div key={i} title={`${part.label}: ${formatNumber(part.value)}`} className="h-full min-w-1" style={{ flex: `${part.value} 1 0`, background: part.color, ...part.edge }} /> : null,
        )}
      </div>
      <ul className="flex min-w-0 flex-wrap gap-x-5 gap-y-2">
        {parts.map((part, i) => (
          <li key={i} className="flex max-w-full min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-dp-text-2">
              <span aria-hidden className="size-2 shrink-0 rounded-sm" style={{ background: part.color, ...part.edge }} />
              <span className="truncate" title={part.label}>{part.label}</span>
            </span>
            <span className="flex items-baseline gap-1.5 pl-3.5">
              <span className="text-lg leading-7 font-medium tabular-nums text-dp-text">{formatNumber(part.value)}</span>
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

export function LineChart(props: { labels: readonly string[]; series: readonly Series[]; title?: string }) {
  const palette = usePalette();
  const series = props.series.filter((s) => s && Array.isArray(s.values) && s.values.length > 0).map((s) => ({ name: String(s.name ?? ""), values: finite(s.values) }));
  const count = Math.max(props.labels.length, ...series.map((s) => s.values.length), 0);
  if (series.length === 0 || count === 0) return <Figure title={props.title}><Empty /></Figure>;
  const all = series.flatMap((s) => s.values);
  const top = Math.max(...all);
  const bottom = Math.min(...all);
  const span = top - bottom || 1;
  const x = (i: number) => (count === 1 ? 50 : (i / (count - 1)) * 100);
  const y = (v: number) => 4 + ((top - v) / span) * 92;
  const color = (i: number) => SYNTAX_HUES[palette][SERIES_HUES[i % SERIES_HUES.length]];
  const labels = props.labels.length > MANY_LABELS ? [props.labels[0], props.labels[props.labels.length - 1]] : props.labels;
  return (
    <Figure title={props.title}>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-right text-xs leading-4 tabular-nums text-dp-text-3">
          <span>{formatNumber(top)}</span>
          <span>{formatNumber(bottom)}</span>
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-32 min-w-0 flex-1" role="img" aria-label={props.title}>
          {series.map((s, i) => (
            <polyline
              key={i}
              points={s.values.map((v, n) => `${x(n)},${y(v)}`).join(" ")}
              fill="none"
              stroke={color(i)}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            >
              <title>{s.name}</title>
            </polyline>
          ))}
        </svg>
      </div>
      <div className={cn("flex gap-2 text-xs text-dp-text-2", labels.length > 1 ? "justify-between" : "justify-center")}>
        {labels.map((label, i) => (
          <span key={i} className="min-w-0 truncate">{label}</span>
        ))}
      </div>
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-dp-text">
          {series.map((s, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 shrink-0 rounded-sm" style={{ background: color(i) }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </Figure>
  );
}
