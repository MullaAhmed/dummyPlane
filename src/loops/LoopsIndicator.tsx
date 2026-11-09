import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestUi } from "@/commands/uiRequests";
import { useMessages } from "@/i18n";
import { useLoops } from "./live";
import { loopsMessages } from "./messages";

/**
 * Visible as long as a loop runs (loops spec §1): how many, how many runs
 * so far, and "Stop all" one click away. Each run costs real usage.
 */
export function LoopsIndicator() {
  const t = useMessages(loopsMessages).indicator;
  const runtime = useLoops((s) => s.runtime);
  const stopAll = useLoops((s) => s.stopAll);
  const running = Object.values(runtime).filter((r) => r.running);
  if (running.length === 0) return null;
  const runs = running.reduce((sum, r) => sum + r.runs, 0);
  return (
    <div
      data-loops-indicator
      className="dp-glass-strong fixed bottom-[76px] left-4 z-30 flex items-center gap-2 rounded-full py-1 pl-3 pr-1 text-xs text-dp-text"
    >
      <Repeat className="size-3.5 text-dp-accent-ink" />
      <button type="button" aria-label={t.open} onClick={() => requestUi({ kind: "loops" })} className="rounded-md px-1 font-mono transition-[background-color] duration-150 ease-out hover:bg-dp-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 motion-reduce:transition-none">
        {t.label(running.length, runs)}
      </button>
      <Button size="sm" variant="destructive" data-stop-all onClick={stopAll} className="rounded-full">
        {t.stopAll}
      </Button>
    </div>
  );
}
