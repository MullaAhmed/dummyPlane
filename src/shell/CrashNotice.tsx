import type { ReactNode } from "react";
import { openLogDir } from "@/app/logs";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { AccentButton } from "./buttons";
import { shellMessages } from "./messages";
import { TitleBar } from "./TitleBar";

/** The secondary action of a notice: the raised surface with a hairline. */
function PlainButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="outline" onClick={onClick} className="px-3 text-(length:--text-ui) font-normal">
      {children}
    </Button>
  );
}

/** What a part of the interface shows after a render error (spec première version §3.4): the rest keeps working. */
export function CrashNotice({ error, retry, compact = false }: { error: Error; retry: () => void; compact?: boolean }) {
  const t = useMessages(shellMessages).crash;
  return (
    <div
      role="alert"
      className={cn(
        "flex h-full w-full flex-col items-start justify-center gap-2 overflow-hidden rounded-lg border border-dp-line bg-dp-surface text-dp-text",
        compact ? "p-3" : "p-4",
      )}
    >
      <p className="text-(length:--text-ui) font-medium">{t.part}</p>
      <p className="line-clamp-3 font-mono text-xs text-dp-text-2">{error.message}</p>
      <div className="flex flex-wrap gap-2">
        <PlainButton onClick={retry}>{t.retry}</PlainButton>
        <PlainButton onClick={() => void openLogDir()}>{t.openLogs}</PlainButton>
      </div>
    </div>
  );
}

/** The whole window after a render error at the root. Reloading keeps the agents: they run in Rust. */
export function AppCrash({ error }: { error: Error }) {
  const t = useMessages(shellMessages).crash;
  return (
    <div className="dp-ambient flex h-screen flex-col">
      <TitleBar leading={<span className="text-(length:--text-ui) font-medium text-dp-text">dummyPlane</span>} />
      <div role="alert" className="grid flex-1 place-items-center">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="text-base font-medium text-dp-text">{t.app}</p>
          <p className="font-mono text-xs text-dp-text-2">{error.message}</p>
          <p className="text-(length:--text-ui) text-dp-text-2">{t.agentsKeepRunning}</p>
          <div className="flex gap-2">
            <AccentButton onClick={() => location.reload()}>{t.reload}</AccentButton>
            <PlainButton onClick={() => void openLogDir()}>{t.openLogs}</PlainButton>
          </div>
        </div>
      </div>
    </div>
  );
}
