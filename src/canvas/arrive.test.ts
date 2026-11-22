// @vitest-environment happy-dom
import { STORED_FLEET_KIND } from "@/canvas/nodeElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { expandTerminal } from "@/nodes/terminal/minimize";
import { focusTerminal } from "@/nodes/terminal/registry";
import { activeTerminalStore } from "./activeTerminal";
import { arrivalStore } from "./arrivalSignal";
import { arrivalView, arrive, arrivedInPlace, FOCUS_FRAMES, arrivingNode, needsMove, nodeInSight, revealNode, showNode } from "./arrive";
import { readSource } from "@/theme/cssBlocks";
import { laneStore } from "@/shell/lane";
import { LANE_BOTTOM, LANE_RIGHT, LANE_TOP, LANE_WIDTH, RAIL_ROOM, workArea } from "@/shell/layout";
import { canvasStore } from "./canvasStore";
import { CAMERA_MS } from "./viewActions";

vi.mock("@/nodes/terminal/registry", () => ({ focusTerminal: vi.fn() }));
// No terminal here is minimized, but the one a test makes so.
vi.mock("@/nodes/terminal/minimize", () => ({ expandTerminal: vi.fn(() => false) }));

const viewport = { width: 1400, height: 900 };
const at100 = { scrollX: 0, scrollY: 0, zoom: 1, ...viewport };
const batman = { id: "batman", type: "embeddable", customData: { kind: "terminal" }, x: 100, y: 200, width: 720, height: 440 };
const chef = { id: "chef", type: "embeddable", customData: { kind: STORED_FLEET_KIND }, x: 100, y: 200, width: 320, height: 420 };

describe("needsMove", () => {
  it("keeps the view when the terminal shows whole at 100 % in the zone utile", () => {
    expect(needsMove(batman, at100)).toBe(false);
  });

  it("moves it when the terminal is zoomed, under the bars, under the bottom band or off screen", () => {
    expect(needsMove(batman, { ...at100, zoom: 0.8 })).toBe(true);
    expect(needsMove({ ...batman, y: 60 }, at100)).toBe(true);
    expect(needsMove({ ...batman, y: 900 - 60 - 440 + 1 }, at100)).toBe(true);
    expect(needsMove({ ...batman, x: -10 }, at100)).toBe(true);
    expect(needsMove({ ...batman, x: 1400 - 720 + 1 }, at100)).toBe(true);
    expect(needsMove(batman, { ...at100, scrollY: -150 })).toBe(true);
  });
});

it("centers a moved terminal at 100 % in the zone utile", () => {
  const view = arrivalView(batman, viewport);
  expect(view.zoom.value).toBe(1);
  // Screen top of the terminal: equal margins under the 72 px bars and above the 60 px band.
  const top = batman.y + view.scrollY;
  expect(top - 72).toBe(900 - 60 - (top + batman.height));
  expect(batman.x + view.scrollX).toBe((1400 - 720) / 2);
});

describe("the right lane, kept clear by arrivals (shell/layout.ts)", () => {
  afterEach(() => laneStore.setState({ occupants: [] }));
  /** The terminal's box on screen once `view` shows it. */
  const onScreen = (rect: typeof batman, view: { scrollX: number; scrollY: number }) => ({
    left: rect.x + view.scrollX,
    right: rect.x + view.scrollX + rect.width,
    top: rect.y + view.scrollY,
    bottom: rect.y + view.scrollY + rect.height,
  });
  /** The share of `a` that `b` covers. */
  const covered = (a: ReturnType<typeof onScreen>, b: ReturnType<typeof onScreen>) =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const lane = (w: number, h: number) => ({ left: w - LANE_RIGHT - LANE_WIDTH, right: w - LANE_RIGHT, top: LANE_TOP, bottom: h - LANE_BOTTOM });

  it("lands a terminal beside the open Agents panel at 1440x900, whole, at 100 %", () => {
    const viewport = { width: 1440, height: 900 };
    const view = arrivalView(batman, viewport, workArea(true));
    expect(view.zoom.value).toBe(1);
    const box = onScreen(batman, view);
    expect(covered(box, lane(1440, 900))).toBe(0);
    expect(box.left).toBeGreaterThanOrEqual(RAIL_ROOM);
    expect(needsMove(batman, { ...viewport, ...view, zoom: 1 }, workArea(true))).toBe(false);
  });

  it("lands it whole between the rails at 960x600, where the panel starts folded", () => {
    const viewport = { width: 960, height: 600 };
    const view = arrivalView(batman, viewport, workArea(false));
    const box = onScreen(batman, view);
    expect([box.left, box.right]).toEqual([(960 - 720) / 2, (960 + 720) / 2]);
    expect(box.left).toBeGreaterThanOrEqual(RAIL_ROOM);
    expect(box.right).toBeLessThanOrEqual(960 - RAIL_ROOM);
  });

  it("keeps the left edge of a terminal wider than the room beside the lane in view, where its lines start", () => {
    // 960 - 70 - 418 leaves 472 px: a 720 px terminal runs on under the lane, its start in view.
    const view = arrivalView(batman, { width: 960, height: 600 }, workArea(true));
    expect(onScreen(batman, view).left).toBe(RAIL_ROOM);
  });

  it("moves the view for a terminal under the occupied lane", () => {
    const at = { scrollX: 0, scrollY: 0, zoom: 1, width: 1440, height: 900 };
    // Its right edge (1320) inside the rails, under the lane (which starts at 1034).
    const under = { ...batman, x: 600 };
    expect(needsMove(under, at, workArea(false))).toBe(false);
    expect(needsMove(under, at, workArea(true))).toBe(true);
  });

  it("arrives clear of the lane while an occupant stands in it", () => {
    laneStore.setState({ occupants: ["agents"] });
    const updateScene = vi.fn();
    const app = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 1440, height: 900 };
    // Its right edge (1320) inside the rails, under the lane (which starts at 1034).
    const under = { ...batman, x: 600 };
    canvasStore.setState({
      frames: [],
      api: { getSceneElements: () => [under], getAppState: () => app, updateScene } as unknown as ExcalidrawImperativeAPI,
    });
    vi.stubGlobal("requestAnimationFrame", () => 0);
    expect(arrive("batman")).toBe(true);
    const { appState } = updateScene.mock.calls[0][0];
    expect(covered(onScreen(under, appState), lane(1440, 900))).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe("arrive", () => {
  let frames: FrameRequestCallback[];
  const updateScene = vi.fn();

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    updateScene.mockClear();
    vi.mocked(focusTerminal).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const withScene = (appState: Record<string, unknown>) =>
    canvasStore.setState({
      api: {
        getSceneElements: () => [batman, chef],
        getAppState: () => ({ ...appState, zoom: { value: appState.zoom } }),
        updateScene,
      } as unknown as ExcalidrawImperativeAPI,
    });

  it("keeps the person's zoom for a launch's arrival: its activation is not brought to 100 % (harmony launches at 960, 80 %)", () => {
    withScene({ ...at100, zoom: 0.8 });
    arrive("batman", { moveView: false });
    // The view is left as it was: no zoom nor scroll in the update.
    expect(updateScene.mock.calls[0][0].appState).not.toHaveProperty("zoom");
    expect(updateScene.mock.calls[0][0].appState).not.toHaveProperty("scrollX");
    // Canvas reads the mark once, on the activation the update makes, and skips the full-size view for it.
    expect(arrivedInPlace("batman")).toBe(true);
    expect(arrivedInPlace("batman")).toBe(false);
    expect(readSource("canvas/Canvas.tsx")).toMatch(/activatedByPress\(activated\) \|\| arrivedInPlace\(activated\)/);
  });

  it("brings a terminal the person went to (Ctrl+Tab, Go to) to 100 %, as before: no in-place mark", () => {
    withScene({ ...at100, zoom: 0.8 });
    arrive("batman");
    expect(updateScene.mock.calls[0][0].appState.zoom).toEqual({ value: 1 });
    expect(arrivedInPlace("batman")).toBe(false);
  });

  it("activates the terminal without moving a view that already shows it, clears the selection, and flashes it", () => {
    withScene(at100);
    const before = arrivalStore.getState().seq;
    arrive("batman");
    // No stale selection left behind: the canvas keys (Suppr, arrows) must not act on a terminal out of sight.
    expect(updateScene).toHaveBeenCalledWith({
      appState: { activeEmbeddable: { element: batman, state: "active" }, selectedElementIds: {}, selectedGroupIds: {} },
    });
    expect(arrivalStore.getState()).toEqual({ nodeId: "batman", seq: before + 1 });
  });

  it("makes the terminal the one Send goes to, but not a fleet", () => {
    withScene(at100);
    activeTerminalStore.setState({ id: null });
    arrive("batman");
    expect(activeTerminalStore.getState().id).toBe("batman");
    arrive("chef");
    expect(activeTerminalStore.getState().id).toBe("batman");
    activeTerminalStore.setState({ id: null });
  });

  describe("under the waiting notice", () => {
    const notice = (rect: Partial<DOMRect>) => {
      const element = document.createElement("section");
      element.setAttribute("data-waiting-notice", "");
      element.getBoundingClientRect = () => rect as DOMRect;
      document.body.append(element);
      return element;
    };

    it("centers a terminal the notice would cover: the question is at its bottom", () => {
      const element = notice({ left: 70, right: 330, top: 500, bottom: 640 });
      withScene(at100);
      arrive("batman");
      expect(updateScene.mock.calls[0][0].appState.scrollX).toBe((1400 - 720) / 2 - 100);
      element.remove();
    });

    it("keeps the view when the notice is clear of the terminal", () => {
      const element = notice({ left: 70, right: 330, top: 700, bottom: 840 });
      withScene(at100);
      arrive("batman");
      expect(updateScene.mock.calls[0][0].appState).not.toHaveProperty("scrollX");
      element.remove();
    });
  });

  it("moves the view first when needed, then focuses xterm on the next frame, after the view moved", () => {
    withScene({ ...at100, zoom: 0.5 });
    arrive("batman");
    const { appState } = updateScene.mock.calls[0][0];
    expect(appState.zoom.value).toBe(1);
    expect(appState.activeEmbeddable).toEqual({ element: batman, state: "active" });
    expect(focusTerminal).not.toHaveBeenCalled();
    frames.forEach((frame) => frame(0));
    expect(focusTerminal).toHaveBeenCalledWith("batman");
  });

  it("leaves the view to a launch (`moveView: false`): zoomed out, it still activates the terminal and gives it the keyboard", () => {
    withScene({ ...at100, zoom: 0.5 });
    arrive("batman", { moveView: false });
    expect(updateScene).toHaveBeenCalledWith({
      appState: { activeEmbeddable: { element: batman, state: "active" }, selectedElementIds: {}, selectedGroupIds: {} },
    });
    frames.forEach((frame) => frame(0));
    expect(focusTerminal).toHaveBeenCalledWith("batman");
  });

  it("keeps trying to give the keyboard for a while: a terminal mounted late, after a workspace switch, still gets it", () => {
    withScene(at100);
    expect(arrive("batman")).toBe(true);
    for (let i = 0; i < 3; i++) frames.shift()!(0);
    expect(vi.mocked(focusTerminal).mock.calls.length).toBe(3);
    // About a second on, the terminal is finally mounted.
    for (let i = 0; i < 40; i++) frames.shift()!(0);
    expect(frames.length).toBeGreaterThan(0);
    // Then it stops trying.
    while (frames.length > 0) frames.shift()!(0);
    expect(vi.mocked(focusTerminal).mock.calls.length).toBe(FOCUS_FRAMES);
  });

  it("stops trying once the terminal has the keyboard", () => {
    withScene(at100);
    document.body.innerHTML = '<div data-terminal="batman"><textarea></textarea></div>';
    vi.mocked(focusTerminal).mockImplementation(() => document.querySelector("textarea")!.focus());
    arrive("batman");
    frames.shift()!(0);
    expect(frames).toHaveLength(0);
    vi.mocked(focusTerminal).mockReset();
    document.body.replaceChildren();
  });

  it("gives a fleet's terminal the keyboard, without the terminals' flash", () => {
    withScene(at100);
    const before = arrivalStore.getState();
    expect(arrive("chef")).toBe(true);
    frames.shift()!(0);
    expect(focusTerminal).toHaveBeenCalledWith("chef");
    expect(arrivalStore.getState()).toEqual(before);
  });

  it("lets only the latest arrival keep trying, and names the one still arriving", () => {
    withScene(at100);
    arrive("batman");
    arrive("chef");
    expect(arrivingNode()).toBe("chef");
    while (frames.length > 0) frames.shift()!(0);
    // The first loop stopped at its first frame; the second ran its ten.
    expect(vi.mocked(focusTerminal).mock.calls.filter(([id]) => id === "batman")).toHaveLength(0);
    expect(vi.mocked(focusTerminal).mock.calls.filter(([id]) => id === "chef")).toHaveLength(FOCUS_FRAMES);
    expect(arrivingNode()).toBeNull();
  });

  it("does nothing for a terminal that is not on the canvas", () => {
    withScene(at100);
    expect(arrive("closed")).toBe(false);
    expect(updateScene).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });
});

describe("showNode", () => {
  const updateScene = vi.fn();
  const withScene = (appState: Record<string, unknown>) =>
    canvasStore.setState({
      api: {
        getSceneElements: () => [batman],
        getAppState: () => ({ ...appState, zoom: { value: appState.zoom } }),
        updateScene,
      } as unknown as ExcalidrawImperativeAPI,
    });

  beforeEach(() => updateScene.mockClear());

  it("shows the terminal without taking the keyboard or activating it (a rename in its header takes it)", () => {
    withScene({ ...at100, zoom: 0.5 });
    expect(showNode("batman")).toBe(true);
    const { appState } = updateScene.mock.calls[0][0];
    expect(appState.zoom.value).toBe(1);
    expect(appState).not.toHaveProperty("activeEmbeddable");
    withScene(at100);
    updateScene.mockClear();
    showNode("batman");
    expect(updateScene).not.toHaveBeenCalled();
    expect(showNode("closed")).toBe(false);
  });
});

describe("revealNode", () => {
  const scrollToContent = vi.fn();
  const withScene = (appState: Record<string, unknown>) =>
    canvasStore.setState({
      api: {
        getSceneElements: () => [batman],
        getAppState: () => ({ ...appState, zoom: { value: appState.zoom } }),
        scrollToContent,
      } as unknown as ExcalidrawImperativeAPI,
    });
  beforeEach(() => scrollToContent.mockClear());
  afterEach(() => laneStore.setState({ occupants: [] }));
  /** A scene of `elements` in a window `width` x `height` at 100 %, `active` the node the person was at. */
  const scene = (elements: object[], width: number, height: number, active?: object) =>
    canvasStore.setState({
      api: {
        getSceneElements: () => elements,
        getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 }, width, height, activeEmbeddable: active ? { element: active, state: "active" } : null }),
        scrollToContent,
      } as unknown as ExcalidrawImperativeAPI,
    });

  it("leaves the view for a launch seen beside a rail at 960x600, the lane free (fleet-plan-and-go 08)", () => {
    // Its left 50 px show at the window's right edge, under the activity rail's column: in sight, as before card 12.
    scene([{ ...batman, x: 910, y: 150 }], 960, 600);
    expect(revealNode("batman")).toBe(true);
    expect(scrollToContent).not.toHaveBeenCalled();
    // And at the left edge, beside the tool rail.
    scene([{ ...batman, x: -680, y: 150 }], 960, 600);
    expect(revealNode("batman")).toBe(true);
    expect(scrollToContent).not.toHaveBeenCalled();
  });

  it("leaves the view for a node partly left of the occupied lane", () => {
    laneStore.setState({ occupants: ["agents"] });
    scene([{ ...batman, x: 800, y: 150 }], 1440, 900);
    expect(revealNode("batman")).toBe(true);
    expect(scrollToContent).not.toHaveBeenCalled();
  });

  it("moves for a node the occupied lane hides whole, when the node the person was at stays in sight", () => {
    laneStore.setState({ occupants: ["agents"] });
    const hidden = { ...chef, id: "hidden", x: 1060, y: 150 };
    const fleet = { ...chef, id: "fleet", x: 500, y: 150 };
    scene([hidden, fleet], 1440, 900, fleet);
    expect(revealNode("hidden")).toBe(true);
    expect(scrollToContent).toHaveBeenCalledWith(hidden, expect.objectContaining({ canvasOffsets: workArea(true), minZoom: 1, maxZoom: 1 }));
  });

  it("keeps the view where the press was when that move would take the launcher out of sight", () => {
    laneStore.setState({ occupants: ["agents"] });
    const hidden = { ...chef, id: "hidden", x: 1060, y: 150 };
    // The Fleet whose Launch the mission was pressed, at the window's left: centring the arrival would push it off.
    const fleet = { ...chef, id: "fleet", x: 80, y: 150 };
    scene([hidden, fleet], 1440, 900, fleet);
    expect(revealNode("hidden")).toBe(true);
    expect(scrollToContent).not.toHaveBeenCalled();
    // Not seen, for the alerts: the lane hides it.
    expect(nodeInSight("hidden")).toBe(false);
    expect(nodeInSight("fleet")).toBe(true);
  });

  it("scrolls to a node that is off screen, keeping the zoom: Excalidraw mounts nothing it does not show", () => {
    withScene({ ...at100, scrollX: -5000 });
    expect(revealNode("batman")).toBe(true);
    // The app asked: a glide of CAMERA_MS at most, never Excalidraw's 500 ms.
    // Centred in the work area, at the zoom it has: a fit held to that zoom (Excalidraw reads the offsets only when it fits).
    expect(scrollToContent).toHaveBeenCalledWith(batman, { animate: true, duration: CAMERA_MS, fitToContent: true, minZoom: 1, maxZoom: 1, canvasOffsets: { top: 72, right: 70, bottom: 60, left: 70 } });
  });

  it("centres it in the work area, clear of an occupied lane", () => {
    laneStore.setState({ occupants: ["agents"] });
    withScene({ ...at100, scrollX: -5000 });
    expect(revealNode("batman")).toBe(true);
    expect(scrollToContent.mock.calls[0][1].canvasOffsets).toEqual(workArea(true));
    laneStore.setState({ occupants: [] });
  });

  it("leaves the view alone when the node is in sight, even zoomed out", () => {
    withScene({ ...at100, zoom: 0.5 });
    expect(revealNode("batman")).toBe(true);
    expect(scrollToContent).not.toHaveBeenCalled();
  });

  it("does nothing for a node that is gone", () => {
    withScene(at100);
    expect(revealNode("nope")).toBe(false);
  });
});

describe("arriving at a terminal of a folded group", () => {
  it("unfolds the group first, then arrives", async () => {
    const setGroupFolded = vi.fn();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.doMock("@/agents/groups", () => ({ setGroupFolded }));
    const updateScene = vi.fn();
    canvasStore.setState({
      frames: [{ id: "g", name: "G", x: 0, y: 0, width: 1, height: 1, group: { role: "general", pantheon: "greek", folded: true }, memberIds: ["batman"] }] as never,
      api: {
        getSceneElements: () => [batman],
        getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 }, ...viewport }),
        updateScene,
      } as unknown as ExcalidrawImperativeAPI,
    });
    expect(arrive("batman")).toBe(true);
    await vi.waitFor(() => expect(setGroupFolded).toHaveBeenCalledWith("g", false));
    canvasStore.setState({ frames: [] });
  });
});

describe("arriving at a minimized terminal (src/nodes/terminal/minimize.ts)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    activeTerminalStore.setState({ id: null });
  });

  it("expands it first, then moves the view to and activates its element at full size", () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    // The card shows whole where it stands; the full terminal there would run under the bottom band.
    const full = { ...batman, y: 500 };
    const card = { ...full, height: 68 };
    expect(needsMove(card, at100)).toBe(false);
    let scene = [card, chef];
    vi.mocked(expandTerminal).mockClear();
    vi.mocked(expandTerminal).mockImplementationOnce(() => {
      scene = [full, chef];
      return true;
    });
    const updateScene = vi.fn();
    canvasStore.setState({
      frames: [],
      api: {
        getSceneElements: () => scene,
        getAppState: () => ({ ...at100, zoom: { value: 1 } }),
        updateScene,
      } as unknown as ExcalidrawImperativeAPI,
    });
    expect(arrive("batman")).toBe(true);
    expect(expandTerminal).toHaveBeenCalledWith("batman");
    const { appState } = updateScene.mock.calls[0][0];
    expect(appState.activeEmbeddable.element).toBe(full);
    expect(appState).toMatchObject(arrivalView(full, viewport));
    expect(activeTerminalStore.getState().id).toBe("batman");
  });
});
