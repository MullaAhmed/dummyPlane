import type { CanvasView } from "../canvasStore";

/** Scene distance between two dots. */
export const DOT_STEP = 32;
const MIN_SCREEN_STEP = 16;

const mod = (value: number, n: number) => ((value % n) + n) % n;

/**
 * Screen spacing of the dots and offset of the first one. Zoomed out, the step
 * doubles until dots are at least 16 px apart, like Excalidraw's own grid.
 */
export function dotGrid(view: Pick<CanvasView, "scrollX" | "scrollY" | "zoom">): { step: number; x: number; y: number } {
  let step = DOT_STEP * view.zoom;
  while (step < MIN_SCREEN_STEP) step *= 2;
  return { step, x: mod(view.scrollX * view.zoom, step), y: mod(view.scrollY * view.zoom, step) };
}
