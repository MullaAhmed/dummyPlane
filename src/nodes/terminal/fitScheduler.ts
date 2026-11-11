import { debounce } from "@/lib/debounce";

/** The PTY is resized 50 ms after a node stops changing size, not on every frame. */
export const FIT_DELAY_MS = 50;
/**
 * A new font size rebuilds xterm's glyph atlas: terminals are redrawn sharp at the
 * new zoom once it settles, and stay scaled (blurry) during the gesture.
 */
export const ZOOM_SETTLE_MS = 150;

export function createFitScheduler(fit: () => void, delayMs = FIT_DELAY_MS) {
  const run = debounce(fit, delayMs);
  return { schedule: () => run(), cancel: () => run.cancel() };
}
