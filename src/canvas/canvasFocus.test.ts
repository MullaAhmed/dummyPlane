// @vitest-environment happy-dom
import { STORED_FLEET_KIND } from "./nodeElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { openRadial, radialStore } from "@/radial/radialState";
import { uiStore } from "@/store/ui";
import { laneStore } from "@/shell/lane";
import { LANE_ROOM } from "@/shell/layout";
import { canvasStore } from "./canvasStore";
import { focusGroup, overview, overviewTargets, releaseToCanvas } from "./canvasFocus";
import { CAMERA_MS } from "./viewActions";

const element = (fields: Record<string, unknown>) =>
  ({ x: 0, y: 0, width: 100, height: 100, isDeleted: false, frameId: null, ...fields }) as unknown as ExcalidrawElement;
const node = (id: string, kind: string, frameId: string | null = null) => element({ id, type: "embeddable", customData: { kind }, frameId });
const groupFrame = (id: string) => element({ id, type: "frame", customData: { dummyplane: { kind: "group", role: "backend", pantheon: "egypt" } } });

const updateScene = vi.fn();
const scrollToContent = vi.fn();
let container: HTMLDivElement;

beforeEach(() => {
  updateScene.mockClear();
  scrollToContent.mockClear();
  document.body.innerHTML =
    '<div class="excalidraw excalidraw-container" tabindex="0"><div data-terminal="batman"><textarea></textarea></div></div>';
  container = document.querySelector<HTMLDivElement>(".excalidraw-container")!;
});
afterEach(() => {
  document.body.replaceChildren();
  radialStore.setState({ ring: null });
  vi.unstubAllGlobals();
});

/** The OS asks for reduced motion, or not. */
const reducedMotion = (on: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: on && query === "(prefers-reduced-motion: reduce)", media: query }));

const withScene = (elements: ExcalidrawElement[]) =>
  canvasStore.setState({
    api: { getSceneElements: () => elements, updateScene, scrollToContent } as unknown as ExcalidrawImperativeAPI,
  });

describe("releaseToCanvas", () => {
  it("takes the keyboard from the terminal, deactivates it and gives the keyboard to Excalidraw's container", () => {
    withScene([]);
    document.querySelector("textarea")!.focus();
    releaseToCanvas();
    expect(document.activeElement).toBe(container);
    expect(updateScene).toHaveBeenCalledWith({ appState: { activeEmbeddable: null, selectedElementIds: {}, selectedGroupIds: {} } });
  });

  it("ends placement and link modes", () => {
    withScene([]);
    uiStore.setState({ placing: { agent: "claude" } as never, linking: "chef" });
    releaseToCanvas();
    expect(uiStore.getState().placing).toBeNull();
    expect(uiStore.getState().linking).toBeNull();
  });

  it("closes the radial ring: the shortcut, which runs before the ring's own keys, never lets its Escape reach it", () => {
    withScene([]);
    openRadial({ client: { x: 1, y: 1 }, center: { x: 400, y: 300 }, kind: "canvas", context: { project: true, workspaceId: "w", terminalCount: 0, terminalId: null }, pressed: false, sliding: false, hovered: null });
    releaseToCanvas();
    expect(radialStore.getState().ring).toBeNull();
  });

  it("creates no selection and leaves none behind: Suppr must not delete the terminal just left", () => {
    withScene([]);
    releaseToCanvas();
    for (const [update] of updateScene.mock.calls) expect(update.appState.selectedElementIds).toEqual({});
  });
});

describe("overview", () => {
  it("frames the nodes and their group frames, not drawings nor drawing frames", () => {
    const scene = [
      groupFrame("backend"),
      node("batman", "terminal", "backend"),
      node("chef", STORED_FLEET_KIND),
      element({ id: "drawing", type: "frame" }),
      node("in-drawing", "terminal", "drawing"),
      element({ id: "box", type: "rectangle" }),
      node("gone", "terminal", null),
    ];
    const gone = { ...scene[6], isDeleted: true } as ExcalidrawElement;
    expect(overviewTargets([...scene.slice(0, 6), gone]).map((e) => e.id)).toEqual(["backend", "batman", "chef", "in-drawing"]);
  });

  it("frames the whole scene when there is no node", () => {
    const scene = [element({ id: "box", type: "rectangle" }), element({ id: "arrow", type: "arrow" })];
    expect(overviewTargets(scene).map((e) => e.id)).toEqual(["box", "arrow"]);
  });

  it("fits them at once from the keyboard (Ctrl+Shift+A), with a 10 % margin, then gives the keyboard to the canvas", () => {
    const scene = [node("batman", "terminal")];
    withScene(scene);
    overview("keyboard");
    expect(scrollToContent).toHaveBeenCalledWith(scene, { fitToViewport: true, viewportZoomFactor: 0.9, animate: false, canvasOffsets: { top: 72, right: 70, bottom: 60, left: 70 } });
    expect(document.activeElement).toBe(container);
  });

  it("fits them in the work area: left of the lane while the Agents panel or the Edit panel stands in it", () => {
    const scene = [node("batman", "terminal")];
    withScene(scene);
    laneStore.setState({ occupants: ["agents"] });
    overview("keyboard");
    expect(scrollToContent).toHaveBeenLastCalledWith(scene, { fitToViewport: true, viewportZoomFactor: 0.9, animate: false, canvasOffsets: { top: 72, right: LANE_ROOM, bottom: 60, left: 70 } });
    laneStore.setState({ occupants: [] });
  });

  it("glides for CAMERA_MS at most when the pointer asked, and lands at once under reduced motion", () => {
    const scene = [node("batman", "terminal")];
    withScene(scene);
    reducedMotion(false);
    overview("pointer");
    expect(scrollToContent).toHaveBeenLastCalledWith(scene, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true, duration: CAMERA_MS, canvasOffsets: { top: 72, right: 70, bottom: 60, left: 70 } });
    expect(CAMERA_MS).toBeLessThanOrEqual(300);
    reducedMotion(true);
    overview("pointer");
    expect(scrollToContent).toHaveBeenLastCalledWith(scene, { fitToViewport: true, viewportZoomFactor: 0.9, animate: false, canvasOffsets: { top: 72, right: 70, bottom: 60, left: 70 } });
  });

  it("leaves an empty canvas alone", () => {
    withScene([]);
    overview("keyboard");
    expect(scrollToContent).not.toHaveBeenCalled();
  });
});

describe("focusGroup", () => {
  it("fits the group's frame, at 100 % at most, and gives the keyboard to the canvas", () => {
    const frame = groupFrame("backend");
    withScene([frame]);
    expect(focusGroup("backend", "keyboard")).toBe(true);
    // Go to and the shortcuts are the keyboard: the view lands at once.
    expect(scrollToContent).toHaveBeenCalledWith(frame, { fitToViewport: true, viewportZoomFactor: 0.9, animate: false, maxZoom: 1, canvasOffsets: { top: 96, right: 70, bottom: 60, left: 70 } });
    expect(document.activeElement).toBe(container);
  });

  it("glides to it for CAMERA_MS when the radial ring asked, at once under reduced motion", () => {
    const frame = groupFrame("backend");
    withScene([frame]);
    reducedMotion(false);
    focusGroup("backend", "pointer");
    expect(scrollToContent.mock.lastCall?.[1]).toMatchObject({ animate: true, duration: CAMERA_MS });
    reducedMotion(true);
    focusGroup("backend", "pointer");
    expect(scrollToContent.mock.lastCall?.[1]).toMatchObject({ animate: false });
    expect(scrollToContent.mock.lastCall?.[1]).not.toHaveProperty("duration");
  });

  it("reports a group that is gone", () => {
    withScene([]);
    expect(focusGroup("backend", "keyboard")).toBe(false);
    expect(scrollToContent).not.toHaveBeenCalled();
  });
});

describe("releaseToCanvas in a rename field", () => {
  it("cancels the edit instead of validating it through the loss of focus", () => {
    withScene([]);
    document.body.insertAdjacentHTML("beforeend", '<input id="rename" />');
    const field = document.getElementById("rename") as HTMLInputElement;
    const keys: string[] = [];
    const events: string[] = [];
    field.addEventListener("keydown", (e) => keys.push(e.key));
    field.addEventListener("blur", () => events.push("blur"));
    field.focus();
    releaseToCanvas();
    expect(keys).toEqual(["Escape"]);
    // The Escape comes first: the field cancels, then loses the focus.
    expect(events).toEqual(["blur"]);
  });

  it("never types Escape into a terminal's input", () => {
    withScene([]);
    const keys: string[] = [];
    const xterm = document.querySelector("textarea")!;
    xterm.addEventListener("keydown", (e) => keys.push(e.key));
    xterm.focus();
    releaseToCanvas();
    expect(keys).toEqual([]);
  });
});
