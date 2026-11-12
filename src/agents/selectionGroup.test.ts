// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { framesFromScene, groupInfoOf, groupOf } from "@/canvas/groups";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import { linkFor, withNoteLink } from "@/nodes/note/link";
import { newNoteRect } from "@/nodes/note/placement";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { arrangedElements } from "./arrange";
import { anchorsOf } from "./attachments";
import { boundsOf, overlap, PADDING, PADDING_BOTTOM, PADDING_TOP } from "./groupLayout";
import { PANTHEONS } from "./names";
import { groupingOf, groupSelection, ungroupingOf } from "./selectionGroup";
import { isSpawnWire, orphanWires, withWire } from "./wires";
import { wirePaths } from "@/canvas/overlay/wirePaths";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "i" }, newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));

/** A terminal element at (x, y), 720 x 440 like every terminal. */
const terminal = (id: string, x: number, y: number, fields: Record<string, unknown> = {}) => ({ ...createNodeElement("terminal", { x: 0, y: 0 }), id, x, y, ...fields }) as ExcalidrawElement;
const rectangle = (id: string): ExcalidrawElement => ({ ...createNodeElement("note", { x: 0, y: 0 }), id, type: "rectangle", customData: undefined }) as ExcalidrawElement;
/** A fleet, 640 x 760, with its top-left corner at (x, y). */
const fleet = (id: string, x: number, y: number) => ({ ...createNodeElement("fleet", { x: 0, y: 0 }), id, x, y }) as ExcalidrawElement;
const frame = (id: string, fields: Record<string, unknown> = {}) => ({ id, type: "frame", isDeleted: false, frameId: null, x: 9000, y: 9000, width: 400, height: 300, ...fields }) as unknown as ExcalidrawElement;

/** A quick note beside `host` at (x, y), as src/nodes/note writes it: in no frame, its host and its place from it in its link. */
const noteAt = (id: string, host: ExcalidrawElement, x: number, y: number) => {
  const base = { ...createNodeElement("note", { x: 0, y: 0 }), id, x, y };
  return { ...base, customData: withNoteLink(base.customData, linkFor(host.id, base, host)) } as ExcalidrawElement;
};
/** The note "Quick note" writes for `host` in `elements`: where the real placement puts it. */
const quickNote = (id: string, host: ExcalidrawElement, elements: readonly ExcalidrawElement[]) => {
  const spot = newNoteRect(elements, host, NODE_SIZE.note);
  return noteAt(id, host, spot.x, spot.y);
};
const output = (id: string, x: number, y: number) => ({ ...createNodeElement("output", { x: 0, y: 0 }), id, x, y }) as ExcalidrawElement;
const boxOfAll = (elements: readonly ExcalidrawElement[], ...ids: string[]) => boundsOf(elements.filter((e) => ids.includes(e.id)));

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

describe("grouping terminals that carry quick notes", () => {
  it("is not stopped by a selected terminal's own note, written where Quick note puts it, between the two", () => {
    const a = terminal("a", 0, 0);
    const b = terminal("b", 1120, 0);
    const note = quickNote("n", a, [a, b]);
    // The real placement: right of its host, so inside the box of the two.
    expect(note).toMatchObject({ x: 736, y: 0, frameId: null });
    expect(overlap(note, boxOfAll([a, b], "a", "b"))).toBeGreaterThan(0);
    expect(groupingOf([a, b, note], ["a", "b"]).blocked).toBeNull();
    // Selected with them or not (a box selection takes it too).
    expect(groupingOf([a, b, note], ["a", "b", "n"]).blocked).toBeNull();
  });

  it("groups what Arrange laid out: it puts a terminal's note right of it, between it and the next terminal", () => {
    const a = terminal("a", 0, 0);
    const before = [a, noteAt("n", a, 736, 0), terminal("b", 3000, 2000), terminal("c", 6000, 4000)];
    const arranged = arrangedElements({ elements: before, parentOf: () => null, isMinimized: () => false, attachedTo: anchorsOf(before), aspect: 16 / 10 })!.elements;
    const at = (id: string) => arranged.find((e) => e.id === id)!;
    // One row, the note kept beside its host: it stands in the box of A and B, and of all three.
    expect(at("a").y).toBe(at("b").y);
    expect(at("n").x).toBe(at("a").x + 736);
    expect(at("b").x).toBeGreaterThan(at("n").x + at("n").width);
    expect(overlap(at("n"), boxOfAll(arranged, "a", "b"))).toBeGreaterThan(0);
    expect(groupingOf(arranged, ["a", "b"]).blocked).toBeNull();
    expect(groupingOf(arranged, ["a", "b", "c"]).blocked).toBeNull();
  });

  it("still refuses what the terminals do not carry: another terminal's note, an agent's output, a note whose host is gone", async () => {
    const a = terminal("a", 0, 0);
    const b = terminal("b", 1120, 0);
    const far = terminal("far", 0, 3000);
    // Another terminal's note, moved by hand between the two: a drag of the group would leave it behind.
    expect(groupingOf([a, b, far, noteAt("n", far, 736, 0)], ["a", "b"])).toMatchObject({ blocked: "inTheWay" });
    // What A showed (show_output) is attached to it, but nothing keeps it beside A.
    await nodesStore.getState().create("o", { workspaceId: "w1", kind: "output", payload: { title: "", source: "a", ui: "", updatedAt: 0 } });
    const shown = output("o", 736, 0);
    expect(anchorsOf([a, b, shown])(shown)).toEqual({ anchor: "a" });
    expect(groupingOf([a, b, shown], ["a", "b"])).toMatchObject({ blocked: "inTheWay" });
    // Its host closed: the note stays where it is, no terminal's any more.
    const gone = terminal("gone", 0, 3000, { isDeleted: true });
    expect(groupingOf([a, b, gone, noteAt("n", gone, 736, 0)], ["a", "b"])).toMatchObject({ blocked: "inTheWay" });
  });

  it("refuses a node beside a carried note that pokes out of the terminals' box: the frame goes around the note, so around that node too", () => {
    const a = terminal("a", 0, 0);
    const b = terminal("b", 1120, 0);
    // A's stack of three: the third runs from 432 to 632, past the terminals' 440.
    const notes = [noteAt("n1", a, 736, 0), noteAt("n2", a, 736, 216), noteAt("n3", a, 736, 432)];
    expect(groupingOf([a, b, ...notes], ["a", "b"]).blocked).toBeNull();
    // Under B, level with the third note: inside the frame that holds that note.
    expect(groupingOf([a, b, ...notes, terminal("under", 1120, 500)], ["a", "b"])).toMatchObject({ blocked: "inTheWay" });
    // Without the third note the box ends at 440: that terminal stays outside.
    expect(groupingOf([a, b, notes[0], notes[1], terminal("under", 1120, 500)], ["a", "b"]).blocked).toBeNull();
  });

  it("fits the frame around the terminals and the notes they carry in their box; a note stays in no frame, as beside any terminal", () => {
    const a = terminal("a", 0, 0);
    const b = terminal("b", 1120, 0);
    const notes = [noteAt("n1", a, 736, 0), noteAt("n2", a, 736, 216), noteAt("n3", a, 736, 432)];
    // B's own note, right of the box: the frame is not stretched to it, as before.
    const right = noteAt("r", b, 1120 + 720 + 16, 0);
    scene = [a, b, ...notes, right];
    const id = groupSelection(["a", "b"])!;
    const made = scene.find((e) => e.id === id)!;
    // The terminals end at 440, the third note at 632.
    expect([made.x, made.y, made.width, made.height]).toEqual([-PADDING, -PADDING_TOP, 1840 + 2 * PADDING, 632 + PADDING_TOP + PADDING_BOTTOM]);
    expect(framesFromScene(scene).find((f) => f.id === id)).toMatchObject({ memberIds: ["a", "b"] });
    // The notes are untouched: the note watch keeps each beside its host, and takes any note out of a frame.
    for (const note of [...notes, right]) expect(scene).toContain(note);
  });
});

describe("ungrouping a group whose terminals carry quick notes", () => {
  const group = (id: string) => frame(id, { x: -32, y: -48, width: 1904, height: 600, groupIds: [], customData: { dummyplane: { kind: "group", role: "general", pantheon: "egyptian" } } });
  const a = terminal("a", 0, 0, { frameId: "g" });
  const b = terminal("b", 1120, 0, { frameId: "g" });
  const loose = terminal("loose", 5000, 0);
  // In no frame, as every quick note: A's stands in the group's frame, between its terminals.
  const elements = [a, b, group("g"), noteAt("n", a, 736, 0), loose, noteAt("m", loose, 5736, 0)];

  it("does not count a member's note as outside the group: a box around the group takes it too", () => {
    expect(elements.find((e) => e.id === "n")!.frameId).toBeNull();
    for (const ids of [["a", "n"], ["g", "n"], ["g", "a", "b", "n"]]) {
      expect(ungroupingOf(elements, ids), ids.join()).toEqual({ kind: "group", groupId: "g", blocked: null });
    }
  });

  it("still never ungroups from a note alone, and still refuses a terminal outside the group or its note", () => {
    expect(ungroupingOf(elements, ["n"])).toBeNull();
    expect(ungroupingOf(elements, ["a", "loose"])).toMatchObject({ blocked: "outsideGroup" });
    expect(ungroupingOf(elements, ["a", "m"])).toMatchObject({ blocked: "outsideGroup" });
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

  it("keeps the spawn wire between an agent and the sub-agent it spawned: live, bound to both, outside the frame", () => {
    // spawn_agent's tree: the child GROUP_GAP right of its parent, level with its top, the wire from parent to child.
    const spawned = withWire([terminal("parent", 0, 0), terminal("child", 816, 0)], "parent", "child", "calm", true);
    const wire = spawned[spawned.length - 1];
    scene = spawned;
    // A box selection holds the wire too.
    const id = groupSelection(["parent", "child", wire.id])!;
    const kept = scene.find((e) => e.id === wire.id)!;
    expect(kept).toBe(wire);
    expect(kept).toMatchObject({ isDeleted: false, frameId: null, startBinding: { elementId: "parent" }, endBinding: { elementId: "child" } });
    expect(isSpawnWire(kept)).toBe(true);
    expect(framesFromScene(scene).find((f) => f.id === id)).toMatchObject({ memberIds: ["parent", "child"] });
    // Nothing for the wire upkeep to delete: both ends are still live terminals.
    expect(orphanWires(scene)).toEqual([]);
    expect(wirePaths(scene).map((p) => p.id)).toEqual([wire.id]);
  });

  it("does nothing for less than two terminals, or a selection that cannot be grouped", () => {
    scene = [frame("g1"), terminal("a", 0, 0, { frameId: "g1" }), terminal("b", 800, 0), terminal("c", 1600, 0)];
    expect(groupSelection(["b"])).toBeNull();
    expect(groupSelection(["a", "b"])).toBeNull();
    expect(groupSelection([])).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
