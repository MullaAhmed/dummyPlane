import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { NODE_SIZE, toStoredKind, type NodeKind } from "@/canvas/nodeElement";
import { arrangeWorkspace } from "./arrangeCanvas";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", NEVER: "NEVER" } }));
vi.mock("@/nodes/terminal/minimize", () => ({ isMinimized: () => false }));
vi.mock("./spawnTree", () => ({ spawnedBy: () => null }));

const updateScene = vi.fn();
const write = vi.fn();
let shown = true;
let scene: readonly ExcalidrawElement[] = [];
vi.mock("@/canvas/canvasStore", () => ({
  canvasStore: { getState: () => ({ api: { updateScene }, view: { width: 1600, height: 1000 } }) },
}));
vi.mock("./sceneAccess", () => ({ sceneAccess: () => ({ shown, elements: () => scene, write }) }));

const element = (id: string, type: string, x: number, y: number, width: number, height: number, fields: Record<string, unknown> = {}) =>
  ({ id, type, x, y, width, height, angle: 0, isDeleted: false, frameId: null, groupIds: [], version: 1, ...fields }) as unknown as ExcalidrawElement;
const node = (id: string, kind: NodeKind, x: number, y: number) =>
  element(id, "embeddable", x, y, NODE_SIZE[kind].width, NODE_SIZE[kind].height, { frameId: "g", customData: { kind: toStoredKind(kind) } });

/** A group of a terminal, a kanban, a drawn rectangle with its text and an arrow from it to the terminal, all out of place. */
function messyGroup(): ExcalidrawElement[] {
  return [
    node("t", "terminal", 900, 700),
    node("k", "kanban", 2000, 100),
    element("r", "rectangle", 100, 100, 50, 50, { frameId: "g" }),
    element("l", "text", 105, 110, 40, 20, { frameId: "g", containerId: "r" }),
    element("a", "arrow", 150, 125, 750, 795, {
      frameId: "g",
      points: [
        [0, 0],
        [750, 795],
      ],
      startBinding: { elementId: "r", focus: 0, gap: 0 },
      endBinding: { elementId: "t", focus: 0, gap: 0 },
      elbowed: false,
    }),
    element("g", "frame", 0, 0, 4000, 3000, { customData: { dummyplane: { kind: "group", role: "general", pantheon: "olympus" } } }),
  ];
}

describe("arrangeWorkspace", () => {
  beforeEach(() => {
    updateScene.mockClear();
    write.mockClear();
    shown = true;
  });

  it("arranges a group's every member in one undoable step, leaving the scene before it intact for the undo", () => {
    scene = messyGroup();
    const before = structuredClone(scene);
    expect(arrangeWorkspace("w", { undoable: true })).toBe(true);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const { elements, captureUpdate } = updateScene.mock.calls[0][0] as { elements: ExcalidrawElement[]; captureUpdate: string };
    expect(captureUpdate).toBe("IMMEDIATELY");
    // Every member moved (the frame was fitted), each a new version of itself: Excalidraw's undo takes them all back at once.
    for (const id of ["t", "k", "r", "l", "a", "g"]) {
      const now = elements.find((e) => e.id === id)!;
      const was = before.find((e) => e.id === id)!;
      expect(now).not.toBe(scene.find((e) => e.id === id));
      expect(now.version).toBeGreaterThan(was.version);
      expect({ x: now.x, y: now.y, width: now.width, height: now.height }).not.toEqual({ x: was.x, y: was.y, width: was.width, height: was.height });
    }
    // What undo restores is untouched: the scene before the arrangement, as it was.
    expect(scene).toEqual(before);
  });

  it("arranges for Auto-arrange outside the undo history", () => {
    scene = messyGroup();
    expect(arrangeWorkspace("w", { undoable: false })).toBe(true);
    expect(updateScene.mock.calls[0][0]).toMatchObject({ captureUpdate: "NEVER" });
  });

  it("writes a scene not on screen, and reports nothing moved when all stands arranged", () => {
    shown = false;
    scene = messyGroup();
    expect(arrangeWorkspace("w", { undoable: true })).toBe(true);
    expect(updateScene).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    scene = write.mock.calls[0][0] as ExcalidrawElement[];
    expect(arrangeWorkspace("w", { undoable: true })).toBe(false);
  });
});
