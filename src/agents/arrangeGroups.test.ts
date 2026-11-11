import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { NODE_SIZE, toStoredKind, type NodeKind } from "@/canvas/nodeElement";
import { nodesStore } from "@/store/nodes";
import { arrangedElements, type ArrangeInput } from "./arrange";
import { boxOf } from "./arrangeDrawings";
import { anchorsOf } from "./attachments";
import { COLUMN_GAP, GROUP_GAP, NODE_GAP, overlap, PADDING, PADDING_BOTTOM, PADDING_TOP, ROW_GAP } from "./groupLayout";

/** Arrange inside groups: every member laid out, not only the terminals. */

const W = NODE_SIZE.terminal.width;
const H = NODE_SIZE.terminal.height;

const element = (id: string, type: string, x: number, y: number, width: number, height: number, fields: Record<string, unknown> = {}) =>
  ({ id, type, x, y, width, height, angle: 0, isDeleted: false, frameId: null, groupIds: [], version: 1, ...fields }) as unknown as ExcalidrawElement;

const node = (id: string, kind: NodeKind, x: number, y: number, fields: Record<string, unknown> = {}) =>
  element(id, "embeddable", x, y, NODE_SIZE[kind].width, NODE_SIZE[kind].height, {
    link: `dummyplane://${toStoredKind(kind)}/${id}`,
    customData: { kind: toStoredKind(kind) },
    ...fields,
  });

const group = (id: string, x: number, y: number, width: number, height: number, fields: Record<string, unknown> = {}) =>
  element(id, "frame", x, y, width, height, { customData: { dummyplane: { kind: "group", role: "general", pantheon: "olympus" } }, ...fields });

const rect = (id: string, x: number, y: number, width = 50, height = 50, fields: Record<string, unknown> = {}) => element(id, "rectangle", x, y, width, height, fields);

const label = (id: string, containerId: string, x: number, y: number, fields: Record<string, unknown> = {}) =>
  element(id, "text", x, y, 100, 30, { containerId, text: id, ...fields });

/** An arrow from (x, y) to (x + dx, y + dy), bound to `from` and `to` when given. */
const arrow = (id: string, x: number, y: number, dx: number, dy: number, from: string | null, to: string | null, fields: Record<string, unknown> = {}) =>
  element(id, "arrow", x, y, Math.abs(dx), Math.abs(dy), {
    points: [
      [0, 0],
      [dx, dy],
    ],
    startBinding: from ? { elementId: from, focus: 0, gap: 0 } : null,
    endBinding: to ? { elementId: to, focus: 0, gap: 0 } : null,
    elbowed: false,
    ...fields,
  });

const input = (elements: ExcalidrawElement[], rest: Partial<ArrangeInput> = {}): ArrangeInput => ({
  elements,
  parentOf: () => null,
  isMinimized: () => false,
  attachedTo: anchorsOf(elements),
  aspect: 16 / 10,
  ...rest,
});

type Result = ReturnType<typeof arrangedElements>;
const get = (result: Result, id: string) => result!.elements.find((e) => e.id === id)!;
const at = (result: Result, id: string) => {
  const e = get(result, id);
  return { x: e.x, y: e.y, width: e.width, height: e.height };
};
const offset = (result: Result, a: string, b: string) => ({ x: get(result, b).x - get(result, a).x, y: get(result, b).y - get(result, a).y });
const inside = (box: { x: number; y: number; width: number; height: number }, frame: { x: number; y: number; width: number; height: number }) =>
  box.x >= frame.x && box.y >= frame.y && box.x + box.width <= frame.x + frame.width && box.y + box.height <= frame.y + frame.height;
/** The last point of an arrow, on the scene. */
const tip = (e: ExcalidrawElement) => {
  const points = (e as unknown as { points: [number, number][] }).points;
  const [px, py] = points[points.length - 1];
  return { x: e.x + px, y: e.y + py };
};

describe("Arrange inside a group", () => {
  it("packs every member, a terminal, a kanban, a file node and a drawn rectangle with its text, each at its size, nothing overlapping", () => {
    const g = group("g", 0, 0, 4000, 3000);
    const elements = [
      node("t", "terminal", 100, 100, { frameId: "g" }),
      node("k", "kanban", 2000, 100, { frameId: "g" }),
      node("f", "file", 100, 1500, { frameId: "g" }),
      rect("r", 2500, 2000, 300, 200, { frameId: "g", boundElements: [{ id: "l", type: "text" }] }),
      label("l", "r", 2600, 2085, { frameId: "g" }),
      g,
    ];
    const result = arrangedElements(input(elements));
    expect(result).not.toBeNull();
    const frame = at(result, "g");

    // Read column by column: t and f (one column), then k; three pieces holding a node fill one column.
    expect(at(result, "t")).toEqual({ x: PADDING, y: PADDING_TOP, ...NODE_SIZE.terminal });
    expect(at(result, "f")).toEqual({ x: PADDING, y: PADDING_TOP + H + ROW_GAP, ...NODE_SIZE.file });
    const kanbanTop = PADDING_TOP + H + ROW_GAP + NODE_SIZE.file.height + ROW_GAP;
    expect(at(result, "k")).toEqual({ x: PADDING, y: kanbanTop, ...NODE_SIZE.kanban });
    // The drawing in a row under the grid, its text still in it.
    const drawingsTop = kanbanTop + NODE_SIZE.kanban.height + ROW_GAP;
    expect(at(result, "r")).toEqual({ x: PADDING, y: drawingsTop, width: 300, height: 200 });
    expect(offset(result, "r", "l")).toEqual({ x: 100, y: 85 });
    // The frame fits them, where it stood.
    expect(frame).toEqual({ x: 0, y: 0, width: 2 * PADDING + W, height: drawingsTop + 200 + PADDING_BOTTOM });

    const boxes = ["t", "k", "f", "r"].map((id) => boxOf(get(result, id)));
    for (const box of [...boxes, boxOf(get(result, "l"))]) expect(inside(box, frame)).toBe(true);
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(0)));
    // Arranged once, it stays: a second Arrange moves nothing.
    expect(arrangedElements(input(result!.elements))).toBeNull();
  });

  it("lays a group out in bands: the grid, its drawings, then its tabs", () => {
    const g = group("g", 0, 0, 3000, 3000);
    const tab = node("m", "terminal", 50, 60, { frameId: "g", width: 280, height: 68 });
    const elements = [tab, rect("s", 900, 900, 100, 80, { frameId: "g" }), node("t", "terminal", 1500, 1500, { frameId: "g" }), g];
    const result = arrangedElements(input(elements, { isMinimized: (id) => id === "m" }));
    const drawingsTop = PADDING_TOP + H + ROW_GAP;
    expect(at(result, "t")).toMatchObject({ x: PADDING, y: PADDING_TOP });
    expect(at(result, "s")).toMatchObject({ x: PADDING, y: drawingsTop });
    const tabsTop = drawingsTop + 80 + ROW_GAP;
    expect(at(result, "m")).toMatchObject({ x: PADDING, y: tabsTop });
    expect(at(result, "g").height).toBe(tabsTop + 68 + PADDING_BOTTOM);
  });

  it("keeps an Excalidraw group whole, its layout inside it as it was", () => {
    const g = group("g", 0, 0, 4000, 3000);
    const drawn = { frameId: "g", groupIds: ["dg"] };
    const elements = [
      node("t", "terminal", 900, 700, { frameId: "g" }),
      rect("a", 2000, 2000, 100, 100, drawn),
      element("b", "ellipse", 2300, 2150, 80, 60, drawn),
      label("c", "", 2100, 1900, { ...drawn, containerId: null }),
      rect("lone", 200, 2500, 40, 40, { frameId: "g" }),
      g,
    ];
    const result = arrangedElements(input(elements));
    expect(offset(result, "a", "b")).toEqual({ x: 300, y: 150 });
    expect(offset(result, "a", "c")).toEqual({ x: 100, y: -100 });
    // The whole Excalidraw group is one piece in the row of drawings: the lone shape keeps clear of it.
    const piece = [boxOf(get(result, "a")), boxOf(get(result, "b")), boxOf(get(result, "c"))];
    for (const box of piece) expect(overlap(box, boxOf(get(result, "lone")))).toBe(0);
    expect(at(result, "a")).toMatchObject({ x: PADDING });
    expect(boxOf(get(result, "c")).y).toBe(PADDING_TOP + H + ROW_GAP);
  });

  it("moves a drawing in an Excalidraw group with a node outside groups with that node", () => {
    const elements = [node("a", "terminal", 0, 0), node("b", "terminal", 3000, 3000, { groupIds: ["dg"] }), rect("q", 3000, 3500, 60, 40, { groupIds: ["dg"] })];
    const result = arrangedElements(input(elements));
    expect(at(result, "b")).toMatchObject({ x: W + GROUP_GAP, y: 0 });
    expect(offset(result, "b", "q")).toEqual({ x: 0, y: 500 });
  });

  it("keeps drawings joined by arrows together, as a diagram", () => {
    const g = group("g", 0, 0, 4000, 3000);
    const elements = [
      node("t", "terminal", 900, 700, { frameId: "g" }),
      rect("a", 2000, 2000, 100, 100, { frameId: "g" }),
      rect("b", 2400, 2000, 100, 100, { frameId: "g" }),
      arrow("ab", 2100, 2050, 300, 0, "a", "b", { frameId: "g" }),
      g,
    ];
    const result = arrangedElements(input(elements));
    expect(offset(result, "a", "b")).toEqual({ x: 400, y: 0 });
    expect(offset(result, "a", "ab")).toEqual({ x: 100, y: 50 });
    expect(at(result, "a")).toMatchObject({ x: PADDING, y: PADDING_TOP + H + ROW_GAP });
  });

  it("makes a bound arrow follow its ends when they land apart, its label half way", () => {
    const g = group("g", 0, 0, 4000, 3000);
    const elements = [
      node("t", "terminal", 900, 700, { frameId: "g" }),
      rect("r", 100, 100, 50, 50, { frameId: "g" }),
      // From r's right side (150, 125) to t's left side (900, 920).
      arrow("a", 150, 125, 750, 795, "r", "t", { frameId: "g", boundElements: [{ id: "al", type: "text" }] }),
      label("al", "a", 475, 507, { frameId: "g" }),
      g,
    ];
    const result = arrangedElements(input(elements));
    const r = at(result, "r");
    const t = at(result, "t");
    expect(r).toMatchObject({ x: PADDING, y: PADDING_TOP + H + ROW_GAP });
    expect(t).toMatchObject({ x: PADDING, y: PADDING_TOP });
    const a = get(result, "a");
    expect({ x: a.x, y: a.y }).toEqual({ x: r.x + 50, y: r.y + 25 });
    expect(tip(a)).toEqual({ x: t.x, y: t.y + 220 });
    expect(a.width).toBe(50);
    expect(a.height).toBe(301);
    // The label went by the mean of how far its ends went.
    const rShift = { x: r.x - 100, y: r.y - 100 };
    const tShift = { x: t.x - 900, y: t.y - 700 };
    expect(at(result, "al")).toMatchObject({ x: 475 + (rShift.x + tShift.x) / 2, y: 507 + (rShift.y + tShift.y) / 2 });
  });

  it("routes a drawn elbow arrow again between its ends, its segments square", () => {
    const g = group("g", 0, 0, 4000, 3000);
    const elements = [
      node("t", "terminal", 900, 700, { frameId: "g" }),
      rect("r", 100, 100, 50, 50, { frameId: "g" }),
      arrow("a", 150, 125, 750, 795, "r", "t", { frameId: "g", elbowed: true }),
      g,
    ];
    const result = arrangedElements(input(elements));
    const a = get(result, "a") as unknown as { points: [number, number][]; startBinding: { elementId: string }; endBinding: { elementId: string } };
    expect(a.startBinding.elementId).toBe("r");
    expect(a.endBinding.elementId).toBe("t");
    a.points.slice(1).forEach(([x, y], i) => {
      const [px, py] = a.points[i];
      expect(x === px || y === py).toBe(true);
    });
  });

  it("makes an arrow outside frames follow the node it is bound to, its free end staying", () => {
    const elements = [
      node("m", "terminal", 0, 0),
      node("n", "terminal", 3000, 3000),
      rect("q", 4950, 5000, 50, 50),
      // From q's left side to n's right side; the second arrow's start is free.
      arrow("a", 4950, 5025, -1230, -1805, "q", "n"),
      arrow("free", 6000, 6000, -2280, -2780, null, "n"),
    ];
    const result = arrangedElements(input(elements));
    const n = at(result, "n");
    expect(n).toMatchObject({ x: W + NODE_GAP, y: 0 });
    expect(at(result, "q")).toMatchObject({ x: 4950, y: 5000 });
    expect(at(result, "a")).toMatchObject({ x: 4950, y: 5025 });
    expect(tip(get(result, "a"))).toEqual({ x: n.x + W, y: n.y + 220 });
    expect(at(result, "free")).toMatchObject({ x: 6000, y: 6000 });
    expect(tip(get(result, "free"))).toEqual({ x: n.x + W, y: n.y + 220 });
  });

  it("arranges a group holding a spawn tree: the tree whole, its flowchart kept, the other members around it", () => {
    const g = group("g", 0, 0, 5000, 3000);
    const parents: Record<string, string> = { child: "root" };
    const elements = [
      node("root", "terminal", 40, 60, { frameId: "g" }),
      node("child", "terminal", 40 + W + GROUP_GAP, 60, { frameId: "g" }),
      node("o", "terminal", 100, 2000, { frameId: "g" }),
      rect("s", 3000, 2500, 50, 50, { frameId: "g" }),
      g,
    ];
    const result = arrangedElements(input(elements, { parentOf: (id) => parents[id] ?? null }));
    expect(result).not.toBeNull();
    expect(at(result, "root")).toMatchObject({ x: PADDING, y: PADDING_TOP });
    expect(offset(result, "root", "child")).toEqual({ x: W + GROUP_GAP, y: 0 });
    expect(at(result, "o")).toMatchObject({ x: PADDING, y: PADDING_TOP + H + ROW_GAP });
    expect(at(result, "s")).toMatchObject({ x: PADDING, y: PADDING_TOP + 2 * (H + ROW_GAP) });
    expect(at(result, "g")).toMatchObject({ x: 0, y: 0, width: 2 * PADDING + 2 * W + GROUP_GAP });
    const boxes = ["root", "child", "o", "s"].map((id) => boxOf(get(result, id)));
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(0)));
  });

  it("leaves a group alone when its spawn tree reaches out of its frame", () => {
    const g = group("g", 0, 0, 3000, 3000);
    const parents: Record<string, string> = { out: "root" };
    const elements = [node("root", "terminal", 400, 400, { frameId: "g" }), rect("s", 2000, 2000, 50, 50, { frameId: "g" }), g, node("out", "terminal", 3200, 400)];
    const result = arrangedElements(input(elements, { parentOf: (id) => parents[id] ?? null }));
    // One block on the canvas (the tree joins them), nothing laid out again inside.
    expect(result).toBeNull();
  });

  it("tidies only that group when the selection is a drawing in it", () => {
    const g = group("g", 0, 0, 3000, 3000);
    const elements = [node("t", "terminal", 900, 700, { frameId: "g" }), rect("s", 2000, 2000, 50, 50, { frameId: "g" }), g, node("far", "terminal", 9000, 9000)];
    const result = arrangedElements(input(elements, { only: ["s"] }));
    expect(at(result, "t")).toMatchObject({ x: PADDING, y: PADDING_TOP });
    expect(at(result, "s")).toMatchObject({ x: PADDING, y: PADDING_TOP + H + ROW_GAP });
    expect(at(result, "far")).toMatchObject({ x: 9000, y: 9000 });
  });

  it("counts a frame drawn by hand inside a group as one of its members, with what it holds", () => {
    const g = group("g", 0, 0, 4000, 3000);
    const elements = [
      node("t", "terminal", 900, 700, { frameId: "g" }),
      element("p", "frame", 2000, 2000, 400, 300, { name: "notes" }),
      rect("ps", 2050, 2100, 50, 50, { frameId: "p" }),
      g,
      node("loose", "terminal", 9000, 0),
    ];
    const result = arrangedElements(input(elements));
    const frame = at(result, "g");
    expect(at(result, "p")).toMatchObject({ x: frame.x + PADDING, y: frame.y + PADDING_TOP + H + ROW_GAP, width: 400, height: 300 });
    expect(offset(result, "p", "ps")).toEqual({ x: 50, y: 100 });
    expect(inside(at(result, "p"), frame)).toBe(true);
    // On the canvas it went with its group: the loose terminal stands beside the group, not beside it.
    expect(at(result, "loose")).toMatchObject({ x: frame.x + frame.width + GROUP_GAP });
  });

  it("leaves a folded group's drawings where they are too", () => {
    const g = group("g", 0, 0, 3000, 1500, { customData: { dummyplane: { kind: "group", role: "general", pantheon: "olympus", folded: true } } });
    const elements = [node("m", "terminal", 1500, 700, { frameId: "g" }), rect("s", 40, 60, 50, 50, { frameId: "g" }), g];
    expect(arrangedElements(input(elements))).toBeNull();
  });
});

describe("Arrange and attached items", () => {
  const attached = (anchor: string) => ({ customData: { attachedTo: anchor } });
  /** A node of `kind` attached to `anchor`. */
  const attachedNode = (kind: NodeKind, anchor: string) => ({ customData: { kind: toStoredKind(kind), attachedTo: anchor } });

  it("keeps an item in its anchor's frame beside it, as one piece of the grid", () => {
    const g = group("g", 0, 0, 4000, 3000);
    const elements = [
      node("u", "terminal", 40, 60, { frameId: "g" }),
      node("t", "terminal", 900, 1700, { frameId: "g" }),
      rect("n", 900 + W + COLUMN_GAP, 1700, 200, 150, { frameId: "g", ...attached("t") }),
      g,
    ];
    const result = arrangedElements(input(elements));
    expect(at(result, "t")).toMatchObject({ x: PADDING, y: PADDING_TOP + H + ROW_GAP });
    expect(offset(result, "t", "n")).toEqual({ x: W + COLUMN_GAP, y: 0 });
    expect(at(result, "g").width).toBe(2 * PADDING + W + COLUMN_GAP + 200);
  });

  it("keeps an item outside its anchor's frame outside it, moved with the side of the frame it stands by", () => {
    const g = group("g", 0, 0, 3000, 1500);
    const output = node("o", "file", 3100, 700, attachedNode("file", "t"));
    const elements = [node("t", "terminal", 900, 700, { frameId: "g" }), g, output];
    const result = arrangedElements(input(elements));
    const frame = at(result, "g");
    expect(frame).toMatchObject({ x: 0, y: 0, width: 2 * PADDING + W });
    // As far right of the frame's edge as before, at the same height; still no member of the frame.
    expect(at(result, "o")).toMatchObject({ x: frame.width + 100, y: 700 });
    expect(get(result, "o").frameId).toBeNull();
  });

  it("moves an item with its anchor on the canvas, as one block", () => {
    // A note under its terminal: the two take one block, beside the other terminal.
    const elements = [node("a", "terminal", 0, 0), node("b", "terminal", 3000, 3000), node("c", "note", 3000, 3000 + H + ROW_GAP, attachedNode("note", "b"))];
    const result = arrangedElements(input(elements));
    expect(at(result, "b")).toMatchObject({ x: W + GROUP_GAP, y: 0 });
    expect(offset(result, "b", "c")).toEqual({ x: 0, y: H + ROW_GAP });
  });

  it("moves an agent's output (show_output) with the agent, its source read from the node's payload", () => {
    nodesStore.setState({ nodes: { o: { workspaceId: "w", kind: "output", payload: { title: "", source: "b", ui: "", updatedAt: 0 } } } });
    const elements = [node("a", "terminal", 0, 0), node("b", "terminal", 3000, 3000), node("o", "output", 3000, 3000 + H + ROW_GAP)];
    expect(anchorsOf(elements)(elements[2])).toEqual({ anchor: "b" });
    const result = arrangedElements(input(elements));
    expect(at(result, "b")).toMatchObject({ x: W + GROUP_GAP, y: 0 });
    expect(offset(result, "b", "o")).toEqual({ x: 0, y: H + ROW_GAP });
    nodesStore.setState({ nodes: {} });
  });

  it("takes a quick note's host from its link", () => {
    const note = node("n", "note", 0, 0, { customData: { kind: "note", note: { of: "t", x: "right", dx: 16, y: "top", dy: 0 } } });
    const elements = [node("t", "terminal", 0, 0), note];
    expect(anchorsOf(elements)(note)).toEqual({ anchor: "t", beside: true });
  });

  /** A quick note beside `host`, as src/nodes/note writes it: no frame, its host named in its link. */
  const quickNote = (id: string, host: string, x: number, y: number) =>
    node(id, "note", x, y, { customData: { kind: "note", note: { of: host, x: "right", dx: 16, y: "top", dy: 0 } } });

  it("keeps a quick note beside its host in a group, the grid making room for it, no member of the frame", () => {
    const g = group("g", 0, 0, 3000, 2000);
    const elements = [node("u", "terminal", 40, 60, { frameId: "g" }), node("t", "terminal", 900, 1000, { frameId: "g" }), g, quickNote("n", "t", 900 + W + 16, 1000)];
    const result = arrangedElements(input(elements));
    expect(at(result, "t")).toMatchObject({ x: PADDING, y: PADDING_TOP + H + ROW_GAP });
    expect(offset(result, "t", "n")).toEqual({ x: W + 16, y: 0 });
    expect(at(result, "g").width).toBe(2 * PADDING + W + 16 + NODE_SIZE.note.width);
    expect(get(result, "n").frameId).toBeNull();
    expect(overlap(boxOf(get(result, "n")), boxOf(get(result, "u")))).toBe(0);
  });

  it("gathers a minimized terminal and its quick note with the tabs", () => {
    const elements = [node("a", "terminal", 0, 0), node("m", "terminal", 3000, 3000, { width: 280, height: 68 }), quickNote("n", "m", 3000 + 280 + 16, 3000)];
    const result = arrangedElements(input(elements, { isMinimized: (id) => id === "m" }));
    expect(at(result, "m")).toMatchObject({ x: 0, y: H + ROW_GAP });
    expect(offset(result, "m", "n")).toEqual({ x: 280 + 16, y: 0 });
  });

  it("lays a group out the same when it also moves on the canvas: labels, followed arrows and attached items included", () => {
    const messy = () => [
      node("t", "terminal", 3900, 700, { frameId: "g" }),
      rect("r", 3100, 100, 120, 80, { frameId: "g", boundElements: [{ id: "l", type: "text" }] }),
      label("l", "r", 3110, 125, { frameId: "g" }),
      // From r's right side to t's left side.
      arrow("a", 3220, 140, 680, 780, "r", "t", { frameId: "g", boundElements: [{ id: "al", type: "text" }] }),
      label("al", "a", 3500, 500, { frameId: "g" }),
      rect("n", 3900 + W + COLUMN_GAP, 700, 200, 150, { frameId: "g", ...attached("t") }),
      group("g", 3000, 0, 2500, 1500),
      node("o", "file", 5600, 300, attachedNode("file", "t")),
    ];
    const alone = arrangedElements(input(messy()));
    const moved = arrangedElements(input([node("first", "terminal", 0, 0), ...messy()]));
    const fromCorner = (result: Result, id: string) => {
      const e = get(result, id) as unknown as { x: number; y: number; width: number; height: number; points?: unknown };
      const frame = get(result, "g");
      return { x: e.x - frame.x, y: e.y - frame.y, width: e.width, height: e.height, points: e.points };
    };
    // The group went somewhere else on the canvas...
    expect({ x: get(moved, "g").x, y: get(moved, "g").y }).not.toEqual({ x: 3000, y: 0 });
    expect(fromCorner(moved, "g")).toEqual(fromCorner(alone, "g"));
    // ...and everything in it, or with it, stands where the group alone puts it.
    for (const id of ["t", "r", "l", "a", "al", "n", "o"]) expect(fromCorner(moved, id)).toEqual(fromCorner(alone, id));
    expect(arrangedElements(input(moved!.elements))).toBeNull();
  });

  it("takes an item's anchor from the rule given, and none from a rule naming a missing element or itself", () => {
    const elements = [node("a", "terminal", 0, 0), rect("x", 100, 100, 10, 10, attached("a")), rect("y", 0, 0, 1, 1, attached("gone")), rect("z", 0, 0, 1, 1, attached("z"))];
    const anchorOf = anchorsOf(elements);
    expect(anchorOf(elements[1])).toEqual({ anchor: "a" });
    expect(anchorOf(elements[2])).toBeNull();
    expect(anchorOf(elements[3])).toBeNull();
    expect(anchorsOf(elements, [() => "a"])(elements[2])).toEqual({ anchor: "a" });
  });
});

describe("boxOf", () => {
  it("covers a line's points, which may run left of and above its x and y", () => {
    expect(boxOf(arrow("a", 100, 100, -40, -30, null, null))).toEqual({ x: 60, y: 70, width: 40, height: 30 });
  });

  it("covers a turned shape's corners", () => {
    const box = boxOf(rect("r", 0, 0, 100, 50, { angle: Math.PI / 2 }));
    expect(box.x).toBeCloseTo(25);
    expect(box.y).toBeCloseTo(-25);
    expect(box.width).toBeCloseTo(50);
    expect(box.height).toBeCloseTo(100);
  });
});
