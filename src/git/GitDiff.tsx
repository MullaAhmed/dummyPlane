import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { InlineProblem } from "@/components/InlineProblem";
import { useMessages } from "@/i18n";
import { reviewFileDiff, type ChangedFile } from "@/ipc/review";
import { logError } from "@/lib/errorToast";
import { DiffRow, MAX_LINES } from "@/review/DiffRow";
import { reviewMessages } from "@/review/messages";
import { parseDiff, type DiffLine } from "@/review/review";
import { gitProblem, type GitProblem } from "./problems";

/** A file's changes against HEAD, read-only: the review panel's rows, without its remarks. */
export function GitDiff({ path, file, refresh }: { path: string; file: ChangedFile; refresh: number }) {
  const t = useMessages(reviewMessages);
  const [diff, setDiff] = useState<{ lines: DiffLine[]; binary: boolean } | null>(null);
  const [problem, setProblem] = useState<GitProblem | null>(null);

  useEffect(() => {
    let alive = true;
    reviewFileDiff(path, file, null).then(
      (text) => {
        if (!alive) return;
        setProblem(null);
        setDiff(parseDiff(text));
      },
      (failure: unknown) => {
        if (!alive) return;
        const next = gitProblem({ what: "diff", path: file.path }, failure);
        logError(next.title, failure);
        setProblem(next);
      },
    );
    return () => {
      alive = false;
    };
  }, [path, file, refresh]);

  if (problem) return <InlineProblem title={problem.title} next={problem.next} error={problem.line} />;
  if (!diff) return <EmptyState grace>{t.readingDiff}</EmptyState>;
  if (diff.binary) return <EmptyState>{t.binaryNoDiff}</EmptyState>;
  if (diff.lines.length === 0) return <EmptyState>{t.noContentDiff}</EmptyState>;
  return (
    <div className="min-w-0 flex-1 overflow-auto font-mono text-xs leading-normal">
      {diff.lines.slice(0, MAX_LINES).map((line, i) => (
        <DiffRow key={i} line={line} />
      ))}
      {diff.lines.length > MAX_LINES && <p className="px-3 py-2 font-sans text-xs text-dp-text-2">{t.moreLines(diff.lines.length - MAX_LINES)}</p>}
    </div>
  );
}
