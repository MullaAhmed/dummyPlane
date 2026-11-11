import type { ProjectChecks } from "@/ipc/mission";
import { currentLimit, type Limit, type Limits } from "@/usage/usage";
import type { TicketSource } from "./tickets";

/** Past this, the night may run out of plan: a warning, not a refusal (spec overnight mission §5.2). */
export const USAGE_WARNING_PERCENT = 80;

export type CheckId = "git" | "gh" | "linear";

/**
 * What stands in the way of the night: empty when nothing does. `linear`: whether the Fleet already has
 * Linear's server, which the user signs in to in its terminal; dummyPlane cannot see that sign-in itself.
 */
export function blockers(checks: ProjectChecks, source: TicketSource["kind"], linear = false): CheckId[] {
  return [
    ...(checks.git ? [] : ["git" as const]),
    ...(source === "github" && !checks.gh ? ["gh" as const] : []),
    ...(source === "linear" && !linear ? ["linear" as const] : []),
  ];
}

/** The checks the night's source needs, in the order the dialog lists them. */
export function checksFor(source: TicketSource["kind"]): CheckId[] {
  return ["git", ...(source === "github" ? ["gh" as const] : source === "linear" ? ["linear" as const] : [])];
}

/** The fullest window of the plan past the warning, as of now; null when usage is fine or unknown. */
export function usageWarning(limits: Limits | null, now: number): number | null {
  const windows = [limits?.fiveHour, limits?.sevenDay].filter((limit): limit is Limit => limit !== undefined);
  const fullest = Math.max(0, ...windows.map((limit) => currentLimit(limit, now).usedPercent));
  return fullest >= USAGE_WARNING_PERCENT ? Math.round(fullest) : null;
}
