import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusDot, type DotState } from "../terminal/StatusDot";

/**
 * The first line of a node's foot, an agent's or a Fleet's mission:
 * the status dot, where it stands in a word, then quiet facts ("4 min",
 * "from Atlas"), then what sits at the end of the line (one quiet action, or
 * meta). One text run, so a narrow node cuts the facts before the state.
 */
export function StatusLine(props: {
  dot: DotState;
  label: string;
  /** The label's tooltip: an error's message. */
  title?: string;
  facts?: readonly (string | false | null | undefined)[];
  end?: ReactNode;
  className?: string;
}) {
  const { dot, label, title, facts = [], end, className } = props;
  const shown = facts.filter((fact): fact is string => typeof fact === "string" && fact !== "");
  return (
    <div data-status-line className={cn("flex h-8 min-w-0 items-center gap-2 px-3 text-xs", className)}>
      <StatusDot state={dot} />
      <span className="min-w-0 truncate tabular-nums">
        <span title={title} className="text-dp-text">
          {label}
        </span>
        {shown.length > 0 && <span className="text-dp-text-2">{shown.map((fact) => ` · ${fact}`).join("")}</span>}
      </span>
      {end && <div className="ml-auto flex shrink-0 items-center gap-2">{end}</div>}
    </div>
  );
}
