// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { framesFromScene, groupInfoOf, groupOf } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { PADDING, PADDING_BOTTOM, PADDING_TOP } from "./groupLayout";
import { PANTHEONS } from "./names";
import { groupingOf, groupSelection } from "./selectionGroup";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "i" }, newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));

/** A terminal element at (x, y), 720 x 440 like every terminal. */
const terminal = (id: string, x: number, y: number, fields: Record<string, unknown> = {}) => ({ ...createNodeElement("terminal", { x: 0, y: 0 }), id, x, y, ...fields }) as ExcalidrawElement;
const rectangle = (id: string): ExcalidrawElement => ({ ...createNodeElement("note", { x: 0, y: 0 }), id, type: "rectangle", customData: undefined }) as ExcalidrawElement;
/** A fleet, 640 x 760, with its top-left corner at (x, y). */
const fleet = (id: string, x: number, y: number) => ({ ...createNodeElement("fleet", { x: 0, y: 0 }), id, x, y }) as ExcalidrawElement;
const frame = (id: string, fields: Record<string, unknown> = {}) => ({ id, type: "frame", isDeleted: false, frameId: null, x: 9000, y: 9000, width: 400, height: 300, ...fields }) as unknown as ExcalidrawElement;

interface UpdateArgs {
  elements: ExcalidrawElement[];
  appState: Record<string, unknown>;
  captureUpdate: string;
}
let scene: ExcalidrawElement[];
let updates: UpdateArgs[];
const scrollToContent = vi.fn();
/** A canvas of 1600 x 900, scrolled to the scene's origin, at 100 %. */
const view = { scrollX: 0, scrollY: 0, zoom: 1, width: 1600, height: 900, offsetLeft: 0, offsetTop: 0, tool: "selection", selectedIds: [], editingFrame: null, mode: null };

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

beforeEach(async () => {
  // The previous test's naming request runs on a frame: let it land before the mocks are reset.
  await nextFrame();
  scene = [];
  updates = [];
  const api = {
    getSceneElements: () => scene.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => scene,
    updateScene: (args: UpdateArgs) => {
      updates.push(args);
      scene = args.elements;
    },
    scrollToContent,
  };
  mockIPC(() => undefined);
  scrollToContent.mockClear();
  canvasStore.setState({ api: api as unknown as ExcalidrawImperativeAPI, frames: [], view });
  workspacesStore.setState({ activeId: "w1", workspaces: [] } as never);
  uiStore.getState().setRenamingGroup(null);
});

describe("what a selection can be grouped into", () => {
  it("takes the terminals of the selection, in scene order, and leaves a fleet and the drawings out", () => {
    const elements = [terminal("a", 0, 0), rectangle("r"), fleet("chef", 3000, 0), terminal("b", 800, 0), terminal("c", 1600, 0)];
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

  it("refuses a node or group that stands inside the terminals' box: the frame would show it in the group, and a drag leave it behind", () => {
    const between = [terminal("a", 0, 0), terminal("mid", 800, 0), terminal("b", 1600, 0)];
    expect(groupingOf(between, ["a", "b"])).toMatchObject({ blocked: "inTheWay" });
    expect(groupingOf(between, ["a", "mid", "b"]).blocked).toBeNull();
    expect(groupingOf([terminal("a", 0, 0), terminal("b", 800, 0), frame("g1", { x: 100, y: 100 })], ["a", "b"])).toMatchObject({ blocked: "inTheWay" });
    // Selected, but not a member: still inside, still refused.
    expect(groupingOf([terminal("a", 0, 0), terminal("b", 800, 0), fleet("chef", 200, 200)], ["a", "b", "chef"])).toMatchObject({ blocked: "inTheWay" });
  });

  it("lets a neighbour 24 apart stay outside, and drawings and wires lie wherever they are", () => {
    // Terminals are placed NODE_GAP apart: the frame's padding may run over a neighbour, its box does not.
    const row = [terminal("a", 0, 0), terminal("b", 744, 0), terminal("next", 1488, 0), rectangle("r")];
    expect(groupingOf(row, ["a", "b"]).blocked).toBeNull();
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
    expect([made.x, made.y, made.width, made.height]).toEqual([100 - PADDING, 200 - PADDING_TOP, 1620 + 2 * PADDING, 1140 + PADDING_TOP + PADDING_BOTTOM]);
  });

  it("makes a general group of a fresh pantheon, named after it", () => {
    scene = [terminal("a", 0, 0), terminal("b", 800, 0)];
    const id = groupSelection(["a", "b"]);
    const made = scene.find((e) => e.id === id)!;
    expect(groupInfoOf(made)).toMatchObject({ role: "general", pantheon: PANTHEONS[0].id });
    expect((made as ExcalidrawElement & { name: string }).name).toBe(PANTHEONS[0].label);
  });

  it("gives the next group another name, not the first one's", () => {
    scene = [terminal("a", 0, 0), terminal("b", 800, 0), terminal("c", 0, 2000), terminal("d", 800, 2000)];
    groupSelection(["a", "b"]);
    canvasStore.setState({ frames: framesFromScene(scene) });
    const id = groupSelection(["c", "d"]);
    const second = scene.find((e) => e.id === id)! as ExcalidrawElement & { name: string };
    expect(second.name).toBe(PANTHEONS[1].label);
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

  it("starts naming the group on the next frame, in its label, without moving a view that shows it", async () => {
    scene = [terminal("a", 200, 200), terminal("b", 1000, 200)];
    const id = groupSelection(["a", "b"]);
    expect(uiStore.getState().renamingGroup).toBeNull();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(uiStore.getState().renamingGroup).toBe(id);
    expect(scrollToContent).not.toHaveBeenCalled();
  });

  it("brings a label that falls under the top bar into view first, the keyboard left where it is", async () => {
    // The frame's top edge is 48 above the terminals, its label 24 above that: out of the canvas, then under the bars.
    scene = [terminal("a", 0, 40), terminal("b", 800, 40)];
    const id = groupSelection(["a", "b"]);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scrollToContent).toHaveBeenCalledTimes(1);
    expect((scrollToContent.mock.calls[0][0] as { id: string }).id).toBe(id);
    expect(uiStore.getState().renamingGroup).toBe(id);
    expect(updates).toHaveLength(1);
  });

  it("makes room for a minimized terminal's open height, so it does not poke out when expanded", async () => {
    await nodesStore.getState().create("m", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: "M", name: "M", agent: "claude", cwd: "C:/code", shell: "default", command: "", minimized: true, expandedHeight: 440 },
    });
    scene = [terminal("m", 0, 0, { height: 36 }), terminal("b", 800, 0)];
    const id = groupSelection(["m", "b"]);
    // 440 tall, not the card's 36.
    expect(scene.find((e) => e.id === id)!.height).toBe(440 + PADDING_TOP + PADDING_BOTTOM);
  });

  it("does nothing for less than two terminals, or a selection that cannot be grouped", () => {
    scene = [frame("g1"), terminal("a", 0, 0, { frameId: "g1" }), terminal("b", 800, 0), terminal("c", 1600, 0)];
    expect(groupSelection(["b"])).toBeNull();
    expect(groupSelection(["a", "b"])).toBeNull();
    expect(groupSelection([])).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
