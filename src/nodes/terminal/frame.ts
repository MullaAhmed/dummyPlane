import type { CSSProperties } from "react";

/**
 * The amber glow of a node whose agent waits (spec habillage §7.3). Excalidraw
 * clips what overflows an embeddable, so it is drawn inside, on a layer over
 * the terminal; wide enough to show on a zoomed-out canvas.
 */
export const WAITING_GLOW =
  "inset 0 0 0 2px color-mix(in srgb, var(--dp-waiting) 70%, transparent), inset 0 0 28px 6px color-mix(in srgb, var(--dp-waiting) 30%, transparent)";

/** A terminal node's border (spec habillage §7.3): the accent when selected, amber while its agent waits. */
export function frameStyle(tint: string, selected: boolean, waiting: boolean): CSSProperties {
  if (selected) {
    return {
      border: "1.5px solid var(--dp-accent)",
      boxShadow: "0 0 0 3px color-mix(in srgb, var(--dp-accent) 15%, transparent)",
    };
  }
  return { border: waiting ? "1px solid var(--dp-waiting)" : `1px solid color-mix(in srgb, ${tint} 45%, transparent)` };
}
