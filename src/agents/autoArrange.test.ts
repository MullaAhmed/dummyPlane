import { describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { nodesStore } from "@/store/nodes";
import { AUTO_ARRANGE_DELAY_MS, createAutoArrangeWatch, layoutSignature } from "./autoArrange";

const node = (id: string, fields: Record<string, unknown> = {}) =>
  ({ id, type: "embeddable", x: 0, y: 0, width: 720, height: 440, isDeleted: false, customData: { kind: "terminal" }, ...fields }) as unknown as ExcalidrawElement;
const drawing = (id: string) => ({ id, type: "rectangle", isDeleted: false }) as unknown as ExcalidrawElement;

const still = { selectedElementsAreBeingDragged: false, isResizing: false, isRotating: false, newElement: null, editingFrame: null };

/** A watch whose timers run by hand. */
function setup(on = true) {
  const minimized = new Set<string>();
  const arrange = vi.fn();
  const timers: (() => void)[] = [];
  const watch = createAutoArrangeWatch({
    isMinimized: (id) => minimized.has(id),
    arrange,
    enabled: () => on,
    schedule: (run, ms) => {
      expect(ms).toBe(AUTO_ARRANGE_DELAY_MS);
      timers.push(run);
      return () => {
        const i = timers.indexOf(run);
        if (i >= 0) timers.splice(i, 1);
      };
    },
  });
  const tick = () => timers.splice(0).forEach((run) => run());
  return { watch, arrange, minimized, tick, timers };
}

describe("layoutSignature", () => {
  it("names the nodes on the canvas and which are minimized, not where they stand nor the drawings", () => {
    const minimized = new Set(["b"]);
    const signature = layoutSignature([node("b"), drawing("r"), node("a", { x: 500 }), node("gone", { isDeleted: true })], (id) => minimized.has(id));
    expect(signature).toBe("a,b:m");
  });
});

describe("the Auto-arrange watch", () => {
  it("takes note of a canvas the first time it sees it, without arranging it", () => {
    const { watch, arrange, tick } = setup();
    watch([node("a"), node("b")], still);
    tick();
    expect(arrange).not.toHaveBeenCalled();
  });

  it("arranges once after a node opens, and not again for the canvas's own moves", () => {
    const { watch, arrange, tick } = setup();
    watch([node("a")], still);
    watch([node("a"), node("b")], still);
    expect(arrange).not.toHaveBeenCalled();
    tick();
    expect(arrange).toHaveBeenCalledTimes(1);
    watch([node("a", { x: 9 }), node("b", { x: 800 })], still);
    tick();
    expect(arrange).toHaveBeenCalledTimes(1);
  });

  it("answers a terminal minimized or expanded, and a node closed", () => {
    const { watch, arrange, minimized, tick } = setup();
    watch([node("a"), node("b")], still);
    minimized.add("a");
    watch([node("a"), node("b")], still);
    tick();
    minimized.delete("a");
    watch([node("a"), node("b")], still);
    tick();
    watch([node("a")], still);
    tick();
    expect(arrange).toHaveBeenCalledTimes(3);
  });

  it("works its signature out once while only the view moves, and again when a terminal is minimized: a pan's frames", () => {
    const { watch, arrange, minimized, tick } = setup();
    const isMinimized = vi.spyOn(minimized, "has");
    const scene = [node("a", { version: 1 }), node("b", { version: 1 })];
    watch(scene, still, 2);
    expect(isMinimized).toHaveBeenCalledTimes(2);
    // A pan: the same scene, the same version, the same nodes, frame after frame.
    for (let frame = 0; frame < 60; frame++) watch(scene, still, 2);
    expect(isMinimized).toHaveBeenCalledTimes(2);
    // Minimized: its node says so before its element shrinks, and a frame of the same scene sees it.
    minimized.add("a");
    nodesStore.setState({ nodes: { ...nodesStore.getState().nodes } });
    watch(scene, still, 2);
    expect(isMinimized).toHaveBeenCalledTimes(4);
    tick();
    expect(arrange).toHaveBeenCalledTimes(1);
    // A node opened: the scene changed.
    watch([...scene, node("c", { version: 1 })], still, 3);
    tick();
    expect(arrange).toHaveBeenCalledTimes(2);
  });

  it("waits for a drag or a resize to end", () => {
    const { watch, arrange, tick, timers } = setup();
    watch([node("a")], still);
    watch([node("a"), node("b")], { ...still, selectedElementsAreBeingDragged: true });
    tick();
    expect(arrange).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    watch([node("a"), node("b")], still);
    tick();
    expect(arrange).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the setting is off", () => {
    const { watch, arrange, tick } = setup(false);
    watch([node("a")], still);
    watch([node("a"), node("b")], still);
    tick();
    expect(arrange).not.toHaveBeenCalled();
  });

  it("forgets its wait when the canvas goes", () => {
    const { watch, arrange, timers } = setup();
    watch([node("a")], still);
    watch([node("a"), node("b")], still);
    watch.dispose();
    expect(timers).toHaveLength(0);
    expect(arrange).not.toHaveBeenCalled();
  });
});
