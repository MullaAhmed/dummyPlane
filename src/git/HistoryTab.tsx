import { memo, useEffect, useMemo, useState } from "react";
import { Tag } from "lucide-react";
import { useMessages } from "@/i18n";
import { repoHistory, type LogEntry, type LogRef } from "@/ipc/repo";
import { cn } from "@/lib/utils";
import { GitMessage } from "./GitDiff";
import { layoutGraph, type GraphEdge, type GraphRow } from "./graph";
import { gitMessages } from "./messages";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A row is h-7: the graph's lines run from one row's edge to the next, with no gap between. */
const ROW = 28;
const MID = ROW / 2;
/** Between two lanes, and from the cell's edge to the first lane's centre. */
const LANE = 12;
const START = 8;
/** The dot's radius. Lines stop at its edge, so a merge's ring stays empty on any surface. */
const DOT = 4;

const laneX = (column: number) => START + column * LANE;
/** Every row's cell is as wide as the widest row needs, so the subjects start on one line. */
const cellWidth = (columns: number) => laneX(Math.max(columns, 1) - 1) + START;

/**
 * Two hues only: HEAD's own line in the full ink, a heavier stroke, the way a drawing weights its
 * main line; the other lanes in the muted ink, every other one a step lighter so neighbours part.
 */
function ink(trunk: boolean, lane: number) {
  return {
    className: trunk ? "text-dp-text" : "text-dp-text-3",
    opacity: trunk || lane % 2 === 1 ? 1 : 0.75,
    width: trunk ? 2 : 1.5,
  };
}

function edgePath({ span, from, to }: GraphEdge): string {
  const [top, bottom] = span === "through" ? [0, ROW] : span === "in" ? [0, MID - DOT] : [MID + DOT, ROW];
  const [x1, x2] = [laneX(from), laneX(to)];
  if (x1 === x2) return `M${x1} ${top}V${bottom}`;
  // Leaves and lands upright: a gentle S between lanes.
  const bend = (top + bottom) / 2;
  return `M${x1} ${top}C${x1} ${bend} ${x2} ${bend} ${x2} ${bottom}`;
}

/** One row of the graph: the lines crossing it, the commit's dot, and a short end for a parent not loaded. */
const GraphCell = memo(function GraphCell({ row, columns }: { row: GraphRow; columns: number }) {
  const width = cellWidth(columns);
  const x = laneX(row.column);
  const dot = ink(row.trunk, row.lane);
  const side = ink(false, row.lane + 1);
  // HEAD's line over the others where they cross.
  const edges = [...row.edges].sort((a, b) => Number(a.trunk) - Number(b.trunk));
  return (
    <svg aria-hidden width={width} height={ROW} viewBox={`0 0 ${width} ${ROW}`} fill="none" className="block shrink-0">
      {edges.map((edge, i) => {
        const line = ink(edge.trunk, edge.lane);
        return (
          <path
            key={i}
            d={edgePath(edge)}
            className={line.className}
            stroke="currentColor"
            strokeWidth={line.width}
            strokeOpacity={line.opacity}
            strokeDasharray={edge.folded ? "2 2" : undefined}
          />
        );
      })}
      {/* The history stops before this parent: the line ends, dashed, instead of running on to nothing. */}
      {row.cutFirst && (
        <path d={`M${x} ${MID + DOT}V${ROW - 4}`} className={dot.className} stroke="currentColor" strokeWidth={dot.width} strokeOpacity={dot.opacity} strokeDasharray="2 2" />
      )}
      {row.cutOther && (
        <path d={`M${x + 3} ${MID + 3}L${x + 7} ${ROW - 4}`} className={side.className} stroke="currentColor" strokeWidth={side.width} strokeOpacity={side.opacity} strokeDasharray="2 2" />
      )}
      {row.merge ? (
        <circle cx={x} cy={MID} r={DOT - 0.75} className={dot.className} stroke="currentColor" strokeWidth={1.5} strokeOpacity={dot.opacity} />
      ) : (
        <circle cx={x} cy={MID} r={DOT} className={dot.className} fill="currentColor" fillOpacity={dot.opacity} />
      )}
    </svg>
  );
});

const REF_ORDER: Record<LogRef["kind"], number> = { head: 0, branch: 1, tag: 2, remote: 3 };
/** Names shown before the subject; the others are counted, so the subject keeps its room. */
const MAX_REFS = 2;

/** The branches and tags on a commit: quiet mono names in a hairline, HEAD's in the full ink. */
function RefNames({ refs }: { refs: LogRef[] }) {
  const t = useMessages(gitMessages).history;
  if (refs.length === 0) return null;
  const sorted = [...refs].sort((a, b) => Number(b.current) - Number(a.current) || REF_ORDER[a.kind] - REF_ORDER[b.kind]);
  const rest = sorted.slice(MAX_REFS);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {sorted.slice(0, MAX_REFS).map((item) => (
        <span
          key={`${item.kind}:${item.name}`}
          title={t.ref(item.kind, item.name, item.current)}
          className={cn(
            "inline-flex h-5 max-w-32 items-center gap-1 rounded-sm border px-1.5 font-mono",
            item.current ? "border-dp-text/40 text-dp-text" : "border-dp-line",
            !item.current && (item.kind === "remote" ? "text-dp-text-3" : "text-dp-text-2"),
          )}
        >
          {item.kind === "tag" && <Tag aria-hidden className="size-3 shrink-0" />}
          {/* Cut from the start, as the changes list cuts a path: branches share prefixes, their ends tell them apart. */}
          <span className="truncate" style={{ direction: "rtl", textAlign: "left" }}>
            <bdi>{item.name}</bdi>
          </span>
        </span>
      ))}
      {rest.length > 0 && (
        <span title={rest.map((item) => t.ref(item.kind, item.name, item.current)).join("\n")} className="font-mono text-dp-text-3 tabular-nums">
          +{rest.length}
        </span>
      )}
    </span>
  );
}

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const FULL = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Today's commits by their time, this year's by day and month, older ones with the year. */
function shortDate(date: Date, now: Date): string {
  if (date.getFullYear() !== now.getFullYear()) return DATE.format(date);
  if (date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) return TIME.format(date);
  return DAY.format(date);
}

const CommitRow = memo(function CommitRow({ entry, row, columns, now }: { entry: LogEntry; row: GraphRow; columns: number; now: Date }) {
  const date = new Date(entry.date * 1000);
  return (
    <li data-git-commit={entry.hash} data-git-merge={row.merge || undefined} className="flex h-7 items-center gap-2 pr-3 pl-2 text-xs">
      <GraphCell row={row} columns={columns} />
      <RefNames refs={entry.refs} />
      {/* A merge says less than the work it brings in: its subject steps back to the secondary role. */}
      <span title={entry.subject} className={cn("min-w-0 flex-1 truncate", row.merge ? "text-dp-text-2" : "text-dp-text")}>
        {entry.subject}
      </span>
      <span title={entry.author} className="w-28 shrink-0 truncate text-dp-text-2">
        {entry.author}
      </span>
      <time dateTime={date.toISOString()} title={FULL.format(date)} className="w-20 shrink-0 text-right text-dp-text-3 tabular-nums">
        {shortDate(date, now)}
      </time>
      <span title={entry.hash} className="w-16 shrink-0 truncate font-mono text-dp-text-3">
        {entry.shortHash}
      </span>
    </li>
  );
});

/** The branch's commits as a graph: lanes, merges, and the names on each commit. */
export function HistoryTab({ path, refresh }: { path: string; refresh: number }) {
  const t = useMessages(gitMessages);
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    repoHistory(path).then(
      (entries) => {
        if (!alive) return;
        setError(null);
        setLog(entries);
      },
      (failed: unknown) => alive && setError(errorText(failed)),
    );
    return () => {
      alive = false;
    };
  }, [path, refresh]);

  // Laid out once per read of the history, never on a mere render.
  const view = useMemo(() => (log ? { graph: layoutGraph(log), now: new Date() } : null), [log]);

  if (error) return <GitMessage>{error}</GitMessage>;
  if (!log || !view) return <GitMessage>{t.reading}</GitMessage>;
  if (log.length === 0) return <GitMessage>{t.history.empty}</GitMessage>;
  const { graph, now } = view;
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto py-1">
      {log.map((entry, i) => (
        <CommitRow key={entry.hash} entry={entry} row={graph.rows[i]} columns={graph.columns} now={now} />
      ))}
      {graph.cut && <li className="px-3 pt-2 pb-1 text-xs text-dp-text-3">{t.history.cut(log.length)}</li>}
    </ul>
  );
}
