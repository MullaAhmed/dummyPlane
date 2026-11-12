import { screenRectOf } from "@/agents/placement";
import { ROLES } from "@/agents/roles";
import { useCanvas } from "../canvasStore";
import { scrollLayerPlace, ScrollLayer } from "./layers";

/**
 * Frame outlines, painted under the transparent canvas:
 * tinted with the role's color for groups, sober grey for plain frames.
 * Placed at the view's zoom in a layer that scrolls: a pan moves that layer and
 * draws no outline again; a zoom, which resizes them, does.
 */
export function GroupBackdrops() {
  const frames = useCanvas((s) => s.frames);
  const zoom = useCanvas((s) => s.view.zoom);
  const place = scrollLayerPlace(zoom);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <ScrollLayer>
        {frames.map((frame) => {
          // A folded group is only its label.
          if (frame.group?.folded) return null;
          const rect = screenRectOf(frame, place);
          const color = frame.group ? ROLES[frame.group.role].color : null;
          return (
            <div
              key={frame.id}
              data-backdrop
              className="absolute border"
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                borderRadius: 12 * zoom,
                borderColor: color
                  ? `color-mix(in srgb, ${color} 60%, transparent)`
                  : "color-mix(in srgb, var(--dp-text-2) 45%, transparent)",
                backgroundColor: color ? `color-mix(in srgb, ${color} 4%, transparent)` : undefined,
              }}
            />
          );
        })}
      </ScrollLayer>
    </div>
  );
}
