import type { ReactNode } from "react";
import { openLogDir } from "@/app/logs";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { AccentButton } from "./buttons";
import { shellMessages } from "./messages";
import { TitleBar } from "./TitleBar";

function PlainButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 shrink-0 rounded-[8px] border border-dp-line px-2.5 text-[12px] text-dp-text transition-colors hover:bg-dp-hover"
    >
      {children}
    </button>
  );
}

/** What a part of the interface shows after a render error (spec première version §3.4): the rest keeps working. */
export function CrashNotice({ error, retry, compact = false }: { error: Error; retry: () => void; compact?: boolean }) {
  const t = useMessages(shellMessages).crash;
  return (
    <div
      role="alert"
      className={cn(
        "flex h-full w-full flex-col items-start justify-center gap-2 overflow-hidden rounded-[10px] border border-dp-line bg-dp-card text-dp-text",
        compact ? "p-2.5" : "p-4",
      )}
    >
      <p className="text-[13px] font-semibold">{t.part}</p>
      <p className="line-clamp-3 font-mono text-[11px] text-dp-text-2">{error.message}</p>
      <div className="flex flex-wrap gap-1.5">
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
      <TitleBar leading={<span className="text-[13px] font-semibold text-dp-text">dummyPlane</span>} />
      <div role="alert" className="grid flex-1 place-items-center">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="text-[15px] font-semibold text-dp-text">{t.app}</p>
          <p className="font-mono text-[12px] text-dp-text-2">{error.message}</p>
          <p className="text-[13px] text-dp-text-2">{t.agentsKeepRunning}</p>
          <div className="flex gap-2">
            <AccentButton onClick={() => location.reload()}>{t.reload}</AccentButton>
            <PlainButton onClick={() => void openLogDir()}>{t.openLogs}</PlainButton>
          </div>
        </div>
      </div>
    </div>
  );
}
