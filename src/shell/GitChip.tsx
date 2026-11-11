import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gitWindowStore } from "@/git/gitWindowStore";
import { gitMessages } from "@/git/messages";
import { useMessages } from "@/i18n";
import { gitStatus, type GitStatus } from "@/ipc/git";
import { useActiveFolder } from "@/store/workspaceFolder";
import { Hint } from "./buttons";

const POLL_MS = 5000;

/** "⑂ main 7": branch and changed files of the active workspace's folder (spec identité §5.8); a click opens the git window. */
export function GitChip() {
  const t = useMessages(gitMessages);
  const path = useActiveFolder().folder;
  const [status, setStatus] = useState<GitStatus | null>(null);

  useEffect(() => {
    if (!path) return;
    // Another folder: the branch of the previous one must not stay while this one is read.
    setStatus(null);
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
    // The hint shows what the chip cuts short: a long branch name, and the folder.
    <Hint
      label={
        <span className="flex flex-col">
          <span className="break-all font-mono">{status.branch}</span>
          <span className="break-all font-mono opacity-70">{path}</span>
        </span>
      }
    >
      <Button
        variant="ghost"
        aria-label={t.open(status.branch, status.changed)}
        onClick={() => gitWindowStore.getState().open(path)}
        className="dp-glass-strong pointer-events-auto h-8 gap-2 rounded-lg px-3 font-mono text-xs font-normal text-dp-text-2 hover:bg-dp-hover hover:text-dp-text"
      >
        <GitBranch className="text-dp-text-3" />
        {/*
          Below 1,150 px the centred command bar starts left of 235 px: a 150 px branch would run under it, so the
          branch is cut at 80 px there (the chip ends near 165 px). The hint gives it whole.
        */}
        <span data-branch className="max-w-20 truncate min-[1150px]:max-w-[150px]">
          {status.branch}
        </span>
        {status.changed > 0 && <span className="tabular-nums text-dp-accent-ink">{status.changed}</span>}
      </Button>
    </Hint>
  );
}
