import { expect, it } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createNodeElement } from "@/canvas/nodeElement";
import { wirePaths } from "@/canvas/overlay/wirePaths";
import { layoutSpawnTree } from "./spawnLayout";
import { isSpawnWire, withWire } from "./wires";

function terminal(id: string, x: number, y: number): ExcalidrawElement {
  return { ...(createNodeElement("terminal", { x: 0, y: 0 }) as unknown as ExcalidrawElement), id, x, y };
}

it("keeps a spawn wire's mark when the flowchart layout reroutes it, so its light still runs", () => {
  // spawn_agent's order: the child where addTerminal left it, then the wire, then the layout.
  const scene = withWire([terminal("parent", 0, 0), terminal("child", 4000, 3000)], "parent", "child", "calm", true);
  const laid = layoutSpawnTree(scene, (id) => (id === "child" ? "parent" : null), "child");
  expect(laid).not.toBeNull();
  const wire = laid!.find((e) => e.type === "arrow") as ExcalidrawArrowElement;
  const before = scene.find((e) => e.type === "arrow") as ExcalidrawArrowElement;
  // Rerouted: the child moved next to its parent and the wire followed.
  expect(laid!.find((e) => e.id === "child")!.x).not.toBe(4000);
  expect(wire.points).not.toEqual(before.points);
  expect(isSpawnWire(wire)).toBe(true);
  expect(wire).toMatchObject({ startBinding: { elementId: "parent" }, endBinding: { elementId: "child" } });
  expect(wirePaths(laid!)).toEqual([expect.objectContaining({ id: wire.id, fleetId: "parent", targetId: "child" })]);
});

it("lays a Fleet's sub-agents out as a flowchart beside it, each on its spawn wire", () => {
  const fleet = { ...(createNodeElement("fleet", { x: 0, y: 0 }) as unknown as ExcalidrawElement), id: "fleet", x: 0, y: 0 };
  // Two sub-agents where addTerminal left them, far off; then their wires, then the layout.
  let scene: ExcalidrawElement[] = [fleet, terminal("a", 4000, 3000), terminal("b", -3000, 5000)];
  scene = withWire(scene, "fleet", "a", "calm", true);
  scene = withWire(scene, "fleet", "b", "calm", true);
  const laid = layoutSpawnTree(scene, (id) => (id === "a" || id === "b" ? "fleet" : null), "b")!;
  expect(laid).not.toBeNull();
  const at = (id: string) => laid.find((e) => e.id === id)!;
  // The Fleet stays; its sub-agents take one column right of it, the first level with its top, the second under it.
  expect(at("fleet")).toMatchObject({ x: 0, y: 0 });
  expect(at("a").x).toBeGreaterThan(fleet.width);
  expect(at("b").x).toBe(at("a").x);
  expect(at("a").y).toBe(0);
  expect(at("b").y).toBeGreaterThan(at("a").y + at("a").height);
  const wires = laid.filter((e) => e.type === "arrow") as ExcalidrawArrowElement[];
  expect(wires).toHaveLength(2);
  expect(wires.every(isSpawnWire)).toBe(true);
  expect(wires.map((w) => [w.startBinding?.elementId, w.endBinding?.elementId])).toEqual([
    ["fleet", "a"],
    ["fleet", "b"],
  ]);
  expect(wirePaths(laid).map((p) => [p.fleetId, p.targetId])).toEqual([
    ["fleet", "a"],
    ["fleet", "b"],
  ]);
});
