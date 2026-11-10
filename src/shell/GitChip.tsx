import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gitWindowStore } from "@/git/gitWindowStore";
import { gitMessages } from "@/git/messages";
import { useMessages } from "@/i18n";
import { gitStatus, type GitStatus } from "@/ipc/git";
import { useProjects } from "@/store/projects";

const POLL_MS = 5000;

/** "⑂ main 7": branch and changed files of the project folder (spec identité §5.8); a click opens the git window. */
export function GitChip() {
  const t = useMessages(gitMessages);
  const path = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.path);
  const [status, setStatus] = useState<GitStatus | null>(null);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The next read is scheduled once the previous one is done: on a large
    // repository, git can take longer than the polling period.
    const read = () =>
      gitStatus(path)
        .then(
          (next) => alive && setStatus(next),
          () => alive && setStatus(null),
        )
        .finally(() => {
          if (alive) timer = setTimeout(read, POLL_MS);
        });
    void read();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [path]);

  // Outside a git repository, no chip (spec identité §5.8).
  if (!status || !path) return null;
  return (
    // The titles show what the chip cuts short: the folder, and a long branch name.
    <Button
      variant="ghost"
      title={path}
      aria-label={t.open(status.branch)}
      onClick={() => gitWindowStore.getState().open(path)}
      className="dp-glass-strong pointer-events-auto h-8 gap-2 rounded-lg px-3 font-mono text-xs font-normal text-dp-text-2 hover:bg-dp-hover hover:text-dp-text"
    >
      <GitBranch className="text-dp-text-3" />
      <span title={status.branch} className="max-w-[150px] truncate">
        {status.branch}
      </span>
      {status.changed > 0 && <span className="tabular-nums text-dp-accent-ink">{status.changed}</span>}
    </Button>
  );
}
