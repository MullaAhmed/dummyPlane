import { Minus, Plus } from "lucide-react";
import { useCanvas } from "@/canvas/canvasStore";
import { zoomTo } from "@/canvas/viewActions";
import { stepZoom } from "@/canvas/zoom";
import { useMessages } from "@/i18n";
import { IconButton } from "./buttons";
import { shellMessages } from "./messages";

/** "− 56 % +" at the bottom right (spec identité §5.8); the percentage resets to 100 %. */
export function ZoomControl() {
  const t = useMessages(shellMessages);
  const zoom = useCanvas((s) => s.view.zoom);

  return (
    <div className="dp-glass-strong pointer-events-auto flex h-8 items-center rounded-[14px] px-0.5">
      <IconButton label={t.zoom.out} onClick={() => zoomTo(stepZoom(zoom, -1))}>
        <Minus />
      </IconButton>
      <button
        type="button"
        title={t.zoom.reset}
        className="w-12 text-center font-mono text-xs text-dp-text-2 hover:text-dp-text"
        onClick={() => zoomTo(1)}
      >
        {t.percent(Math.round(zoom * 100))}
      </button>
      <IconButton label={t.zoom.in} onClick={() => zoomTo(stepZoom(zoom, 1))}>
        <Plus />
      </IconButton>
    </div>
  );
}
