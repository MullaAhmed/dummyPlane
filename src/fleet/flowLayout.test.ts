import { describe, expect, it } from "vitest";
import type { Rect } from "@/canvas/groups";
import { NODE_SIZE } from "@/canvas/nodeElement";
import { flowLayout, type FlowTree, type Size } from "./flowLayout";
import { GAP, GROUP_GAP } from "./groupLayout";

const T = NODE_SIZE.terminal;
const root: Rect = { x: 100, y: 200, width: T.width, height: T.height };
const column = (depth: number) => root.x + depth * (T.width + GROUP_GAP);
const row = (index: number) => root.y + index * (T.height + GAP);

const tree = (children: FlowTree["children"], sizes: FlowTree["sizes"] = {}, at: Rect = root): FlowTree => ({
  rootId: "root",
  root: at,
  children,
  sizes,
});

function overlap(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
}

describe("flowLayout", () => {
  it("leaves the root where it stands", () => {
    const positions = flowLayout(tree({ root: ["a"] }));
    expect(positions.get("root")).toEqual({ x: root.x, y: root.y });
    expect(flowLayout(tree({})).size).toBe(1);
  });

  it("puts a single child GROUP_GAP right of its parent, tops aligned", () => {
    expect(flowLayout(tree({ root: ["a"] })).get("a")).toEqual({ x: root.x + root.width + GROUP_GAP, y: root.y });
  });

  it("stacks siblings in one column, GAP apart, in their order", () => {
    const positions = flowLayout(tree({ root: ["a", "b", "c"] }));
    expect(["a", "b", "c"].map((id) => positions.get(id))).toEqual([
      { x: column(1), y: row(0) },
      { x: column(1), y: row(1) },
      { x: column(1), y: row(2) },
    ]);
  });

  it("gives a middle child's subtree its own band: the next sibling goes below its grandchildren", () => {
    // root → a, b, c; b → b1, b2; b2 → b21.
    const positions = flowLayout(tree({ root: ["a", "b", "c"], b: ["b1", "b2"], b2: ["b21"] }));
    expect(positions.get("a")).toEqual({ x: column(1), y: row(0) });
    expect(positions.get("b")).toEqual({ x: column(1), y: row(1) });
    expect(positions.get("b1")).toEqual({ x: column(2), y: row(1) });
    expect(positions.get("b2")).toEqual({ x: column(2), y: row(2) });
    expect(positions.get("b21")).toEqual({ x: column(3), y: row(2) });
    // b's band is two rows high: c starts on the fourth row.
    expect(positions.get("c")).toEqual({ x: column(1), y: row(3) });
  });

  it("opens each column right of the widest node of the column before", () => {
    const wide: Size = { width: 1000, height: 300 };
    const small: Size = { width: 300, height: 200 };
    const positions = flowLayout(tree({ root: ["a", "b"], a: ["a1"], b: ["b1"] }, { a: small, b: wide, a1: small, b1: small }));
    const second = root.x + root.width + GROUP_GAP;
    expect(positions.get("a")).toEqual({ x: second, y: root.y });
    // a's band is its own height (200), its child is no taller.
    expect(positions.get("b")).toEqual({ x: second, y: root.y + 200 + GAP });
    expect(positions.get("a1")!.x).toBe(second + 1000 + GROUP_GAP);
    expect(positions.get("b1")).toEqual({ x: second + 1000 + GROUP_GAP, y: root.y + 200 + GAP });
  });

  it("gives a node taller than its children's stack a band of its own height", () => {
    const tall: Size = { width: T.width, height: 2000 };
    const positions = flowLayout(tree({ root: ["a", "b"], a: ["a1"] }, { a: tall }));
    expect(positions.get("b")).toEqual({ x: column(1), y: root.y + 2000 + GAP });
  });

  it("takes a terminal's size for a node without one", () => {
    const positions = flowLayout(tree({ root: ["a", "b"] }, { a: undefined as unknown as Size }));
    expect(positions.get("b")!.y).toBe(root.y + T.height + GAP);
  });

  it("places no two nodes of a wide, deep tree on top of each other", () => {
    const sizes: Record<string, Size> = {};
    const children: Record<string, string[]> = {};
    // A deterministic, uneven tree: node n has (n * 7) % 4 children, down to 60 nodes.
    let next = 1;
    const queue = ["root"];
    while (queue.length && next < 60) {
      const id = queue.shift()!;
      const count = id === "root" ? 3 : (Number(id.slice(1)) * 7) % 4;
      children[id] = [];
      for (let i = 0; i < count && next < 60; i++) {
        const child = `n${next++}`;
        children[id].push(child);
        sizes[child] = { width: 300 + (next % 3) * 200, height: 200 + (next % 5) * 100 };
        queue.push(child);
      }
    }
    const positions = flowLayout(tree(children, sizes));
    expect(positions.size).toBe(next);
    const rects = [...positions].map(([id, p]) => ({ id, x: p.x, y: p.y, ...(id === "root" ? T : sizes[id]) }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j]), `${rects[i].id} / ${rects[j].id}`).toBe(false);
    }
  });

  it("places a node once: a cycle or a node listed twice does not loop", () => {
    const positions = flowLayout(tree({ root: ["a", "a"], a: ["b", "root"], b: ["a"] }));
    expect([...positions.keys()]).toEqual(["root", "a", "b"]);
    expect(positions.get("root")).toEqual({ x: root.x, y: root.y });
    expect(positions.get("b")).toEqual({ x: column(2), y: root.y });
  });

  it("ignores children of a node outside the tree", () => {
    expect([...flowLayout(tree({ root: ["a"], stray: ["b"] })).keys()]).toEqual(["root", "a"]);
  });
});
