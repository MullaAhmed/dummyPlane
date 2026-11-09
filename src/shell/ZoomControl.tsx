import { Minus, Plus } from "lucide-react";
import { useCanvas } from "@/canvas/canvasStore";
import { zoomTo } from "@/canvas/viewActions";
import { stepZoom } from "@/canvas/zoom";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { IconButton } from "./buttons";
import { shellMessages } from "./messages";

/** The zoom's icon buttons: 28 px, radius 10, focus ring, press feedback. */
const CHROME =
  "size-7 rounded-md transition-[color,background-color,transform] duration-150 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97]";

/** "− 56 % +" at the bottom right (spec identité §5.8); the percentage resets to 100 %. */
export function ZoomControl() {
  const t = useMessages(shellMessages);
  const zoom = useCanvas((s) => s.view.zoom);

  return (
    <div className="dp-glass-strong pointer-events-auto flex h-8 items-center rounded-lg px-1">
      <IconButton label={t.zoom.out} className={CHROME} onClick={() => zoomTo(stepZoom(zoom, -1))}>
        <Minus />
      </IconButton>
      <button
        type="button"
        title={t.zoom.reset}
        className={cn(
          "h-7 w-12 rounded-md text-center font-mono text-xs tabular-nums text-dp-text-2 transition-[color,background-color,transform] duration-150 ease-out motion-reduce:transition-none hover:bg-dp-hover hover:text-dp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97]",
        )}
        onClick={() => zoomTo(1)}
      >
        {t.percent(Math.round(zoom * 100))}
      </button>
      <IconButton label={t.zoom.in} className={CHROME} onClick={() => zoomTo(stepZoom(zoom, 1))}>
        <Plus />
      </IconButton>
    </div>
  );
}
