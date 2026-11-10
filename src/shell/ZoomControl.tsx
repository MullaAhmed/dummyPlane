import { Minus, Plus } from "lucide-react";
import { useCanvas } from "@/canvas/canvasStore";
import { zoomTo } from "@/canvas/viewActions";
import { stepZoom } from "@/canvas/zoom";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { Hint, IconButton } from "./buttons";
import { shellMessages } from "./messages";

/**
 * "− 56 % +" at the bottom right (spec identité §5.8); the percentage resets to
 * 100 %, which only its hint says. A 32 px bar of radius 12 holding 24 px
 * controls 4 px in: their radius is 12 − 4 = 8.
 */
export function ZoomControl() {
  const t = useMessages(shellMessages);
  const zoom = useCanvas((s) => s.view.zoom);

  return (
    <div className="dp-glass-strong pointer-events-auto flex h-8 items-center gap-0.5 rounded-lg px-1">
      <IconButton label={t.zoom.out} hintSide="top" className="size-6" onClick={() => zoomTo(stepZoom(zoom, -1))}>
        <Minus />
      </IconButton>
      <Hint label={t.zoom.reset}>
        <Button
          variant="ghost"
          size="xs"
          aria-label={`${t.percent(Math.round(zoom * 100))} · ${t.zoom.reset}`}
          className="w-12 px-0 font-mono text-xs font-normal tabular-nums text-dp-text-2 hover:text-dp-text"
          onClick={() => zoomTo(1)}
        >
          {t.percent(Math.round(zoom * 100))}
        </Button>
      </Hint>
      <IconButton label={t.zoom.in} hintSide="top" className="size-6" onClick={() => zoomTo(stepZoom(zoom, 1))}>
        <Plus />
      </IconButton>
    </div>
  );
}
