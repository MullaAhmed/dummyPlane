import { useLayoutEffect } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestUi } from "@/commands/uiRequests";
import { useMessages } from "@/i18n";
import { FLOAT_INSET, LOOPS_PILL_BOTTOM, LOOPS_PILL_ROOM, LOOPS_ROOM_PROPERTY } from "@/shell/layout";
import { useCornerCovered } from "@/shell/lane";
import { useLoops } from "./live";
import { loopsMessages } from "./messages";

/**
 * Visible as long as a loop runs: how many, how many runs
 * so far, and "Stop all" one click away. Each run costs real usage. It counts
 * every project's loops and stops them all, wherever the user is (home
 * included): a loop left running in a project out of sight is the one to brake.
 */
export function LoopsIndicator() {
  const t = useMessages(loopsMessages).indicator;
  const runtime = useLoops((s) => s.runtime);
  const stopAll = useLoops((s) => s.stopAll);
  const running = Object.values(runtime).filter((r) => r.running);
  const showing = running.length > 0;
  // Under a work window that reaches over the corner, inert: its Stop all is not a button the keyboard can reach unseen.
  const covered = useCornerCovered();
  // The waiting notice stands above the pill while it shows (the corner's stack, shell/layout.ts).
  useLayoutEffect(() => {
    if (!showing) return;
    const root = document.documentElement;
    root.style.setProperty(LOOPS_ROOM_PROPERTY, `${LOOPS_PILL_ROOM}px`);
    return () => {
      root.style.removeProperty(LOOPS_ROOM_PROPERTY);
    };
  }, [showing]);
  if (!showing) return null;
  const runs = running.reduce((sum, r) => sum + r.runs, 0);
  const summary = t.label(running.length, runs);
  // A bar of two controls: 8px controls inside 4px of padding make a 12px bar.
  return (
    // In the corner's stack, above the command band, on the layer under the work windows (z-10, they are z-20).
    <div
      data-loops-indicator
      inert={covered}
      style={{ bottom: LOOPS_PILL_BOTTOM, left: FLOAT_INSET }}
      className="dp-glass-strong fixed z-10 flex items-center gap-1 rounded-lg p-1 pl-3 text-xs text-dp-text"
    >
      <Repeat className="size-4 shrink-0 text-dp-text-2" />
      <Button variant="ghost" size="xs" aria-label={t.open(summary)} onClick={() => requestUi({ kind: "loops" })} className="rounded-md font-mono font-normal tabular-nums">
        {summary}
      </Button>
      <Button size="xs" variant="destructive" data-stop-all onClick={stopAll} className="rounded-md">
        {t.stopAll}
      </Button>
    </div>
  );
}
