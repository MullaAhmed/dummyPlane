import { describe, expect, it } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Rect } from "@/canvas/groups";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import { COLUMN_GAP, GROUP_GAP } from "./groupLayout";
import { layoutSpawnTree, type ParentOf } from "./spawnLayout";
import { downLayout, ROW_SIZE } from "./treeLayout";
import { elbowWires, isSpawnWire, rerouteWires, wireFlagsOf, withWire } from "./wires";

const { width: W, height: H } = NODE_SIZE.terminal;

function terminal(id: string, x = 9000, y = 9000, extra: Partial<ExcalidrawElement> = {}): ExcalidrawElement {
  const e = createNodeElement("terminal", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
  return { ...e, id, x, y, ...extra } as ExcalidrawElement;
}

const isManager = (id: string) => id === "mgr";
const at = (elements: readonly ExcalidrawElement[], id: string) => elements.find((e) => e.id === id)!;
const pos = (elements: readonly ExcalidrawElement[], id: string) => ({ x: at(elements, id).x, y: at(elements, id).y });
const wireTo = (elements: readonly ExcalidrawElement[], id: string) =>
  elements.find((e) => !e.isDeleted && e.type === "arrow" && (e as ExcalidrawArrowElement).endBinding?.elementId === id) as ExcalidrawArrowElement;

/** A Manager at (0, 0) and its team, each wired from its parent as spawn_agent does, where addTerminal left them (far off). */
function team(spawned: Record<string, string>, extra: ExcalidrawElement[] = []) {
  let scene: ExcalidrawElement[] = [terminal("mgr", 0, 0), ...Object.keys(spawned).map((id, i) => terminal(id, 9000 + i * 50, 9000)), ...extra];
  for (const [child, parent] of Object.entries(spawned)) scene = withWire(scene, parent, child, "calm", true);
  const parentOf: ParentOf = (id) => spawned[id] ?? null;
  return { scene, parentOf };
}

/** `n` team members of the Manager, m0 … m(n-1), in spawn order. */
function members(n: number): Record<string, string> {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`m${i}`, "mgr"]));
}

/** Where member `i` of a flat team stands: rows of four under the Manager, left-aligned on it. */
const cell = (i: number) => ({ x: (i % ROW_SIZE) * (W + COLUMN_GAP), y: H + GROUP_GAP + Math.floor(i / ROW_SIZE) * (H + GROUP_GAP) });

/** The segments of a wire's route, in scene coordinates. */
function segments(wire: ExcalidrawArrowElement): [{ x: number; y: number }, { x: number; y: number }][] {
  const points = wire.points.map(([x, y]) => ({ x: wire.x + x, y: wire.y + y }));
  return points.slice(1).map((p, i) => [points[i], p]);
}

/** Whether the segment from `a` to `b` goes through the inside of `r`. */
function crosses([a, b]: [{ x: number; y: number }, { x: number; y: number }], r: Rect): boolean {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  return x1 < r.x + r.width && x2 > r.x && y1 < r.y + r.height && y2 > r.y;
}

/** No wire of the scene crosses a node, nor its own ends; every route is orthogonal. */
function expectNoWireThroughANode(elements: readonly ExcalidrawElement[]) {
  const nodes = elements.filter((e) => !e.isDeleted && e.type === "embeddable");
  const wires = elements.filter((e) => !e.isDeleted && e.type === "arrow") as ExcalidrawArrowElement[];
  for (const wire of wires) {
    for (const segment of segments(wire)) {
      expect(segment[0].x === segment[1].x || segment[0].y === segment[1].y, `${wire.id} orthogonal`).toBe(true);
      for (const node of nodes) expect(crosses(segment, node), `wire to ${wire.endBinding?.elementId} through ${node.id}`).toBe(false);
    }
  }
}

function expectNoOverlap(elements: readonly ExcalidrawElement[]) {
  const nodes = elements.filter((e) => !e.isDeleted && e.type === "embeddable");
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const [a, b] = [nodes[i], nodes[j]];
      const overlap = Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
      expect(overlap, `${a.id} / ${b.id}`).toBe(false);
    }
}

describe("downLayout", () => {
  it("puts a node's children in rows of four under it, each row under the tallest subtree of the row above", () => {
    const children = { root: ["a", "b", "c", "d", "e"], a: ["a1"] };
    const { positions, rows } = downLayout({ rootId: "root", root: { x: 10, y: 20, width: W, height: H }, children, sizes: {} });
    const row0 = 20 + H + GROUP_GAP;
    expect(positions.get("root")).toEqual({ x: 10, y: 20 });
    expect(positions.get("a")).toEqual({ x: 10, y: row0 });
    expect(positions.get("b")).toEqual({ x: 10 + W + COLUMN_GAP, y: row0 });
    expect(positions.get("d")).toEqual({ x: 10 + 3 * (W + COLUMN_GAP), y: row0 });
    // a's own child under a; the second row under it, the tallest subtree of the first.
    expect(positions.get("a1")).toEqual({ x: 10, y: row0 + H + GROUP_GAP });
    expect(positions.get("e")).toEqual({ x: 10, y: row0 + H + GROUP_GAP + H + GROUP_GAP });
    expect([...rows]).toEqual([
      ["a", 0],
      ["a1", 0],
      ["b", 0],
      ["c", 0],
      ["d", 0],
      ["e", 1],
    ]);
  });

  it("gives a child a cell as wide as its subtree, so its siblings make room for it", () => {
    const { positions } = downLayout({ rootId: "root", root: { x: 0, y: 0, width: W, height: H }, children: { root: ["a", "b"], a: ["a1", "a2"] }, sizes: {} });
    expect(positions.get("a2")).toEqual({ x: W + COLUMN_GAP, y: 2 * (H + GROUP_GAP) });
    expect(positions.get("b")).toEqual({ x: 2 * (W + COLUMN_GAP), y: H + GROUP_GAP });
  });

  it("starts the rows at the node's own left edge when its box is wider on the left (a note there)", () => {
    const { positions } = downLayout({ rootId: "root", root: { x: -300, y: 0, width: W + 300, height: H }, children: { root: ["a"] }, sizes: {}, insets: { root: 300 } });
    expect(positions.get("a")).toEqual({ x: 0, y: H + GROUP_GAP });
  });

  it("walks a cycle once", () => {
    const { positions } = downLayout({ rootId: "a", root: { x: 0, y: 0, width: W, height: H }, children: { a: ["b"], b: ["a"] }, sizes: {} });
    expect([...positions.keys()]).toEqual(["a", "b"]);
  });
});

describe("a Manager's vertical tree (layoutSpawnTree)", () => {
  it.each([1, 4, 5, 12])("lays %i members out in rows of four under the Manager, left-aligned on it", (n) => {
    const { scene, parentOf } = team(members(n));
    const out = layoutSpawnTree(scene, parentOf, "mgr", isManager)!;
    expect(pos(out, "mgr")).toEqual({ x: 0, y: 0 });
    for (let i = 0; i < n; i++) expect(pos(out, `m${i}`), `m${i}`).toEqual(cell(i));
    expectNoOverlap(out);
    expectNoWireThroughANode(out);
  });

  it("routes each wire out of the Manager's bottom into the member's top; past the first row, round the riser", () => {
    const { scene, parentOf } = team(members(6));
    const out = layoutSpawnTree(scene, parentOf, "mgr", isManager)!;
    for (let i = 0; i < 6; i++) {
      const wire = wireTo(out, `m${i}`);
      expect(isSpawnWire(wire)).toBe(true);
      expect(wireFlagsOf(wire)).toEqual(i < ROW_SIZE ? { spawn: true, down: true } : { spawn: true, down: true, riser: true });
      const route = segments(wire);
      const start = route[0][0];
      const end = route[route.length - 1][1];
      // Out of the middle of the Manager's bottom, into the middle of the member's top.
      expect(start.x).toBeCloseTo(W / 2, 0);
      expect(start.y).toBeCloseTo(H + 5, 5);
      expect(end.x).toBeCloseTo(cell(i).x + W / 2, 0);
      expect(end.y).toBeCloseTo(cell(i).y - 5, 5);
      // Straight down to the one under the Manager; to any other, across in the middle of the gap under it.
      if (i === 0) expect(route).toHaveLength(1);
      else expect(route[1][0].y).toBeCloseTo(H + GROUP_GAP / 2, 5);
    }
    // The fifth: down the riser left of the rows, across in the middle of the gap above its row.
    const riser = segments(wireTo(out, "m4")).map(([a]) => a);
    expect(riser.map((p) => Math.round(p.x))).toEqual([360, 360, -16, -16, 360]);
    expect(riser[3].y).toBeCloseTo(cell(4).y - GROUP_GAP / 2, 5);
  });

  it("lays members' own sub-agents under them, the rows making room, no wire through a node", () => {
    // m0 (first column) and m2 (third) open sub-agents, m4 (second row) too; m2 opens five, two rows of its own.
    const spawned: Record<string, string> = {
      ...members(6),
      a1: "m0",
      a2: "m0",
      c1: "m2",
      c2: "m2",
      c3: "m2",
      c4: "m2",
      c5: "m2",
      e1: "m4",
      g1: "a1",
    };
    const { scene, parentOf } = team(spawned);
    const out = layoutSpawnTree(scene, parentOf, "mgr", isManager)!;
    expectNoOverlap(out);
    expectNoWireThroughANode(out);
    // m0's sub-agents under it, side by side; m1 right of m0's subtree (two cells wide).
    const row0 = H + GROUP_GAP;
    expect(pos(out, "a1")).toEqual({ x: 0, y: row0 + H + GROUP_GAP });
    expect(pos(out, "a2")).toEqual({ x: W + COLUMN_GAP, y: row0 + H + GROUP_GAP });
    expect(pos(out, "m1")).toEqual({ x: 2 * (W + COLUMN_GAP), y: row0 });
    expect(pos(out, "g1")).toEqual({ x: 0, y: row0 + 2 * (H + GROUP_GAP) });
    // m2's fifth sub-agent on a second row of its own, round m2's riser.
    expect(wireFlagsOf(wireTo(out, "c5"))).toMatchObject({ down: true, riser: true });
    // The second row of the team under the tallest subtree of the first (m0's: three levels; m2's: three).
    const tallest = Math.max(...["m0", "m1", "m2", "m3", "a1", "a2", "c1", "c5", "g1"].map((id) => at(out, id).y + H));
    expect(at(out, "m4").y).toBe(tallest + GROUP_GAP);
    expect(wireFlagsOf(wireTo(out, "m4"))).toMatchObject({ down: true, riser: true });
  });

  it("changes nothing the second time, and gives every wire the route rerouteWires and elbowWires give it", () => {
    const { scene, parentOf } = team({ ...members(9), a1: "m0", e1: "m5", e2: "m5" });
    const out = layoutSpawnTree(scene, parentOf, "mgr", isManager)!;
    expect(layoutSpawnTree(out, parentOf, "mgr", isManager)).toBeNull();
    const all = new Set(out.filter((e) => e.type === "embeddable").map((e) => e.id));
    const again = rerouteWires(out, all);
    for (const wire of out.filter((e) => e.type === "arrow") as ExcalidrawArrowElement[]) {
      const rerouted = again.find((e) => e.id === wire.id) as ExcalidrawArrowElement;
      expect(rerouted.points, wire.id).toEqual(wire.points);
      expect({ x: rerouted.x, y: rerouted.y }).toEqual({ x: wire.x, y: wire.y });
      expect(rerouted.customData).toEqual(wire.customData);
    }
    // A wire saved before wires were elbowed takes the same route.
    const old = out.map((e) => (e.type === "arrow" ? ({ ...e, elbowed: false } as ExcalidrawElement) : e));
    const elbowed = elbowWires(old, "calm");
    for (const wire of out.filter((e) => e.type === "arrow") as ExcalidrawArrowElement[]) {
      expect((elbowed.find((e) => e.id === wire.id) as ExcalidrawArrowElement).points).toEqual(wire.points);
    }
  });

  it("rewrites a wire whose route went astray though no node moved (Excalidraw rerouted it on a drag)", () => {
    const { scene, parentOf } = team(members(5));
    const out = layoutSpawnTree(scene, parentOf, "mgr", isManager)!;
    const astray = out.map((e) =>
      e.id === wireTo(out, "m4").id
        ? ({
            ...e,
            points: [
              [0, 0],
              [0, 500],
            ],
          } as unknown as ExcalidrawElement)
        : e,
    );
    const fixed = layoutSpawnTree(astray, parentOf, "mgr", isManager)!;
    expect(fixed).not.toBeNull();
    expect(wireTo(fixed, "m4").points).toEqual(wireTo(out, "m4").points);
    // Nothing else changed.
    expect(fixed.filter((e, i) => e !== astray[i]).map((e) => e.id)).toEqual([wireTo(out, "m4").id]);
  });

  it("closes up when a member closes: the one moved up into the first row loses its riser", () => {
    const { scene, parentOf } = team(members(5));
    const out = layoutSpawnTree(scene, parentOf, "mgr", isManager)!;
    expect(wireFlagsOf(wireTo(out, "m4")).riser).toBe(true);
    const closed = out.map((e) => (e.id === "m1" ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    const after = layoutSpawnTree(closed, parentOf, "m1", isManager)!;
    expect(pos(after, "m2")).toEqual(cell(1));
    expect(pos(after, "m4")).toEqual(cell(3));
    const wire = wireTo(after, "m4");
    expect(wireFlagsOf(wire)).toEqual({ spawn: true, down: true });
    expect(wire.points).toHaveLength(4);
    expectNoWireThroughANode(after);
    expect(layoutSpawnTree(after, parentOf, "m2", isManager)).toBeNull();
  });

  it("leaves a member moved by hand where it is, its wire a plain one, its own sub-agents under it", () => {
    const { scene, parentOf } = team({ ...members(3), b1: "m1" });
    const out = layoutSpawnTree(scene, parentOf, "mgr", isManager)!;
    const pinned = out.map((e) => (e.id === "m1" ? ({ ...e, x: 6000, y: 200, customData: { ...e.customData, pinned: true } } as ExcalidrawElement) : e));
    const after = layoutSpawnTree(pinned, parentOf, "mgr", isManager)!;
    expect(pos(after, "m1")).toEqual({ x: 6000, y: 200 });
    expect(pos(after, "m2")).toEqual(cell(1));
    expect(pos(after, "b1")).toEqual({ x: 6000, y: 200 + H + GROUP_GAP });
    expect(wireFlagsOf(wireTo(after, "m1"))).toEqual({ spawn: true });
    expect(wireFlagsOf(wireTo(after, "b1"))).toEqual({ spawn: true, down: true });
  });

  it("lays out downward from a Manager inside another tree, the Manager staying where it is", () => {
    const fleet = { ...(createNodeElement("fleet", { x: 0, y: 0 }) as unknown as ExcalidrawElement), id: "fleet", x: -2000, y: 0 };
    let scene: ExcalidrawElement[] = [fleet, terminal("mgr", 0, 0), terminal("m0"), terminal("m1")];
    scene = withWire(withWire(withWire(scene, "fleet", "mgr", "calm", true), "mgr", "m0", "calm", true), "mgr", "m1", "calm", true);
    const spawned: Record<string, string> = { mgr: "fleet", m0: "mgr", m1: "mgr" };
    const out = layoutSpawnTree(scene, (id) => spawned[id] ?? null, "m0", isManager)!;
    expect(pos(out, "mgr")).toEqual({ x: 0, y: 0 });
    expect(pos(out, "m0")).toEqual(cell(0));
    expect(pos(out, "m1")).toEqual(cell(1));
    expect(wireFlagsOf(wireTo(out, "mgr"))).toEqual({ spawn: true });
  });

  it("keeps a flowchart for any other tree, and takes the vertical flags off its wires", () => {
    const { scene, parentOf } = team(members(5));
    const down = layoutSpawnTree(scene, parentOf, "mgr", isManager)!;
    // The Manager's mission ended: its tree reads left to right again.
    const flow = layoutSpawnTree(down, parentOf, "mgr", () => false)!;
    expect(pos(flow, "m0")).toEqual({ x: W + GROUP_GAP, y: 0 });
    for (let i = 0; i < 5; i++) expect(wireFlagsOf(wireTo(flow, `m${i}`)), `m${i}`).toEqual({ spawn: true });
    expect(layoutSpawnTree(flow, parentOf, "mgr")).toBeNull();
  });
});
