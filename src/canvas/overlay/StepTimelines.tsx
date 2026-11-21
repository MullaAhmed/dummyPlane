import { memo } from "react";
import { STEP_LOOK } from "@/components/marks";
import { useMessages } from "@/i18n";
import { useNow } from "@/lib/useNow";
import { budgetBar, type BudgetTone } from "@/mission/mission";
import { memberBudgets } from "@/mission/store";
import { settledSteps, type Step } from "@/nodes/steps";
import { nodesMessages } from "@/nodes/messages";
import type { TerminalReportStatus } from "@/nodes/types";
import { terminalOf, useNodes } from "@/store/nodes";
import { useSubagents } from "@/store/subagents";
import { useCanvas } from "../canvasStore";
import { SceneLayer } from "./layers";
import { BUDGET_COLOR, budgetTitle, dotsOf, TIMELINE_GAP } from "./timeline";

/** The steps of a frieze that only has a bar: always this one array, so that its timeline is not drawn again for a new empty one. */
const NO_STEPS: Step[] = [];

/**
 * Each Claude terminal's steps, under it. Like the
 * group backdrops, the layer sits under the nodes and takes no pointer: a
 * frieze never covers nor blocks the header of the row below it. The friezes
 * are placed in scene units in one layer, scrolled and scaled like the nodes:
 * a pan or a zoom moves that layer and draws no frieze again. A frieze is
 * drawn again only when what it shows changed (its steps, its bar, its place),
 * not when another node or another terminal's frieze did.
 */
export function StepTimelines() {
  const rects = useCanvas((s) => s.nodeRects);
  const nodes = useNodes((s) => s.nodes);
  // The budget bars move with time, not only with the canvas. Not memoised on its
  // arguments: a fleet closed (mission store) takes its bars away without changing them.
  const now = useNow(15_000);
  const budgets = memberBudgets(nodes, now);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <SceneLayer>
        {Object.entries(rects).map(([id, rect]) => {
          const payload = terminalOf(nodes[id]);
          const steps = payload?.steps ?? NO_STEPS;
          const budget = budgets[id];
          if (!steps.length && !budget) return null;
          return (
            <Timeline
              key={id}
              nodeId={id}
              steps={steps}
              report={payload?.lastReport?.status}
              x={rect.x}
              // Under the terminal, TIMELINE_GAP below its bottom edge.
              y={rect.y + rect.height + TIMELINE_GAP}
              width={rect.width}
              bar={budget && { ...budgetBar(budget.spent, budget.budget, budget.report), title: budgetTitle(budget) }}
            />
          );
        })}
      </SceneLayer>
    </div>
  );
}

/** A budget bar as it is drawn: how full, in which tone, and its title. */
interface Bar {
  ratio: number;
  tone: BudgetTone;
  title: string;
}

interface TimelineProps {
  nodeId: string;
  /** The terminal's steps as its node keeps them, and its report: the frieze settles them. */
  steps: Step[];
  report?: TerminalReportStatus;
  /** Where the frieze starts and how wide it is, in scene units. */
  x: number;
  y: number;
  width: number;
  bar?: Bar;
}

const sameBar = (a: Bar | undefined, b: Bar | undefined) =>
  a === b || (a !== undefined && b !== undefined && a.ratio === b.ratio && a.tone === b.tone && a.title === b.title);

/** The list makes each bar anew on every pass: a frieze is drawn again when its bar shows something else, as for its other props. */
function sameTimeline(before: TimelineProps, after: TimelineProps): boolean {
  const { bar: barBefore, ...propsBefore } = before;
  const { bar: barAfter, ...propsAfter } = after;
  const keys = Object.keys(propsAfter) as (keyof typeof propsAfter)[];
  return keys.length === Object.keys(propsBefore).length && keys.every((key) => propsBefore[key] === propsAfter[key]) && sameBar(barBefore, barAfter);
}

const Timeline = memo(function Timeline({ nodeId, steps: kept, report, x, y, width, bar }: TimelineProps) {
  const running = useSubagents(nodeId);
  const t = useMessages(nodesMessages).stepMark;
  // A reported agent's frieze reads as finished even where its steps were not settled with its report.
  const steps = settledSteps(kept, report);
  const dots = dotsOf(steps, width);
  return (
    // No height of its own: everything in it is placed from its top. It takes 8 + 1 + 12 = TIMELINE_HEIGHT (21),
    // and with TIMELINE_GAP the TIMELINE_ROOM (24) that ROW_GAP keeps free under every terminal.
    <div data-steps={nodeId} className="absolute" style={{ left: x, top: y, width }}>
      {bar && <BudgetBar {...bar} />}
      {/* The track, through the middle of the 8px row of marks. */}
      {steps.length > 0 && <div className="absolute inset-x-0 top-1 h-px -translate-y-1/2 bg-dp-line" />}
      {dots.map((dot, i) => (
        <div key={i} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: dot.x, width: dot.slot }}>
          {/* A segment on the track, never a dot (the agent's mark), and still: only a waiting agent's status dot moves.
              Its shape tells the state (STEP_LOOK), its name says it; the title below is not read twice. */}
          <span className="flex h-2 items-center">
            <span data-step={dot.state} role="img" aria-label={t.name(dot.title, t.state[dot.state])} className={STEP_LOOK[dot.state]} style={{ color: dot.color }} />
          </span>
          {/* 8 + 1 + 12: TIMELINE_HEIGHT, the frieze's whole height. */}
          <span className="mt-px flex max-w-full px-1 text-xs leading-3 text-dp-text-2">
            <span aria-hidden className="truncate">
              {dot.title}
            </span>
            {dot.state === "en_cours" && running > 0 && <span className="shrink-0">{` ×${running}`}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}, sameTimeline);

/** Time spent over budget, in the gap between the terminal and its steps; complete once the agent reported. */
function BudgetBar({ ratio, tone, title }: Bar) {
  return (
    // In the TIMELINE_GAP between the terminal and its frieze, against the terminal's edge.
    <div className="absolute inset-x-0 h-0.5 bg-dp-line" style={{ top: -TIMELINE_GAP }} aria-label={title}>
      <div className="h-full" style={{ width: `${ratio * 100}%`, backgroundColor: BUDGET_COLOR[tone] }} />
    </div>
  );
}
