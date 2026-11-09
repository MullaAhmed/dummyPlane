import { describe, expect, it } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createGroupFrame, type Rect } from "@/canvas/groups";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import { GAP, GROUP_GAP, PADDING } from "./groupLayout";
import { clearRegion, layoutSpawnTree, spawnTreeOf, type ParentOf } from "./spawnLayout";
import { createWire } from "./wires";

const { width: W, height: H } = NODE_SIZE.terminal;
/** Column `n`'s x for a terminal root at x = 0. */
const column = (n: number) => n * (W + GROUP_GAP);

function terminal(id: string, x = 5000, y = 5000, extra: Partial<ExcalidrawElement> = {}): ExcalidrawElement {
  const e = createNodeElement("terminal", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
  return { ...e, id, x, y, ...extra } as ExcalidrawElement;
}

const parents =
  (map: Record<string, string>): ParentOf =>
  (id) =>
    map[id] ?? null;

const at = (elements: readonly ExcalidrawElement[], id: string) => elements.find((e) => e.id === id)!;
const pos = (elements: readonly ExcalidrawElement[], id: string) => ({ x: at(elements, id).x, y: at(elements, id).y });

function overlap(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
}

function expectNoOverlap(elements: readonly ExcalidrawElement[]) {
  const nodes = elements.filter((e) => !e.isDeleted && e.type === "embeddable");
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(overlap(nodes[i], nodes[j]), `${nodes[i].id} / ${nodes[j].id}`).toBe(false);
}

describe("layoutSpawnTree", () => {
  it("puts a single child one column right, level with its parent, the root unmoved", () => {
    const root = terminal("root", 0, 0);
    const out = layoutSpawnTree([root, terminal("a")], parents({ a: "root" }), "a")!;
    expect(pos(out, "root")).toEqual({ x: 0, y: 0 });
    expect(at(out, "root")).toBe(root);
    expect(pos(out, "a")).toEqual({ x: column(1), y: 0 });
  });

  it("stacks siblings in one column, GAP apart, in scene order", () => {
    const scene = [terminal("root", 0, 0), terminal("a"), terminal("b"), terminal("c")];
    const out = layoutSpawnTree(scene, parents({ a: "root", b: "root", c: "root" }), "root")!;
    expect(pos(out, "a")).toEqual({ x: column(1), y: 0 });
    expect(pos(out, "b")).toEqual({ x: column(1), y: H + GAP });
    expect(pos(out, "c")).toEqual({ x: column(1), y: 2 * (H + GAP) });
    expectNoOverlap(out);
  });

  it("lays three levels out: a child's subtree pushes its next sibling down", () => {
    const scene = ["root", "a", "b", "a1", "a2", "a1x"].map((id, i) => (i === 0 ? terminal(id, 0, 0) : terminal(id)));
    const map = { a: "root", b: "root", a1: "a", a2: "a", a1x: "a1" };
    const out = layoutSpawnTree(scene, parents(map), "a1x")!;
    expect(pos(out, "a")).toEqual({ x: column(1), y: 0 });
    expect(pos(out, "a1")).toEqual({ x: column(2), y: 0 });
    expect(pos(out, "a1x")).toEqual({ x: column(3), y: 0 });
    expect(pos(out, "a2")).toEqual({ x: column(2), y: H + GAP });
    // a's band holds a1 and a2.
    expect(pos(out, "b")).toEqual({ x: column(1), y: 2 * (H + GAP) });
    expectNoOverlap(out);
  });

  it("is stable: laid out again, nothing moves", () => {
    const scene = [terminal("root", 0, 0), terminal("a"), terminal("b")];
    const map = parents({ a: "root", b: "root" });
    const out = layoutSpawnTree(scene, map, "root")!;
    expect(layoutSpawnTree(out, map, "b")).toBeNull();
  });

  it("closes up after a middle node is closed: its children move up to the nearest live ancestor", () => {
    const map = parents({ a: "root", b: "root", a1: "a", a2: "a" });
    const laid = layoutSpawnTree([terminal("root", 0, 0), terminal("a"), terminal("b"), terminal("a1"), terminal("a2")], map, "root")!;
    const closed = laid.map((e) => (e.id === "a" ? { ...e, isDeleted: true } : e));
    const out = layoutSpawnTree(closed, map, "a")!;
    expect(pos(out, "b")).toEqual({ x: column(1), y: 0 });
    expect(pos(out, "a1")).toEqual({ x: column(1), y: H + GAP });
    expect(pos(out, "a2")).toEqual({ x: column(1), y: 2 * (H + GAP) });
    expectNoOverlap(out);
  });

  it("leaves a tree alone when its root itself is closed", () => {
    const scene = [terminal("root", 0, 0, { isDeleted: true }), terminal("a", 3000, 3000)];
    expect(layoutSpawnTree(scene, parents({ a: "root" }), "root")).toBeNull();
  });

  it("moves the descendants clear of a node outside the tree", () => {
    const blocker = terminal("blocker", column(1) + 100, 100);
    const out = layoutSpawnTree([terminal("root", 0, 0), blocker, terminal("a"), terminal("b")], parents({ a: "root", b: "root" }), "root")!;
    expect(pos(out, "blocker")).toEqual({ x: column(1) + 100, y: 100 });
    // Both still in one column, GAP apart, now clear of the blocker.
    expect(at(out, "a").x).toBe(at(out, "b").x);
    expect(at(out, "b").y - at(out, "a").y).toBe(H + GAP);
    expect(at(out, "a").x >= column(1) && at(out, "a").y >= 0).toBe(true);
    for (const id of ["a", "b"]) {
      const e = at(out, id);
      const grown = { x: blocker.x - GAP, y: blocker.y - GAP, width: W + 2 * GAP, height: H + 2 * GAP };
      expect(overlap(e, grown), id).toBe(false);
    }
    expectNoOverlap(out);
  });

  it("moves the descendants clear of another group's frame", () => {
    const other = createGroupFrame({ x: column(1), y: -50, width: W + 2 * PADDING, height: 600 }, "Other", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
    const out = layoutSpawnTree([terminal("root", 0, 0), other, terminal("a")], parents({ a: "root" }), "root")!;
    expect(overlap(at(out, "a"), other)).toBe(false);
  });

  it("grows the group frame holding the tree around its descendants", () => {
    const frame = createGroupFrame({ x: -PADDING, y: -48, width: W + 2 * PADDING, height: H + 48 + PADDING }, "G", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
    const scene = [terminal("root", 0, 0, { frameId: frame.id }), terminal("a", 0, 0, { frameId: frame.id }), terminal("b", 0, 0, { frameId: frame.id }), frame];
    const out = layoutSpawnTree(scene, parents({ a: "root", b: "root" }), "root")!;
    const grown = at(out, frame.id);
    expect({ x: grown.x, y: grown.y }).toEqual({ x: frame.x, y: frame.y });
    const b = at(out, "b");
    expect(grown.x + grown.width).toBe(b.x + W + PADDING);
    expect(grown.y + grown.height).toBe(b.y + H + PADDING);
    expect(grown.version).toBe(frame.version + 1);
  });

  it("never shrinks the frame", () => {
    const frame = createGroupFrame({ x: -PADDING, y: -48, width: 5000, height: 5000 }, "G", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
    const scene = [terminal("root", 0, 0, { frameId: frame.id }), terminal("a", 0, 900, { frameId: frame.id }), frame];
    const out = layoutSpawnTree(scene, parents({ a: "root" }), "root")!;
    expect(at(out, frame.id)).toBe(frame);
  });

  it("keeps the group's other members clear of the tree", () => {
    const frame = createGroupFrame({ x: -PADDING, y: -48, width: 2000, height: 2000 }, "G", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
    const member = terminal("member", column(1), 0, { frameId: frame.id });
    const scene = [terminal("root", 0, 0, { frameId: frame.id }), member, terminal("a", 0, 0, { frameId: frame.id }), frame];
    const out = layoutSpawnTree(scene, parents({ a: "root" }), "root")!;
    expect(pos(out, "member")).toEqual({ x: column(1), y: 0 });
    expectNoOverlap(out);
  });

  it("skips a pinned child: it stays, its sibling closes up, its own children follow it", () => {
    const pinned = terminal("p", 4000, 2000, { customData: { kind: "terminal", pinned: true } });
    const scene = [terminal("root", 0, 0), pinned, terminal("b"), terminal("p1")];
    const out = layoutSpawnTree(scene, parents({ p: "root", b: "root", p1: "p" }), "root")!;
    expect(at(out, "p")).toBe(pinned);
    expect(pos(out, "b")).toEqual({ x: column(1), y: 0 });
    expect(pos(out, "p1")).toEqual({ x: 4000 + W + GROUP_GAP, y: 2000 });
    expectNoOverlap(out);
  });

  it("routes the wires of moved nodes again, keeping their id, color and marks", () => {
    const root = terminal("root", 0, 0);
    const child = terminal("a", 3000, 3000);
    const wire = { ...createWire(root, child, "calm"), strokeColor: "#123456" };
    const scene = [{ ...root, boundElements: [{ id: wire.id, type: "arrow" as const }] }, { ...child, boundElements: [{ id: wire.id, type: "arrow" as const }] }, wire];
    const out = layoutSpawnTree(scene, parents({ a: "root" }), "a")!;
    const routed = at(out, wire.id) as ExcalidrawArrowElement;
    const fresh = createWire(at(out, "root"), at(out, "a"), "calm");
    expect(routed.id).toBe(wire.id);
    expect(routed.strokeColor).toBe("#123456");
    expect(routed.customData).toEqual(wire.customData);
    expect({ x: routed.x, y: routed.y, points: routed.points }).toEqual({ x: fresh.x, y: fresh.y, points: fresh.points });
    expect(routed.startBinding?.elementId).toBe("root");
    expect(routed.endBinding?.elementId).toBe("a");
    expect(routed.version).toBe(wire.version + 1);
  });

  it("leaves wires between nodes that did not move as they are", () => {
    const root = terminal("root", 0, 0);
    const other = terminal("other", 0, 3000);
    const wire = createWire(root, other, "calm");
    const out = layoutSpawnTree([root, other, wire, terminal("a")], parents({ a: "root" }), "root")!;
    expect(at(out, wire.id)).toBe(wire);
  });
});

describe("spawnTreeOf", () => {
  it("finds the root from any node and lists the live tree only", () => {
    const scene = [terminal("root"), terminal("a"), terminal("a1"), terminal("lone")];
    const tree = spawnTreeOf(scene, parents({ a: "root", a1: "a" }), "a1")!;
    expect(tree.rootId).toBe("root");
    expect([...tree.ids].sort()).toEqual(["a", "a1", "root"]);
    expect(tree.children).toEqual({ root: ["a"], a: ["a1"] });
  });

  it("survives a spawnedBy cycle", () => {
    const tree = spawnTreeOf([terminal("a"), terminal("b")], parents({ a: "b", b: "a" }), "a");
    expect(tree).not.toBeNull();
    expect(tree!.ids.size).toBe(2);
  });
});

describe("clearRegion", () => {
  it("keeps a free region where it is", () => {
    expect(clearRegion({ x: 0, y: 0, width: 10, height: 10 }, [{ x: 100, y: 0, width: 10, height: 10 }])).toEqual({ x: 0, y: 0 });
  });

  it("moves only down or right, GAP clear of the obstacle", () => {
    const region = { x: 0, y: 0, width: 100, height: 100 };
    const spot = clearRegion(region, [{ x: 50, y: 50, width: 100, height: 20 }]);
    expect(spot.x >= 0 && spot.y >= 0).toBe(true);
    expect(overlap({ ...region, ...spot }, { x: 50 - GAP, y: 50 - GAP, width: 100 + 2 * GAP, height: 20 + 2 * GAP })).toBe(false);
  });
});
