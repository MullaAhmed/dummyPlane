import { X } from "lucide-react";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { shellMessages } from "./messages";
import { TOP_ROW_HEIGHT } from "./layout";

/**
 * Zen (Alt+Z) and reading (Alt+R) hide the tools: a small dense-glass button
 * under the bars, at the right, says where you are and leaves (spec identité §5.10).
 */
export function ModeExit() {
  const t = useMessages(shellMessages).modeExit;
  const mode = useCanvas((s) => s.view.mode);
  if (!mode) return null;
  const leave = () => canvasStore.getState().api?.updateScene({ appState: { zenModeEnabled: false, viewModeEnabled: false } });
  return (
    <Button
      variant="ghost"
      onClick={leave}
      style={{ top: TOP_ROW_HEIGHT + 12 }}
      className="dp-glass-strong absolute right-3 z-30 h-8 gap-2 rounded-lg px-3 text-xs font-normal text-dp-text-2 transition-[color,background-color,opacity,scale] starting:opacity-0 hover:bg-dp-hover hover:text-dp-text"
    >
      <X className="text-dp-text-3" />
      {mode === "zen" ? t.zen : t.reading}
    </Button>
  );
}
