import { OctagonX, TriangleAlert } from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { errorDetail } from "@/lib/errorToast";
import { cn } from "@/lib/utils";

/**
 * Where a problem sits: a band across a panel, under its tabs; the middle of a pane that has nothing else to show;
 * a line among a list's rows; or bare, inside a row of its own.
 */
export type ProblemPlace = "band" | "pane" | "list" | "row";

const PLACES: Record<ProblemPlace, string> = {
  band: "flex shrink-0 border-b border-dp-line px-3 py-2",
  pane: "flex flex-1 items-center justify-center p-6",
  list: "flex justify-center px-3 py-4",
  row: "flex",
};

/** The toasts' tones (`TOAST_TONES`, src/components/ui/sonner.tsx): the shape and its colour, never the colour alone. */
const TONES = {
  error: { Icon: OctagonX, className: "text-dp-danger" },
  warning: { Icon: TriangleAlert, className: "text-dp-wait" },
} as const;

export interface InlineProblemProps {
  /** What failed, in the app's words, from the area's messages: never the error itself, its message or String() of it. */
  title: string;
  /** What the user can do now, in the app or in a terminal: one short sentence. */
  next?: string;
  /** The error underneath: its first line comes last, quieter, in the code font (errorDetail). Log it where it is caught (logError). */
  error?: unknown;
  /** One way on at most, under the lines. `onMouseDown` for a panel that must not take the keyboard (the canvas's: keepCanvasFocus). */
  action?: { label: string; onClick: () => void; onMouseDown?: (event: MouseEvent) => void };
  place?: ProblemPlace;
  tone?: keyof typeof TONES;
  /** "alert" for what just failed; "status" for a band that stays; null inside a live region that already speaks. */
  role?: "alert" | "status" | null;
  className?: string;
}

/**
 * The error toast's parts (toastError), inside a panel: the title in the app's words, what to do next, an action, and
 * the error's own first line as a detail in the code font. docs/design-system.md, Alerts.
 */
export function InlineProblem({ title, next, error, action, place = "pane", tone = "error", role = "alert", className }: InlineProblemProps) {
  const detail = error === undefined ? "" : errorDetail(error);
  const { Icon, className: toneClass } = TONES[tone];
  return (
    <div role={role ?? undefined} data-problem={tone} className={cn(PLACES[place], className)}>
      <div className="flex min-w-0 max-w-md gap-2 text-left">
        <Icon aria-hidden className={cn("mt-px size-4 shrink-0", toneClass)} />
        <div className="grid min-w-0 gap-0.5">
          <p className="text-(length:--text-ui) font-medium text-dp-text">{title}</p>
          {next && <p className="text-xs text-dp-text-2">{next}</p>}
          {detail && <p className="line-clamp-2 font-mono text-xs break-words text-dp-text-3">{detail}</p>}
          {action && (
            <Button type="button" variant="outline" size="sm" onMouseDown={action.onMouseDown} onClick={action.onClick} className="mt-1.5 justify-self-start">
              {action.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
