import { useCanvas } from "../canvasStore";
import { useWireActivity, type WirePulse } from "../wireActivity";
import { activeWires, pathData } from "./wirePaths";

/**
 * A message passing over a wire: a light runs along it, from the orchestrator
 * to the agent or back, then fades (index.css, `.dp-wire-pulse`). The wires
 * are one of the screen's moments, so colour and motion live here, but no
 * glow or blur. Nothing is mounted while the wires are quiet, so no animation
 * runs then.
 */
export function WireActivity() {
  const pulses = useWireActivity((s) => s.pulses);
  return Object.keys(pulses).length === 0 ? null : <ActiveWires pulses={pulses} />;
}

function ActiveWires({ pulses }: { pulses: Record<string, WirePulse> }) {
  const wires = useCanvas((s) => s.wires);
  const frames = useCanvas((s) => s.frames);
  const view = useCanvas((s) => s.view);
  const active = activeWires(wires, frames, pulses);
  if (active.length === 0) return null;
  return (
    <svg
      aria-hidden
      data-wire-activity
      className="pointer-events-none absolute inset-0 size-full overflow-hidden"
      // Over Excalidraw's scene canvas (z-index 1, earlier in the page), under its interactive canvas and the terminals (2):
      // the light runs on the wire, never over a node.
      style={{ zIndex: 1 }}
    >
      {/* Scene coordinates, drawn at the view's scale like the wire under it. */}
      <g transform={`scale(${view.zoom}) translate(${view.scrollX} ${view.scrollY})`}>
        {active.map(({ wire, direction, at }) => {
          const d = pathData(wire.points, direction);
          return (
            // Keyed by its time: a newer message starts the animation again.
            <g key={`${wire.id}:${at}`} data-wire={wire.id} data-direction={direction} className="dp-wire-pulse">
              <path d={d} className="dp-wire-packet" pathLength={1} />
              <path d={d} className="dp-wire-packet dp-wire-packet--late" pathLength={1} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
