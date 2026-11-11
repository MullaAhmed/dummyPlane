import { describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
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
