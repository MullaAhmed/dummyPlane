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

/** One line of a diff; `onClick` makes it take a remark, without it the diff is read-only. */
export function DiffRow({ line, onClick }: { line: DiffLine; onClick?: () => void }) {
  const t = useMessages(reviewMessages);
  if (line.kind === "hunk" || line.kind === "meta") {
    return (
      <div data-diff-line={line.kind} className="bg-dp-field px-3 text-dp-text-3">
        {line.text}
      </div>
    );
  }
  const tone = ROW_TONE[line.kind];
  return (
    <div
      data-diff-line={line.kind}
      onClick={onClick}
      title={onClick ? t.rowTitle : undefined}
      className={cn(
        "flex",
        tone?.rest,
        onClick && "cursor-pointer transition-colors duration-150 ease-out motion-reduce:transition-none",
        onClick && (tone?.hover ?? "hover:bg-dp-hover"),
      )}
    >
      <span className="w-10 shrink-0 pr-1 text-right text-dp-text-3 tabular-nums select-none">{line.old ?? ""}</span>
      <span className="w-10 shrink-0 pr-1 text-right text-dp-text-3 tabular-nums select-none">{line.new ?? ""}</span>
      <span className="w-4 shrink-0 text-center text-dp-text-3 select-none">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}</span>
      <span className="pr-3 whitespace-pre text-dp-text">{line.text}</span>
    </div>
  );
}
