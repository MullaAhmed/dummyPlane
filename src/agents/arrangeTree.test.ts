import { describe, expect, it, vi } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createGroupFrame } from "@/canvas/groups";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import { arrangedElements, type ArrangeInput } from "./arrange";
import { anchorsOf } from "./attachments";
import { COLUMN_GAP, GROUP_GAP, NODE_GAP, PADDING, PADDING_BOTTOM, PADDING_TOP } from "./groupLayout";
import { isDownTree, isPinned, layoutSpawnTree } from "./spawnLayout";
import { rerouteWires, wireFlagsOf, withWire, withWireBetween } from "./wires";

vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn().mockResolvedValue(undefined), saveNode: vi.fn().mockResolvedValue(undefined) }));

const { width: W, height: H } = NODE_SIZE.terminal;

const node = (kind: "terminal" | "fleet" | "kanban", id: string, x: number, y: number, fields: Partial<ExcalidrawElement> = {}) =>
  ({ ...(createNodeElement(kind, { x: 0, y: 0 }) as unknown as ExcalidrawElement), id, x, y, ...fields }) as ExcalidrawElement;

/** Who spawned whom, for every test. */
const spawned: Record<string, string> = { k1: "root", k2: "root", k3: "k1" };
const parentOf = (id: string) => spawned[id] ?? null;

const tree = (rest: Partial<ArrangeInput> = {}): ArrangeInput => ({ parentOf, isMinimized: () => false, aspect: 16 / 10, layout: "tree", elements: [], ...rest });

/** The scene as arrangeWorkspace writes it: arranged, the wires of what moved routed again. */
function arranged(input: ArrangeInput): ExcalidrawElement[] {
  const result = arrangedElements(input);
  expect(result).not.toBeNull();
  return [...rerouteWires(result!.elements, result!.movedNodeIds)];
}

const at = (elements: readonly ExcalidrawElement[], id: string) => {
  const e = elements.find((el) => el.id === id)!;
  return { x: e.x, y: e.y };
};

/** What the spawn reflow does after a spawn, a close or an undo (./spawnTree.ts): a marked root lays its tree out downward. */
const reflow = (elements: readonly ExcalidrawElement[], rootId: string) => {
  const byId = new Map(elements.map((e) => [e.id, e]));
  return layoutSpawnTree(elements, parentOf, rootId, (id) => isDownTree(byId.get(id)));
};

/** A spawn tree as the flowchart left it, right of its root, one child moved by hand. */
function flowchart(): ExcalidrawElement[] {
  let scene = [
    node("terminal", "root", 0, 0),
    node("terminal", "k1", W + GROUP_GAP, 0),
    node("terminal", "k2", W + GROUP_GAP, H + 200, { customData: { ...createNodeElement("terminal", { x: 0, y: 0 }).customData, pinned: true } }),
    node("terminal", "k3", 2 * (W + GROUP_GAP), 0),
  ];
  for (const [child, parent] of Object.entries(spawned)) scene = withWire(scene, parent, child, "calm", true);
  return scene;
}

describe("Arrange as a tree", () => {
  it("puts a spawn tree's children under their parent, in a row, and their own under them, the wires running down", () => {
    const after = arranged(tree({ elements: flowchart() }));
    const root = at(after, "root");
    const row = root.y + H + GROUP_GAP;
    expect(at(after, "k1")).toEqual({ x: root.x, y: row });
    expect(at(after, "k2")).toEqual({ x: root.x + W + COLUMN_GAP, y: row });
    expect(at(after, "k3")).toEqual({ x: root.x, y: row + H + GROUP_GAP });
    // The node moved by hand is laid out with the rest; the root is marked, so its tree stays downward.
    expect(isPinned(after.find((e) => e.id === "k2")!)).toBe(false);
    expect(isDownTree(after.find((e) => e.id === "root")!)).toBe(true);
    for (const wire of after.filter((e) => e.type === "arrow") as ExcalidrawArrowElement[]) {
      expect(wireFlagsOf(wire), wire.endBinding!.elementId).toMatchObject({ spawn: true, down: true });
    }
  });

  it("stands as it is: arranged again, or the tree reflowed by the next spawn, nothing moves", () => {
    const after = arranged(tree({ elements: flowchart() }));
    expect(arrangedElements(tree({ elements: after }))).toBeNull();
    expect(reflow(after, "root")).toBeNull();
    // Without its root's mark, the next spawn would take it back into a flowchart.
    expect(layoutSpawnTree(after, parentOf, "root")).not.toBeNull();
    // A new sub-agent joins the tree downward too, under its parent, the others staying where they are.
    const kid = node("terminal", "k4", 9000, 9000);
    spawned.k4 = "root";
    try {
      const grown = reflow(withWire([...after, kid], "root", "k4", "calm", true), "k4")!;
      expect(at(grown, "k4")).toEqual({ x: at(after, "root").x + 2 * (W + COLUMN_GAP), y: at(after, "k1").y });
      for (const id of ["root", "k1", "k2", "k3"]) expect(at(grown, id), id).toEqual(at(after, id));
    } finally {
      delete spawned.k4;
    }
  });

  it("stands nodes nothing joins as roots of their own, side by side", () => {
    const after = arranged(tree({ elements: [node("terminal", "a", 5000, 300), node("terminal", "b", 0, 0), node("terminal", "c", 2000, 4000)], aspect: 4 }));
    const [b, a, c] = ["b", "a", "c"].map((id) => at(after, id));
    expect(a).toEqual({ x: b.x + W + NODE_GAP, y: b.y });
    expect(c).toEqual({ x: a.x + W + NODE_GAP, y: b.y });
  });

  it("hangs what no agent opened under the other end of its wire: a Fleet's agents under it, a board under its agent", () => {
    let scene = [
      node("fleet", "fleet", 0, 0),
      node("terminal", "a1", 4000, 0),
      node("terminal", "a2", 8000, 0),
      node("terminal", "agent", 0, 3000),
      node("kanban", "board", 6000, 3000),
    ];
    // The agent's wire starts at it, the Fleet's at the agent: a Fleet's wire reads from the Fleet either way round.
    scene = withWireBetween(withWireBetween(withWireBetween(scene, "fleet", "a1", "calm"), "a2", "fleet", "calm"), "agent", "board", "calm");
    const after = arranged(tree({ elements: scene, aspect: 4 }));
    const fleet = at(after, "fleet");
    const row = fleet.y + NODE_SIZE.fleet.height + GROUP_GAP;
    expect(at(after, "a1")).toEqual({ x: fleet.x, y: row });
    expect(at(after, "a2")).toEqual({ x: fleet.x + W + COLUMN_GAP, y: row });
    const agent = at(after, "agent");
    expect(at(after, "board")).toEqual({ x: agent.x, y: agent.y + H + GROUP_GAP });
    expect(arrangedElements(tree({ elements: after, aspect: 4 }))).toBeNull();
  });

  it("never hangs a sub-agent by a wire: its place is under the agent that opened it", () => {
    let scene = flowchart();
    scene = withWireBetween([...scene, node("terminal", "peer", 0, 5000)], "peer", "k1", "calm");
    const after = arranged(tree({ elements: scene, aspect: 4 }));
    expect(at(after, "k1")).toEqual({ x: at(after, "root").x, y: at(after, "root").y + H + GROUP_GAP });
  });

  it("lays a group's family out as a tree inside its frame, beside a member nothing joins, the frame fitted", () => {
    const frame = createGroupFrame({ x: 0, y: 0, width: 4000, height: 3000 }, "Batman's sub-agents", { role: "general", pantheon: "norse" }) as unknown as ExcalidrawElement;
    const scene = [
      ...flowchart().map((e) => (e.type === "arrow" ? e : { ...e, x: e.x + PADDING, y: e.y + PADDING_TOP, frameId: frame.id })),
      node("terminal", "lone", PADDING, 2000, { frameId: frame.id }),
      frame,
    ];
    const after = arranged(tree({ elements: scene, only: [frame.id], aspect: 4 }));
    const root = at(after, "root");
    expect(root).toEqual({ x: PADDING, y: PADDING_TOP });
    expect(at(after, "k1")).toEqual({ x: root.x, y: root.y + H + GROUP_GAP });
    // The tree is two terminals wide (k1 and k2 under the root): the lone member stands right of it.
    expect(at(after, "lone")).toEqual({ x: root.x + 2 * W + 2 * COLUMN_GAP, y: root.y });
    const fitted = after.find((e) => e.id === frame.id)!;
    expect({ width: fitted.width, height: fitted.height }).toEqual({
      width: 2 * PADDING + 3 * W + 2 * COLUMN_GAP,
      height: PADDING_TOP + 3 * H + 2 * GROUP_GAP + PADDING_BOTTOM,
    });
    expect(reflow(after, "root")).toBeNull();
    expect(arrangedElements(tree({ elements: after, only: [frame.id], aspect: 4 }))).toBeNull();
  });

  it("leaves a folded group as it is: its hidden family is neither laid out nor marked", () => {
    const frame = createGroupFrame({ x: 0, y: 0, width: 4000, height: 3000 }, "Batman's sub-agents", { role: "general", pantheon: "norse" }) as unknown as ExcalidrawElement;
    const folded = { ...frame, customData: { dummyplane: { ...(frame.customData!.dummyplane as object), folded: true } } } as ExcalidrawElement;
    const scene = [...flowchart().map((e) => (e.type === "arrow" ? e : { ...e, x: e.x + PADDING, y: e.y + PADDING_TOP, frameId: frame.id, locked: true })), folded];
    expect(arrangedElements(tree({ elements: scene, only: [frame.id] }))).toBeNull();
    const canvas = arrangedElements(tree({ elements: [...scene, node("terminal", "far", 9000, 9000)] }));
    const kept = canvas?.elements ?? scene;
    const shift = { x: at(kept, "root").x - at(scene, "root").x, y: at(kept, "root").y - at(scene, "root").y };
    for (const id of ["k1", "k2", "k3"]) expect(at(kept, id), id).toEqual({ x: at(scene, id).x + shift.x, y: at(scene, id).y + shift.y });
    expect(isDownTree(kept.find((e) => e.id === "root")!)).toBe(false);
  });

  it("keeps a tree that carries an output as it stands: the layout would leave the output behind, over a sibling", () => {
    const output = node("kanban", "out", 3 * (W + GROUP_GAP), 0, { customData: { ...createNodeElement("kanban", { x: 0, y: 0 }).customData, attachedTo: "k3" } });
    const scene = [...flowchart(), output];
    const result = arrangedElements(tree({ elements: scene, attachedTo: anchorsOf(scene) }));
    const kept = result?.elements ?? scene;
    for (const id of ["k1", "k2", "k3", "out"]) {
      expect({ x: at(kept, id).x - at(kept, "root").x, y: at(kept, id).y - at(kept, "root").y }, id).toEqual({ x: at(scene, id).x - at(scene, "root").x, y: at(scene, id).y - at(scene, "root").y });
    }
    expect(isDownTree(kept.find((e) => e.id === "root")!)).toBe(false);
  });
});

describe("the user's Arrange in another layout, after the tree", () => {
  /** The flowchart arranged as a tree: laid out downward, its root marked. */
  const laidDown = () => arranged(tree({ elements: flowchart() }));
  /** The user's Arrange in the grid; Auto-arrange's has no `clearTreeMarks`. */
  const grid = (rest: Partial<ArrangeInput> = {}) => tree({ layout: "grid", clearTreeMarks: true, ...rest });
  const marks = (elements: readonly ExcalidrawElement[]) => elements.filter((e) => !e.isDeleted && isDownTree(e)).map((e) => e.id);
  const shape = (elements: readonly ExcalidrawElement[]) =>
    Object.fromEntries(["k1", "k2", "k3"].map((id) => [id, { x: at(elements, id).x - at(elements, "root").x, y: at(elements, id).y - at(elements, "root").y }]));

  it("lays the tree out as a flowchart again and takes its mark off, in the same change", () => {
    const down = laidDown();
    const after = arranged(grid({ elements: down }));
    expect(marks(after)).toEqual([]);
    // Right of its parent again: the flowchart reads left to right.
    const root = at(after, "root");
    expect(at(after, "k1")).toEqual({ x: root.x + W + GROUP_GAP, y: root.y });
    expect(at(after, "k3").x).toBeGreaterThan(at(after, "k1").x);
    for (const wire of after.filter((e) => e.type === "arrow")) expect(wireFlagsOf(wire).down, wire.id).toBeFalsy();
    // What the next sub-agent, a close or an undo would lay out: the same, nothing moves.
    expect(reflow(after, "root")).toBeNull();
    expect(arrangedElements(grid({ elements: after }))).toBeNull();
  });

  it("leaves the tree downward and marked for Auto-arrange: a group arranged as a tree stays one", () => {
    const down = laidDown();
    const kept = arrangedElements(tree({ elements: down, layout: "grid" }))?.elements ?? down;
    expect(marks(kept)).toEqual(["root"]);
    expect(shape(kept)).toEqual(shape(down));
  });

  it("keeps the mark and the shape of a tree a selection leaves out", () => {
    const down = laidDown();
    const scene = [...down, node("terminal", "a", 9000, 0), node("terminal", "b", 14000, 6000)];
    const kept = arrangedElements(grid({ elements: scene, only: ["a", "b"], scope: "selection" }))?.elements ?? scene;
    expect(marks(kept)).toEqual(["root"]);
    for (const id of ["root", "k1", "k2", "k3"]) expect(at(kept, id), id).toEqual(at(down, id));
  });

  it("keeps a Manager's tree downward, as its next sub-agent would, and takes the mark off though nothing moves", () => {
    const down = laidDown();
    const result = arrangedElements(grid({ elements: down, isDownRoot: (id) => id === "root" }));
    expect(result).not.toBeNull();
    expect(marks(result!.elements)).toEqual([]);
    for (const id of ["root", "k1", "k2", "k3"]) expect(at(result!.elements, id), id).toEqual(at(down, id));
  });

  it("takes off a mark down the tree too: a root an undo put under its spawner again", () => {
    const down = laidDown().map((e) => (e.id === "k1" ? ({ ...e, customData: { ...e.customData, downTree: true } } as ExcalidrawElement) : e));
    const after = arranged(grid({ elements: down }));
    expect(marks(after)).toEqual([]);
    expect(reflow(after, "root")).toBeNull();
  });
});
