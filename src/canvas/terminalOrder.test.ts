import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { readingOrder, stepTerminal, terminalOrder } from "./terminalOrder";

const element = (fields: Record<string, unknown>) =>
  ({ x: 0, y: 0, width: 100, height: 100, isDeleted: false, frameId: null, angle: 0, ...fields }) as unknown as ExcalidrawElement;
const frame = (id: string, x: number, y: number, width: number, height: number, fields: Record<string, unknown> = {}) =>
  element({ id, type: "frame", name: id, x, y, width, height, ...fields });
const terminal = (id: string, frameId: string | null, x: number, y: number) =>
  element({ id, type: "embeddable", customData: { kind: "terminal" }, frameId, x, y, width: 300, height: 200 });

describe("terminalOrder (spec fenêtre §6.3)", () => {
  it("reads the spec's example: blocks in reading order, members row by row, isolated terminals last", () => {
    const scene = [
      element({ id: "robin", type: "embeddable", customData: { kind: "terminal" }, x: 1300, y: 820, width: 300, height: 200 }),
      frame("tests", 0, 800, 400, 300),
      terminal("zatanna", "tests", 40, 840),
      frame("front", 900, 0, 400, 700),
      terminal("nightwing", "front", 940, 480),
      terminal("aquaman", "front", 940, 40),
      terminal("batgirl", "front", 940, 260),
      frame("backend", 0, 0, 800, 500, { customData: { dummyplane: { kind: "group", role: "backend", pantheon: "egypt" } } }),
      terminal("superman", "backend", 420, 280),
      terminal("batman", "backend", 40, 40),
      terminal("flash", "backend", 40, 280),
      terminal("cyborg", "backend", 420, 40),
    ];
    expect(terminalOrder(scene)).toEqual(["batman", "cyborg", "flash", "superman", "aquaman", "batgirl", "nightwing", "zatanna", "robin"]);
  });

  it("puts two blocks on one row when they overlap by half the smaller height, on two rows below that", () => {
    const scene = (secondTop: number) => [
      frame("a", 1000, 0, 400, 200),
      terminal("in-a", "a", 1010, 0),
      frame("b", 0, secondTop, 400, 400),
      terminal("in-b", "b", 10, secondTop),
    ];
    // Overlap 100 = half of 200: same row, read left to right.
    expect(terminalOrder(scene(100))).toEqual(["in-b", "in-a"]);
    // Overlap 99: B opens a row below A.
    expect(terminalOrder(scene(101))).toEqual(["in-a", "in-b"]);
  });

  it("treats a drawing frame as a block, skips deleted elements and empty frames", () => {
    const scene = [
      frame("empty", 0, 0, 200, 200),
      frame("drawing", 500, 0, 400, 300),
      terminal("drawn", "drawing", 510, 10),
      terminal("alone", null, 0, 400),
      element({ id: "gone", type: "embeddable", customData: { kind: "terminal" }, x: 0, y: 0, isDeleted: true }),
      element({ id: "box", type: "rectangle", x: 0, y: 0 }),
    ];
    expect(terminalOrder(scene)).toEqual(["drawn", "alone"]);
  });
});

describe("readingOrder", () => {
  it("joins a row by its first box, then reads it left to right", () => {
    const boxes = [
      { id: "c", x: 0, y: 260, width: 10, height: 100 },
      { id: "b", x: 300, y: 10, width: 10, height: 100 },
      { id: "a", x: 0, y: 0, width: 10, height: 100 },
    ];
    expect(readingOrder(boxes).map((b) => b.id)).toEqual(["a", "b", "c"]);
  });
});

describe("stepTerminal", () => {
  const order = ["batman", "cyborg", "flash"];

  it("goes to the next or the previous terminal, wrapping around", () => {
    expect(stepTerminal(order, "batman", 1)).toBe("cyborg");
    expect(stepTerminal(order, "flash", 1)).toBe("batman");
    expect(stepTerminal(order, "batman", -1)).toBe("flash");
    expect(stepTerminal(order, "cyborg", -1)).toBe("batman");
  });

  it("starts at the first or the last without a current terminal, or with an unknown current terminal", () => {
    expect(stepTerminal(order, null, 1)).toBe("batman");
    expect(stepTerminal(order, null, -1)).toBe("flash");
    expect(stepTerminal(order, "closed-meanwhile", 1)).toBe("batman");
    expect(stepTerminal(order, "closed-meanwhile", -1)).toBe("flash");
  });

  it("goes nowhere in a workspace without terminals", () => {
    expect(stepTerminal([], null, 1)).toBeNull();
  });
});
