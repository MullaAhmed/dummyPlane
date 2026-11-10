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
  // A bar of two controls: 8px controls inside 4px of padding make a 12px bar.
  return (
    <div data-loops-indicator className="dp-glass-strong fixed bottom-19 left-4 z-30 flex items-center gap-1 rounded-lg p-1 pl-3 text-xs text-dp-text">
      <Repeat className="size-4 shrink-0 text-dp-text-2" />
      <Button variant="ghost" size="xs" aria-label={t.open} onClick={() => requestUi({ kind: "loops" })} className="rounded-md font-mono font-normal tabular-nums">
        {t.label(running.length, runs)}
      </Button>
      <Button size="xs" variant="destructive" data-stop-all onClick={stopAll} className="rounded-md">
        {t.stopAll}
      </Button>
    </div>
  );
}
