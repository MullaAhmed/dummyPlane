import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import type { StepState } from "@/nodes/steps";

/*
 * The marks that are not an agent's state. The round 8px dot is StatusDot's alone
 * (src/nodes/terminal/StatusDot.tsx), the signature of an agent: a group or a role
 * is a short bar of its colour, a step a segment of its frieze's track. Unread is
 * the row's weight, unsaved its word (or, in a file's tab, a pencil). statusDotOnly.test.ts
 * keeps any other round dot out of the code.
 */

/**
 * A group's or a role's colour: a 2 × 14px bar in a box 8px wide (`className`
 * changes the box, as GroupLabels does to keep its 28px). Beside its name the bar
 * is decoration, hidden from screen readers; alone (a terminal's header), it
 * takes a `label` and is named.
 */
export function RoleMark({ color, label, className, ...rest }: { color: string; label?: string } & ComponentProps<"span">) {
  const naming = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <span {...rest} {...naming} className={cn("grid h-5 w-2 shrink-0 place-items-center", className)}>
      <span className="h-3.5 w-0.5 rounded-sm" style={{ backgroundColor: color }} />
    </span>
  );
}

/**
 * A step on its frieze's track, told apart by its shape as much as its colour
 * (`currentColor`, STEP_COLOR): in calm, done and to come are two greens. Done, a
 * thin segment; under way, a thicker one; to come, dashed; failed, a segment that
 * ends on a stop. 12px wide, 2 or 4 tall: none is a dot, the agent's mark.
 */
export const STEP_LOOK: Record<StepState, string> = {
  fait: "h-0.5 w-3 bg-current",
  en_cours: "h-1 w-3 bg-current",
  a_venir: "h-0.5 w-3 border-t-2 border-dashed border-current",
  echec: "relative h-0.5 w-3 bg-current after:absolute after:top-1/2 after:right-0 after:h-2 after:w-0.5 after:-translate-y-1/2 after:bg-current",
};
