import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createNodeElement } from "@/canvas/nodeElement";
import { nodesStore } from "@/store/nodes";
import { arrangedElements } from "./arrange";
import { anchorsOf, missionAnchor } from "./attachments";
import { COLUMN_GAP, GROUP_GAP } from "./groupLayout";
import { layoutSpawnTree } from "./spawnLayout";
import { rerouteWires, wireFlagsOf, withWire, withWireBetween } from "./wires";

vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn().mockResolvedValue(undefined), saveNode: vi.fn().mockResolvedValue(undefined) }));

const node = (kind: "terminal" | "fleet" | "kanban", id: string, x: number, y: number) =>
  ({ ...(createNodeElement(kind, { x: 0, y: 0 }) as unknown as ExcalidrawElement), id, x, y }) as ExcalidrawElement;

const spawned: Record<string, string> = { m0: "mgr", m1: "mgr", m2: "mgr", m3: "mgr", m4: "mgr", a1: "m0" };
const parentOf = (id: string) => spawned[id] ?? null;
const isManager = (id: string) => id === "mgr";

/** A Fleet, its mission's board right of it, the Manager under the board and its team under it, as the go-ahead leaves them; a lone agent far off. */
function missionScene(): ExcalidrawElement[] {
  let scene: ExcalidrawElement[] = [
    node("terminal", "lone", -9000, -9000),
    node("fleet", "fleet", 0, 0),
    node("kanban", "board", 736, 0),
    node("terminal", "mgr", 736, 496),
    ...Object.keys(spawned).map((id) => node("terminal", id, 20000, 20000)),
  ];
  scene = withWireBetween(withWireBetween(scene, "fleet", "board", "calm"), "board", "mgr", "calm");
  for (const [child, parent] of Object.entries(spawned)) scene = withWire(scene, parent, child, "calm", true);
  return layoutSpawnTree(scene, parentOf, "mgr", isManager)!;
}

beforeEach(() => {
  const terminal = (payload: object) => ({ workspaceId: "w", kind: "terminal", payload: { title: "", name: "", agent: "claude", cwd: "/", shell: "default", command: "", ...payload } });
  nodesStore.setState({
    nodes: {
      fleet: { workspaceId: "w", kind: "fleet", payload: { mission: { board: "board", manager: "mgr" } } },
      board: { workspaceId: "w", kind: "kanban", payload: {} },
      mgr: terminal({ role: "manager", fleet: "fleet" }),
      lone: terminal({}),
      ...Object.fromEntries(Object.entries(spawned).map(([id, parent]) => [id, terminal({ spawnedBy: parent })])),
    } as never,
  });
});

describe("a mission's anchors (missionAnchor)", () => {
  it("attaches the board to its Fleet and the Manager to the board, or to the Fleet once the board is gone", () => {
    const scene = missionScene();
    const live = new Map(scene.map((e) => [e.id, e]));
    const element = (id: string) => live.get(id)!;
    expect(missionAnchor(element("board"), live)).toBe("fleet");
    expect(missionAnchor(element("mgr"), live)).toBe("board");
    expect(missionAnchor(element("m0"), live)).toBeNull();
    expect(missionAnchor(element("fleet"), live)).toBeNull();
    live.delete("board");
    expect(missionAnchor(element("mgr"), live)).toBe("fleet");
  });
});

describe("a mission as the go-ahead lays it out", () => {
  it("puts the team in rows under the Manager, clear of the Fleet and the board, no wire through a node", () => {
    const scene = missionScene();
    const at = (id: string) => scene.find((e) => e.id === id)!;
    const manager = at("mgr");
    const row0 = manager.y + manager.height + GROUP_GAP;
    for (let i = 0; i < 4; i++) expect({ x: at(`m${i}`).x, y: at(`m${i}`).y }, `m${i}`).toEqual({ x: manager.x + i * (manager.width + COLUMN_GAP), y: row0 });
    const nodes = scene.filter((e) => e.type === "embeddable");
    for (const wire of scene.filter((e) => e.type === "arrow") as ExcalidrawArrowElement[]) {
      const points = wire.points.map(([x, y]) => ({ x: wire.x + x, y: wire.y + y }));
      for (let i = 1; i < points.length; i++) {
        const [a, b] = [points[i - 1], points[i]];
        for (const n of nodes) {
          const through = Math.min(a.x, b.x) < n.x + n.width && Math.max(a.x, b.x) > n.x && Math.min(a.y, b.y) < n.y + n.height && Math.max(a.y, b.y) > n.y;
          expect(through, `${wire.endBinding?.elementId} through ${n.id}`).toBe(false);
        }
      }
    }
  });
});

describe("Arrange with a mission on the canvas", () => {
  it("moves the Fleet, its board, its Manager and the Manager's tree as one block, the tree's shape and routes kept", () => {
    const before = missionScene();
    const result = arrangedElements({ elements: before, parentOf, isMinimized: () => false, attachedTo: anchorsOf(before), aspect: 16 / 10 })!;
    expect(result).not.toBeNull();
    const after = rerouteWires(result.elements, result.movedNodeIds);
    const at = (elements: readonly ExcalidrawElement[], id: string) => elements.find((e) => e.id === id)!;
    const shift = { x: at(after, "fleet").x - at(before, "fleet").x, y: at(after, "fleet").y - at(before, "fleet").y };
    expect(shift).not.toEqual({ x: 0, y: 0 });
    for (const id of ["board", "mgr", ...Object.keys(spawned)]) {
      expect({ x: at(after, id).x - at(before, id).x, y: at(after, id).y - at(before, id).y }, id).toEqual(shift);
    }
    // Every wire rerouted with its flags: the same route, shifted.
    const rounded = (points: readonly (readonly number[])[]) => points.map((p) => p.map((n) => Math.round(n * 1000) / 1000));
    for (const wire of before.filter((e) => e.type === "arrow") as ExcalidrawArrowElement[]) {
      const moved = at(after, wire.id) as ExcalidrawArrowElement;
      expect(moved.customData, wire.id).toEqual(wire.customData);
      expect(rounded(moved.points), wire.id).toEqual(rounded(wire.points));
      expect(moved.x - wire.x).toBeCloseTo(shift.x, 6);
      expect(moved.y - wire.y).toBeCloseTo(shift.y, 6);
    }
    expect(wireFlagsOf(at(after, before.find((e) => (e as ExcalidrawArrowElement).endBinding?.elementId === "m4")!.id))).toMatchObject({ down: true, riser: true });
    // The tree as Arrange left it is laid out already.
    expect(layoutSpawnTree(after, parentOf, "mgr", isManager)).toBeNull();
  });
});
