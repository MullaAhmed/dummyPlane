// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore, EMPTY_VIEW } from "./canvasStore";
import { CAMERA_MS, cameraMotion, fitScene, zoomTo } from "./viewActions";

const scrollToContent = vi.fn();
const updateScene = vi.fn();
const withScene = (elements: unknown[]) =>
  canvasStore.setState({
    api: { getSceneElements: () => elements, scrollToContent, updateScene } as unknown as ExcalidrawImperativeAPI,
    view: { ...EMPTY_VIEW, zoom: 0.5, width: 1000, height: 800 },
  });

beforeEach(() => {
  scrollToContent.mockClear();
  updateScene.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

/** The OS asks for reduced motion, or not. */
const reducedMotion = (on: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: on && query === "(prefers-reduced-motion: reduce)", media: query }));

it("fits the whole scene, gliding when the rail's button asked, and leaves an empty one alone (Fit)", () => {
  reducedMotion(false);
  withScene([{ id: "a" }]);
  fitScene("pointer");
  expect(scrollToContent).toHaveBeenCalledWith([{ id: "a" }], { fitToViewport: true, viewportZoomFactor: 0.9, animate: true, duration: CAMERA_MS, canvasOffsets: { top: 72, right: 70, bottom: 60, left: 70 } });
  withScene([]);
  fitScene("pointer");
  expect(scrollToContent).toHaveBeenCalledTimes(1);
});

it("fits at once when the palette asked: never animate what the keyboard set off", () => {
  reducedMotion(false);
  withScene([{ id: "a" }]);
  fitScene("keyboard");
  expect(scrollToContent).toHaveBeenCalledWith([{ id: "a" }], { fitToViewport: true, viewportZoomFactor: 0.9, animate: false, canvasOffsets: { top: 72, right: 70, bottom: 60, left: 70 } });
});

it("moves the camera under 300 ms for the pointer and the app, at once for the keyboard, and at once for all under reduced motion", () => {
  expect(CAMERA_MS).toBeLessThanOrEqual(300);
  reducedMotion(false);
  expect(cameraMotion("keyboard")).toEqual({ animate: false });
  expect(cameraMotion("pointer")).toEqual({ animate: true, duration: CAMERA_MS });
  expect(cameraMotion("app")).toEqual({ animate: true, duration: CAMERA_MS });
  reducedMotion(true);
  for (const input of ["keyboard", "pointer", "app"] as const) expect(cameraMotion(input), input).toEqual({ animate: false });
});

it("zooms around the view's center (Zoom 100% and the zoom control)", () => {
  withScene([]);
  zoomTo(1);
  expect(updateScene.mock.calls[0][0].appState.zoom.value).toBe(1);
});
