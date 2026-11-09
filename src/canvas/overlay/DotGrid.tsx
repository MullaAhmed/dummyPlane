import { useCanvas } from "../canvasStore";
import { dotGrid } from "./grid";

/** The dots, painted under Excalidraw's transparent canvas; the color and the ambient lights are the root's (dp-ambient). */
export function DotGridBackground({ step, x, y }: { step: number; x: number; y: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: "radial-gradient(circle, var(--dp-dot) 1.2px, transparent 1.6px)",
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${x - step / 2}px ${y - step / 2}px`,
      }}
    />
  );
}

export function DotGrid() {
  const scrollX = useCanvas((s) => s.view.scrollX);
  const scrollY = useCanvas((s) => s.view.scrollY);
  const zoom = useCanvas((s) => s.view.zoom);
  return <DotGridBackground {...dotGrid({ scrollX, scrollY, zoom })} />;
}
