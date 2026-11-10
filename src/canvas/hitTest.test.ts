import { describe, expect, it } from "vitest";
import { createNodeElement } from "./nodeElement";
import { findTerminalAt, findTerminalOrFleetAt } from "./hitTest";

// Terminals are 720x440; centered on (360, 220) they span x 0..720, y 0..440.
const at = (x: number, y: number) => createNodeElement("terminal", { x: x + 360, y: y + 220 });

it("finds the terminal under the point", () => {
  const terminal = at(0, 0);
  expect(findTerminalAt([terminal], 10, 10)).toBe(terminal);
  expect(findTerminalAt([terminal], 800, 10)).toBeNull();
});

it("prefers the topmost terminal when two overlap", () => {
  const below = at(0, 0);
  const above = at(100, 100);
  expect(findTerminalAt([below, above], 200, 200)).toBe(above);
});

it("skips deleted terminals and other node kinds", () => {
  const deleted = { ...at(0, 0), isDeleted: true };
  const note = createNodeElement("note", { x: 10, y: 10 });
  expect(findTerminalAt([deleted, note], 10, 10)).toBeNull();
});

it("ignores a terminal that a folded group keeps hidden (locked)", () => {
  const hidden = { ...at(0, 0), locked: true };
  expect(findTerminalAt([hidden], 10, 10)).toBeNull();
});

it("finds a node the eraser guard locked, which is not one a folded group keeps hidden", () => {
  const guarded = { ...at(0, 0), locked: true, customData: { kind: "terminal", eraserLock: true } };
  expect(findTerminalAt([guarded], 10, 10)).toBe(guarded);
  expect(findTerminalAt([{ ...guarded, customData: { kind: "terminal" } }], 10, 10)).toBeNull();
});

// The Fleet is 640x760; centered on (320, 380) it spans x 0..640, y 0..760.
const fleetAt = (x: number, y: number) => createNodeElement("fleet", { x: x + 320, y: y + 380 });

describe("findTerminalAt", () => {
  it("does not take the Fleet for a terminal", () => {
    expect(findTerminalAt([fleetAt(0, 0)], 10, 10)).toBeNull();
  });
});

describe("findTerminalOrFleetAt", () => {
  it("finds a terminal and the Fleet under the point", () => {
    const terminal = at(0, 0);
    const fleet = fleetAt(2000, 0);
    expect(findTerminalOrFleetAt([terminal, fleet], 10, 10)).toBe(terminal);
    expect(findTerminalOrFleetAt([terminal, fleet], 2010, 10)).toBe(fleet);
    expect(findTerminalOrFleetAt([terminal, fleet], 1500, 10)).toBeNull();
  });

  it("prefers the topmost of the two kinds when they overlap", () => {
    const terminal = at(0, 0);
    const fleet = fleetAt(100, 100);
    expect(findTerminalOrFleetAt([terminal, fleet], 200, 200)).toBe(fleet);
    expect(findTerminalOrFleetAt([fleet, terminal], 200, 200)).toBe(terminal);
  });

  it("skips deleted and locked nodes and the other kinds", () => {
    const deleted = { ...at(0, 0), isDeleted: true };
    const hidden = { ...fleetAt(0, 0), locked: true };
    const note = createNodeElement("note", { x: 10, y: 10 });
    const kanban = createNodeElement("kanban", { x: 10, y: 10 });
    expect(findTerminalOrFleetAt([deleted, hidden, note, kanban], 10, 10)).toBeNull();
  });

  it("skips elements that are not nodes", () => {
    const drawn = { ...at(0, 0), customData: undefined };
    expect(findTerminalOrFleetAt([drawn], 10, 10)).toBeNull();
  });
});
