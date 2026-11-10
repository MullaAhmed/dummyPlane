import { useArrivalSignal } from "@/canvas/arrivalSignal";

/** The ring drawn over a terminal that arrives (Ctrl+Tab, Ctrl+P); keyed so each arrival replays it. */
export function ArrivalFlash({ nodeId }: { nodeId: string }) {
  const arrival = useArrivalSignal(nodeId);
  if (arrival === null) return null;
  return <div key={arrival} data-arrival className="dp-arrival pointer-events-none absolute inset-0 z-30 rounded-xl" />;
}
