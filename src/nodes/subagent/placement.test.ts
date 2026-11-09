import { describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createGroupFrame, groupInfoOf } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { cellAt, NODE_GAP } from "@/fleet/groupLayout";
import { placeSubagent } from "./placement";
import { withoutSubagents } from "./scene";

vi.mock("@excalidraw/excalidraw", () => ({ newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));

const at = (kind: "terminal" | "subagent", x: number, y: number, frameId: string | null = null) =>
  ({ ...createNodeElement(kind, { x: 0, y: 0 }), x, y, frameId }) as unknown as ExcalidrawElement;

const overlaps = (a: ExcalidrawElement, b: ExcalidrawElement) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("placeSubagent", () => {
  it("joins its terminal's group in the first free cell, the frame grown and unfolded", () => {
    const frame = createGroupFrame({ x: 0, y: 0, width: 784, height: 520 }, "G", { role: "general", pantheon: "egyptian", folded: true }) as unknown as ExcalidrawElement;
    const cell0 = cellAt(frame, 0, 0);
    const terminal = at("terminal", cell0.x, cell0.y, frame.id);
    const sub = at("subagent", 0, 0);
    const placed = placeSubagent([frame, terminal], sub, terminal.id)!;
    const node = placed.find((e) => e.id === sub.id)!;
    expect(node.frameId).toBe(frame.id);
    expect({ x: node.x, y: node.y }).toEqual({ x: cellAt(frame, 1, 0).x, y: cellAt(frame, 1, 0).y });
    const grown = placed.find((e) => e.id === frame.id)!;
    expect(grown.width).toBeGreaterThan(frame.width);
    expect(groupInfoOf(grown)?.folded).toBeUndefined();
    // Excalidraw keeps a frame above its children: the child goes right under it.
    expect(placed.map((e) => e.id)).toEqual([sub.id, frame.id, terminal.id]);
  });

  it("goes just below a terminal without a group", () => {
    const terminal = at("terminal", 100, 50);
    const sub = at("subagent", 0, 0);
    const node = placeSubagent([terminal], sub, terminal.id)!.find((e) => e.id === sub.id)!;
    expect({ x: node.x, y: node.y }).toEqual({ x: 100, y: 50 + terminal.height + NODE_GAP });
    expect(node.frameId).toBeNull();
  });

  it("moves clear of a node already below its terminal: a second subagent never covers the first", () => {
    const terminal = at("terminal", 0, 0);
    const first = at("subagent", 0, terminal.height + NODE_GAP);
    const second = at("subagent", 0, 0);
    const placed = placeSubagent([terminal, first], second, terminal.id)!;
    const node = placed.find((e) => e.id === second.id)!;
    expect(overlaps(node, first)).toBe(false);
    expect(overlaps(node, terminal)).toBe(false);
  });

  it("goes below its parent subagent when nested", () => {
    const terminal = at("terminal", 0, 0);
    const parent = at("subagent", 900, 0);
    const child = at("subagent", 0, 0);
    const node = placeSubagent([terminal, parent], child, parent.id)!.find((e) => e.id === child.id)!;
    expect({ x: node.x, y: node.y }).toEqual({ x: 900, y: parent.height + NODE_GAP });
  });

  it("places nothing beside an anchor that is not on the scene", () => {
    const gone = { ...at("terminal", 0, 0), isDeleted: true } as ExcalidrawElement;
    expect(placeSubagent([gone], at("subagent", 0, 0), gone.id)).toBeNull();
    expect(placeSubagent([], at("subagent", 0, 0), "nope")).toBeNull();
  });
});

describe("withoutSubagents", () => {
  it("drops subagent nodes from a stored scene and keeps everything else", () => {
    const terminal = at("terminal", 0, 0);
    const sub = at("subagent", 0, 500);
    expect(withoutSubagents([terminal, sub]).map((e) => e.id)).toEqual([terminal.id]);
  });
});
