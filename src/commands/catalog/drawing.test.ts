// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { CANVAS_KEYS, copyCanvasSelection, openNativeMenuAt, pasteOnCanvasAt, pressCanvasKey, startTextAt } from "@/radial/bridges";
import { groupSelection } from "@/fleet/selectionGroup";
import { exportCurrentPng, exportCurrentScene, importIntoScene } from "@/shell/sceneActions";
import { labelOf, sectionOf, type CommandContext } from "../command";
import { DRAWING, SCENE } from "./drawing";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/fleet/selectionGroup", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/fleet/selectionGroup")>()), groupSelection: vi.fn() }));
vi.mock("@/shell/sceneActions", () => ({ exportCurrentScene: vi.fn(), importIntoScene: vi.fn(), exportCurrentPng: vi.fn() }));
vi.mock("@/radial/bridges", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/radial/bridges")>()),
  pressCanvasKey: vi.fn(),
  copyCanvasSelection: vi.fn(),
  pasteOnCanvasAt: vi.fn(() => Promise.resolve()),
  startTextAt: vi.fn(),
  openNativeMenuAt: vi.fn(),
}));

const busy: CommandContext = { project: true, workspaceId: "w1", terminalCount: 0, terminalId: null };
const setActiveTool = vi.fn();
const updateScene = vi.fn();
let container: HTMLDivElement;
const keys: KeyboardEvent[] = [];

beforeEach(() => {
  setActiveTool.mockClear();
  keys.length = 0;
  canvasStore.setState({ api: { setActiveTool, updateScene, getAppState: () => ({ selectedElementIds: {} }), getSceneElements: () => [] } as unknown as ExcalidrawImperativeAPI });
  document.body.innerHTML = '<div class="excalidraw excalidraw-container" tabindex="0"></div><textarea></textarea>';
  container = document.querySelector<HTMLDivElement>(".excalidraw-container")!;
  container.addEventListener("keydown", (e) => keys.push(e));
});
afterEach(() => document.body.replaceChildren());

describe("Dessin (spec fenêtre §7.3)", () => {
  it("lists the tools, the hand included, with Excalidraw's keys, then Annuler and Rétablir", () => {
    expect(DRAWING.map((c) => [labelOf(c, busy), c.keys ?? null])).toEqual([
      ["Selection", "V"],
      ["Hand", "H"],
      ["Rectangle", "R"],
      ["Ellipse", "O"],
      ["Diamond", "D"],
      ["Line", "L"],
      ["Arrow", "A"],
      ["Frame", "F"],
      ["Text", "T"],
      ["Pen", "P"],
      ["Eraser", "E"],
      ["Image", null],
      ["Undo", "Ctrl+Z"],
      ["Redo", "Ctrl+Y"],
      ["Copy", "Ctrl+C"],
      ["Paste", "Ctrl+V"],
      ["Duplicate", "Ctrl+D"],
      ["Group selection", null],
      ["Bring to front", "Ctrl+Shift+]"],
      ["Send to back", "Ctrl+Shift+["],
      ["Lock", "Ctrl+Shift+L"],
      ["Delete", "Suppr"],
      ["More…", null],
    ]);
  });

  it("picks a tool and gives the keyboard to the canvas", async () => {
    document.querySelector("textarea")!.focus();
    await DRAWING.find((c) => c.id === "tool.rectangle")!.run(busy);
    expect(setActiveTool).toHaveBeenCalledWith({ type: "rectangle" });
    expect(document.activeElement).toBe(container);
  });

  it("undoes and redoes with Excalidraw's own keys, sent to its container", async () => {
    await DRAWING.find((c) => c.id === "edit.undo")!.run(busy);
    await DRAWING.find((c) => c.id === "edit.redo")!.run(busy);
    expect(keys.map((k) => [k.key, k.ctrlKey])).toEqual([
      ["z", true],
      ["y", true],
    ]);
  });

  it("sends the key before giving the keyboard back, so Excalidraw's undo cannot overwrite the release", async () => {
    // Excalidraw computes an undo from the state of the moment: a release still
    // pending would be overwritten, leaving the terminal active and selected.
    const order: string[] = [];
    container.addEventListener("keydown", (e) => order.push(`key ${e.key}`));
    updateScene.mockImplementation(() => order.push("release"));
    await DRAWING.find((c) => c.id === "edit.undo")!.run(busy);
    await DRAWING.find((c) => c.id === "edit.redo")!.run(busy);
    expect(order).toEqual(["key z", "release", "key y", "release"]);
    expect(document.activeElement).toBe(container);
    updateScene.mockReset();
  });
});

describe("Dessin, sur la sélection (spec menu radial §4.5)", () => {
  const view = { scrollX: 0, scrollY: 0, zoom: 2, width: 800, height: 600, offsetLeft: 5, offsetTop: 7, tool: "selection", selectedIds: [], editingFrame: null, mode: null };
  const mixed = (selected: Record<string, boolean>) =>
    canvasStore.setState({
      view,
      api: { getAppState: () => ({ selectedElementIds: selected }), getSceneElements: () => [{ id: "r1", locked: true }, { id: "r2", locked: false }] } as unknown as ExcalidrawImperativeAPI,
    });
  const scene = (selected: Record<string, boolean>, locked = false) =>
    canvasStore.setState({
      view,
      api: {
        setActiveTool,
        updateScene,
        getAppState: () => ({ selectedElementIds: selected }),
        getSceneElements: () => [{ id: "r1", locked }],
      } as unknown as ExcalidrawImperativeAPI,
    });
  const run = (id: string, ctx: CommandContext = busy) => DRAWING.find((c) => c.id === id)!.run(ctx);

  it("acts on the selection with Excalidraw's own keys, offered only with a selection", async () => {
    scene({});
    expect(DRAWING.filter((c) => c.id.startsWith("drawing.") && c.available(busy)).map((c) => c.id)).toEqual(["drawing.paste"]);
    scene({ r1: true });
    await run("drawing.duplicate");
    expect(pressCanvasKey).toHaveBeenLastCalledWith(CANVAS_KEYS.duplicate);
    await run("drawing.front");
    expect(pressCanvasKey).toHaveBeenLastCalledWith(CANVAS_KEYS.front);
    await run("drawing.back");
    expect(pressCanvasKey).toHaveBeenLastCalledWith(CANVAS_KEYS.back);
    await run("drawing.delete");
    expect(pressCanvasKey).toHaveBeenLastCalledWith(CANVAS_KEYS.delete);
    await run("drawing.copy");
    expect(copyCanvasSelection).toHaveBeenCalled();
  });

  it("names the lock after the selection's state", () => {
    scene({ r1: true });
    expect(labelOf(DRAWING.find((c) => c.id === "drawing.lock")!, busy)).toBe("Lock");
    scene({ r1: true }, true);
    expect(labelOf(DRAWING.find((c) => c.id === "drawing.lock")!, busy)).toBe("Unlock");
  });

  it("offers Unlock on a mixed selection: Excalidraw's lock unlocks it whole (plan G1)", () => {
    mixed({ r1: true, r2: true });
    expect(labelOf(DRAWING.find((c) => c.id === "drawing.lock")!, busy)).toBe("Unlock");
  });

  it("pastes and starts a text where the radial menu was opened, else at the middle of the canvas", async () => {
    scene({});
    await run("drawing.paste", { ...busy, at: { x: 10, y: 20 } });
    expect(pasteOnCanvasAt).toHaveBeenLastCalledWith({ x: 25, y: 47 });
    await run("drawing.paste");
    expect(pasteOnCanvasAt).toHaveBeenLastCalledWith({ x: 405, y: 307 });
    await run("tool.text", { ...busy, at: { x: 10, y: 20 } });
    expect(startTextAt).toHaveBeenLastCalledWith({ x: 25, y: 47 });
    await run("tool.text");
    expect(setActiveTool).toHaveBeenLastCalledWith({ type: "text" });
  });

  describe("Group selection", () => {
    const group = DRAWING.find((c) => c.id === "selection.group")!;
    const terminals = [
      { id: "a", type: "embeddable", isDeleted: false, frameId: null, x: 0, y: 0, width: 720, height: 440, customData: { kind: "terminal" } },
      { id: "b", type: "embeddable", isDeleted: false, frameId: null, x: 800, y: 0, width: 720, height: 440, customData: { kind: "terminal" } },
      { id: "c", type: "embeddable", isDeleted: false, frameId: "g1", x: 5000, y: 0, width: 720, height: 440, customData: { kind: "terminal" } },
      { id: "g1", type: "frame", isDeleted: false, frameId: null, x: 4900, y: -50, width: 1000, height: 600 },
    ];
    const selecting = (selected: Record<string, boolean>) =>
      canvasStore.setState({ view, api: { getAppState: () => ({ selectedElementIds: selected }), getSceneElements: () => terminals } as unknown as ExcalidrawImperativeAPI });

    it("shows in the palette's Drawing section once two terminals are selected, and not before", () => {
      expect([sectionOf(group, busy), labelOf(group, busy)]).toEqual(["Drawing", "Group selection"]);
      selecting({});
      expect(group.available(busy)).toBe(false);
      selecting({ a: true });
      expect(group.available(busy)).toBe(false);
      selecting({ a: true, b: true });
      expect([group.available(busy), group.disabled?.(busy)]).toEqual([true, null]);
      expect(group.available({ ...busy, project: false })).toBe(false);
    });

    it("is greyed, with its reason, when a terminal is already in a group or a group is selected", () => {
      selecting({ a: true, b: true, c: true });
      expect([group.available(busy), group.disabled?.(busy)]).toEqual([true, "a terminal is already in a group"]);
      selecting({ a: true, b: true, g1: true });
      expect(group.disabled?.(busy)).toBe("a group is selected");
    });

    it("is greyed when a node stands between the terminals: the frame would show it in the group", () => {
      terminals.push({ id: "mid", type: "embeddable", isDeleted: false, frameId: null, x: 400, y: 0, width: 720, height: 440, customData: { kind: "terminal" } });
      try {
        selecting({ a: true, b: true });
        expect([group.available(busy), group.disabled?.(busy)]).toEqual([true, "something is in the way"]);
        selecting({ a: true, b: true, mid: true });
        expect(group.disabled?.(busy)).toBeNull();
      } finally {
        terminals.pop();
      }
    });

    it("reads the ring's selection rather than Excalidraw's, which has not committed the press yet", async () => {
      selecting({});
      const ring = { ...busy, selectionIds: ["a", "b"] };
      expect(group.available(ring)).toBe(true);
      await group.run(ring);
      expect(groupSelection).toHaveBeenLastCalledWith(["a", "b"]);
      selecting({ a: true, b: true });
      await group.run(busy);
      expect(groupSelection).toHaveBeenLastCalledWith(["a", "b"]);
    });
  });

  it("offers More… in the radial menu only: Excalidraw's menu at its point", async () => {
    scene({ r1: true });
    const more = DRAWING.find((c) => c.id === "drawing.more")!;
    expect(more.available(busy)).toBe(false);
    expect(more.available({ ...busy, at: { x: 10, y: 20 } })).toBe(true);
    await more.run({ ...busy, at: { x: 10, y: 20 } });
    expect(openNativeMenuAt).toHaveBeenCalledWith({ x: 25, y: 47 });
  });
});

describe("Scene", () => {
  it("exports, imports and saves a PNG as the settings menu does", async () => {
    expect(SCENE.map((c) => labelOf(c, busy))).toEqual(["Export scene…", "Import scene…", "Export as PNG…"]);
    for (const command of SCENE) await command.run(busy);
    expect([exportCurrentScene, importIntoScene, exportCurrentPng].every((f) => vi.mocked(f).mock.calls.length === 1)).toBe(true);
  });
});
