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
