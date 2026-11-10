import { messages } from "@/i18n";
import type { BudgetTone } from "@/mission/mission";
import type { MemberBudget } from "@/mission/store";
import { nodesMessages } from "@/nodes/messages";
import type { Step, StepState } from "@/nodes/steps";

/**
 * Between the terminal's bottom edge and its frieze, in scene units. The budget
 * bar lies in it; the frieze is drawn at the scene's scale.
 */
export const TIMELINE_GAP = 3;

/** A frieze's own height: an 8px dot, 1px, then one 12px line for the step's title (titles truncate, never wrap). */
export const TIMELINE_HEIGHT = 21;

/**
 * What a terminal's frieze takes under it, in scene units. Whatever stands
 * below a terminal (the next row of a group, a spawned agent) must keep at
 * least this far from its bottom edge, plus air (see ROW_GAP, src/agents/groupLayout.ts).
 */
export const TIMELINE_ROOM = TIMELINE_GAP + TIMELINE_HEIGHT;

/** Done, running, to come, failed (spec orchestrateur §5.1; tokens of spec identité). */
export const STEP_COLOR: Record<StepState, string> = {
  fait: "var(--dp-ok)",
  en_cours: "var(--dp-working)",
  a_venir: "var(--dp-text-3)",
  echec: "var(--dp-danger)",
};

export interface Dot {
  x: number;
  /** The width a title may take under its dot. */
  slot: number;
  title: string;
  state: StepState;
  color: string;
}

/** One dot per step, evenly spread, half a slot from each end. */
export function dotsOf(steps: readonly Step[], width: number): Dot[] {
  const slot = width / steps.length;
  return steps.map((step, i) => ({ x: slot * (i + 0.5), slot, title: step.title, state: step.state, color: STEP_COLOR[step.state] }));
}

/** A budget's bar (spec orchestrateur §8.3): ok, the wait colour past 80 % (a warning, not the ink), the danger colour past 100 %. */
export const BUDGET_COLOR: Record<BudgetTone, string> = { ok: "var(--dp-ok)", late: "var(--dp-wait)", over: "var(--dp-danger)" };

/** A bar's title: "22 / 50 min" while the agent works; once it reported, how that ended ("Done in 22 min of 50"). */
export function budgetTitle({ spent, budget, report }: MemberBudget): string {
  const t = messages(nodesMessages).budgetBar;
  const minutes = Math.floor(spent);
  if (report === "termine") return t.done(minutes, budget);
  if (report === "bloque") return t.blocked(minutes, budget);
  return report === "echec" ? t.failed(minutes, budget) : t.spent(minutes, budget);
}
