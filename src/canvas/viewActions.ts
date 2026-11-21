import type { NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import { zoneOffsets } from "./canvasFocus";
import { canvasStore } from "./canvasStore";
import { zoomAroundCenter } from "./zoom";

/** The longest a camera move glides, in ms (Excalidraw's own default is 500): UI motion stays under 300 ms. */
export const CAMERA_MS = 300;

/**
 * What asked for a camera move. The keyboard (a shortcut, the palette) gets it at once: never animate a
 * keyboard-initiated action. The pointer (the rail, the radial ring) and the app itself (a node added out of sight)
 * get a glide of CAMERA_MS, which shows where the view went.
 */
export type CameraInput = "keyboard" | "pointer" | "app";

/** The user asked for less motion: then every camera move lands at once. */
function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The `animate` and `duration` of a `scrollToContent` that `input` asked for. */
export function cameraMotion(input: CameraInput): { animate: false } | { animate: true; duration: number } {
  return input === "keyboard" || reducedMotion() ? { animate: false } : { animate: true, duration: CAMERA_MS };
}

/** "Fit view" of the rail (the pointer), "Fit to scene" of the palette (the keyboard): the whole scene in view. */
export function fitScene(input: CameraInput) {
  const api = canvasStore.getState().api;
  const elements = api?.getSceneElements() ?? [];
  if (api && elements.length > 0) api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.9, ...cameraMotion(input), canvasOffsets: zoneOffsets() });
}

/** The zoom control's steps and "Zoom 100%": `next`, around the view's center. */
export function zoomTo(next: number) {
  const { api, view } = canvasStore.getState();
  if (!api) return;
  const target = zoomAroundCenter(view, next);
  api.updateScene({
    appState: { zoom: { value: target.zoom as NormalizedZoomValue }, scrollX: target.scrollX, scrollY: target.scrollY },
  });
}
