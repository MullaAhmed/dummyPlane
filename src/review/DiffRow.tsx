import type { ChangedFile } from "@/ipc/review";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { reviewMessages } from "./messages";
import type { DiffLine } from "./review";

/** A diff or a file longer than this shows its start only. */
export const MAX_LINES = 4000;

/**
 * Letter and ink of a changed file, in the review panel and the git window. Only what is
 * added or deleted takes a colour; a modified or renamed file stays in the text's own ink.
 */
export const FILE_STATUS: Record<ChangedFile["status"], { letter: string; tone: string }> = {
  added: { letter: "A", tone: "text-dp-ok" },
  untracked: { letter: "N", tone: "text-dp-ok" },
  modified: { letter: "M", tone: "text-dp-text-2" },
  deleted: { letter: "D", tone: "text-dp-danger" },
  renamed: { letter: "R", tone: "text-dp-text-2" },
};

/** The tint of an added or deleted line, and the step it takes under the pointer when it takes a remark. */
const ROW_TONE: Partial<Record<DiffLine["kind"], { rest: string; hover: string }>> = {
  add: { rest: "bg-dp-ok/16", hover: "hover:bg-dp-ok/24" },
  del: { rest: "bg-dp-danger/16", hover: "hover:bg-dp-danger/24" },
};

/** What a screen reader says of a line: its kind, its old and new numbers, its text. */
export function lineName(t: typeof reviewMessages, line: DiffLine): string {
  const text = line.text.trim() ? line.text : t.blankLine;
  if (line.kind === "add") return t.lineAdded(line.new, text);
  if (line.kind === "del") return t.lineRemoved(line.old, text);
  return t.lineSame(line.old, line.new, text);
}

/**
 * One line of a diff; `onClick` makes it take a remark, without it the diff is read-only.
 * In the review's grid (`cell`) it is a gridcell, its row the caller's, and a line that takes a
 * remark is a stop of the grid's roving focus (`data-diff-cell`), named for a screen reader.
 */
export function DiffRow({ line, onClick, cell = false, tabbable = false }: { line: DiffLine; onClick?: () => void; cell?: boolean; tabbable?: boolean }) {
  const t = useMessages(reviewMessages);
  if (line.kind === "hunk" || line.kind === "meta") {
    return (
      <div data-diff-line={line.kind} role={cell ? "gridcell" : undefined} className="bg-dp-field px-3 text-dp-text-3">
        {line.text}
      </div>
    );
  }
  const tone = ROW_TONE[line.kind];
  const stop = cell && onClick !== undefined;
  return (
    <div
      data-diff-line={line.kind}
      data-diff-cell={stop || undefined}
      role={cell ? "gridcell" : undefined}
      tabIndex={stop ? (tabbable ? 0 : -1) : undefined}
      aria-label={cell ? lineName(t, line) : undefined}
      onClick={onClick}
      title={onClick ? t.rowTitle : undefined}
      className={cn(
        "flex",
        tone?.rest,
        // The ring shows the keyboard's line at once, inside the row: the rows snap, as the pointer's fill does.
        onClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dp-accent/70",
        onClick && (tone?.hover ?? "hover:bg-dp-hover"),
      )}
    >
      {/* The gutter is in text-2: text-3 falls under 4.5:1 on the add and delete tints (P1-14). */}
      <span className="w-10 shrink-0 pr-1 text-right text-dp-text-2 tabular-nums select-none">{line.old ?? ""}</span>
      <span className="w-10 shrink-0 pr-1 text-right text-dp-text-2 tabular-nums select-none">{line.new ?? ""}</span>
      <span className="w-4 shrink-0 text-center text-dp-text-2 select-none">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}</span>
      <span className="pr-3 whitespace-pre text-dp-text">{line.text}</span>
    </div>
  );
}
