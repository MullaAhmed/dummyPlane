// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { framesFromScene, groupInfoOf, groupOf } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { PADDING, PADDING_TOP } from "./groupLayout";
import { groupingOf, groupSelection } from "./selectionGroup";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "i" }, newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));

/** A terminal element at (x, y), 720 x 440 like every terminal. */
const terminal = (id: string, x: number, y: number, fields: Record<string, unknown> = {}) => ({ ...createNodeElement("terminal", { x: 0, y: 0 }), id, x, y, ...fields }) as ExcalidrawElement;
const rectangle = (id: string): ExcalidrawElement => ({ ...createNodeElement("note", { x: 0, y: 0 }), id, type: "rectangle", customData: undefined }) as ExcalidrawElement;
const fleet = (id: string): ExcalidrawElement => ({ ...createNodeElement("orchestrator", { x: 0, y: 0 }), id });
const frame = (id: string, fields: Record<string, unknown> = {}) => ({ id, type: "frame", isDeleted: false, frameId: null, ...fields }) as unknown as ExcalidrawElement;

interface UpdateArgs {
  elements: ExcalidrawElement[];
  appState: Record<string, unknown>;
  captureUpdate: string;
}
let scene: ExcalidrawElement[];
let updates: UpdateArgs[];

beforeEach(() => {
  scene = [];
  updates = [];
  const api = {
    getSceneElements: () => scene.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => scene,
    updateScene: (args: UpdateArgs) => {
      updates.push(args);
      scene = args.elements;
    },
  };
  canvasStore.setState({ api: api as unknown as ExcalidrawImperativeAPI, frames: [] });
  workspacesStore.setState({ activeId: "w1", workspaces: [] } as never);
  uiStore.getState().setRenamingGroup(null);
});

describe("what a selection can be grouped into", () => {
  it("takes the terminals of the selection, in scene order, and leaves a fleet and the drawings out", () => {
    const elements = [terminal("a", 0, 0), rectangle("r"), fleet("chef"), terminal("b", 800, 0), terminal("c", 1600, 0)];
    const grouping = groupingOf(elements, ["b", "r", "chef", "a"]);
    expect(grouping.terminals.map((t) => t.id)).toEqual(["a", "b"]);
    expect(grouping.blocked).toBeNull();
  });

  it("counts a single terminal as one: the caller needs two", () => {
    expect(groupingOf([terminal("a", 0, 0), terminal("b", 800, 0)], ["a"]).terminals).toHaveLength(1);
  });

  it("refuses a terminal already in a group, rather than pulling it out of its group", () => {
    const elements = [frame("g1"), terminal("a", 0, 0, { frameId: "g1" }), terminal("b", 800, 0)];
    expect(groupingOf(elements, ["a", "b"])).toMatchObject({ blocked: "alreadyGrouped" });
  });

  it("refuses a selection that holds a group's frame: frames never nest", () => {
    const elements = [frame("g1"), terminal("a", 0, 0), terminal("b", 800, 0)];
    expect(groupingOf(elements, ["g1", "a", "b"])).toMatchObject({ blocked: "groupSelected" });
  });

  it("ignores closed terminals", () => {
    const elements = [terminal("a", 0, 0), terminal("b", 800, 0, { isDeleted: true })];
    expect(groupingOf(elements, ["a", "b"]).terminals.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("grouping the selection", () => {
  const rect = { x: 100, y: 200 };

  it("wraps the terminals in a new group frame, padded, with the label's room on top", () => {
    scene = [terminal("a", rect.x, rect.y), terminal("b", 1000, 900)];
    const id = groupSelection(["a", "b"]);
    const made = scene.find((e) => e.id === id)!;
    expect(made.type).toBe("frame");
    // 720 x 440 terminals: the box runs from (100, 200) to (1720, 1340).
    expect([made.x, made.y, made.width, made.height]).toEqual([100 - PADDING, 200 - PADDING_TOP, 1620 + 2 * PADDING, 1140 + PADDING_TOP + PADDING]);
  });

  it("makes a general group of a fresh pantheon, named after it", () => {
    scene = [terminal("a", 0, 0), terminal("b", 800, 0)];
    const id = groupSelection(["a", "b"]);
    const made = scene.find((e) => e.id === id)!;
    expect(groupInfoOf(made)).toMatchObject({ role: "general", pantheon: "egyptian" });
    expect((made as ExcalidrawElement & { name: string }).name).toBe("Egyptian");
  });

  it("gives the next group another name, not the first one's", () => {
    scene = [terminal("a", 0, 0), terminal("b", 800, 0), terminal("c", 0, 2000), terminal("d", 800, 2000)];
    groupSelection(["a", "b"]);
    canvasStore.setState({ frames: framesFromScene(scene) });
    const id = groupSelection(["c", "d"]);
    const second = scene.find((e) => e.id === id)! as ExcalidrawElement & { name: string };
    expect(second.name).toBe("Greek");
  });

  it("puts the terminals in the group and nothing else: the scene knows its members, the others are untouched", () => {
    const outside = terminal("out", 5000, 0);
    const note = rectangle("r");
    scene = [terminal("a", 0, 0), note, terminal("b", 800, 0), outside];
    const id = groupSelection(["a", "b", "r"])!;
    const frames = framesFromScene(scene);
    expect(frames.find((f) => f.id === id)).toMatchObject({ memberIds: ["a", "b"] });
    expect(groupOf(frames, "a")?.id).toBe(id);
    expect(groupOf(frames, "out")).toBeNull();
    expect(scene).toContain(note);
    expect(scene).toContain(outside);
  });

  it("is one scene update that history captures at once, the frame above its children, the group selected", () => {
    scene = [terminal("a", 0, 0), terminal("b", 800, 0)];
    const id = groupSelection(["a", "b"]);
    expect(updates).toHaveLength(1);
    expect(updates[0].captureUpdate).toBe("i");
    expect(updates[0].elements.map((e) => e.id)).toEqual(["a", "b", id]);
    expect(updates[0].appState).toMatchObject({ selectedElementIds: { [id!]: true } });
  });

  it("starts naming the group on the next frame, in its label", async () => {
    scene = [terminal("a", 0, 0), terminal("b", 800, 0)];
    const id = groupSelection(["a", "b"]);
    expect(uiStore.getState().renamingGroup).toBeNull();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(uiStore.getState().renamingGroup).toBe(id);
  });

  it("does nothing for less than two terminals, or a selection that cannot be grouped", () => {
    scene = [frame("g1"), terminal("a", 0, 0, { frameId: "g1" }), terminal("b", 800, 0), terminal("c", 1600, 0)];
    expect(groupSelection(["b"])).toBeNull();
    expect(groupSelection(["a", "b"])).toBeNull();
    expect(groupSelection([])).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
