import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { deleteSelection, drawnSelectionOf, duplicateSelection, isDrawn, restyleSelection, sameDrawn } from "./drawnSelection";

// Minimal elements: only the fields the rules read.
const el = (id: string, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: "#29261B",
    backgroundColor: "transparent",
    groupIds: [],
    frameId: null,
    boundElements: null,
    version: 1,
    versionNonce: 1,
    updated: 1,
    index: "a0",
    isDeleted: false,
    ...overrides,
  }) as unknown as ExcalidrawElement;

const select = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, true as const]));
// Fields differ by element type (containerId, bindings): read them loosely.
const byId = (elements: ExcalidrawElement[]) => Object.fromEntries(elements.map((e) => [e.id, e as unknown as Record<string, unknown>])) as Record<string, Record<string, unknown>>;

describe("which elements the panel acts on", () => {
  it("counts shapes, text, arrows, lines, freedraw and images as drawn", () => {
    for (const type of ["rectangle", "ellipse", "diamond", "text", "arrow", "line", "freedraw", "image"]) {
      expect(isDrawn(el("x", { type }))).toBe(true);
    }
  });

  it("leaves out dummyPlane nodes (embeddables), frames and deleted elements", () => {
    expect(isDrawn(el("n", { type: "embeddable" }))).toBe(false);
    expect(isDrawn(el("f", { type: "frame" }))).toBe(false);
    expect(isDrawn(el("m", { type: "magicframe" }))).toBe(false);
    expect(isDrawn(el("d", { isDeleted: true }))).toBe(false);
  });

  it("returns only the selected drawn elements, in scene order", () => {
    const scene = [el("a"), el("node", { type: "embeddable" }), el("b"), el("c")];
    expect(drawnSelectionOf(scene, select("node", "c", "a")).map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("is empty when only nodes are selected, so the panel stays hidden", () => {
    const scene = [el("node", { type: "embeddable" })];
    expect(drawnSelectionOf(scene, select("node"))).toEqual([]);
  });

  it("tells the store when the drawn selection changed, by id and version", () => {
    const a = [el("a")];
    expect(sameDrawn(a, [el("a")])).toBe(true);
    expect(sameDrawn(a, [el("a", { version: 2 })])).toBe(false);
    expect(sameDrawn(a, [el("b")])).toBe(false);
    expect(sameDrawn(a, [])).toBe(false);
  });
});

describe("restyling the selection", () => {
  it("sets the stroke colour on the selected drawn elements only, with a new version", () => {
    const scene = [el("a"), el("b", { strokeColor: "#C93C37" }), el("node", { type: "embeddable" })];
    const out = byId(restyleSelection(scene, select("a", "node"), { strokeColor: "#3F74A8" }));
    expect(out.a.strokeColor).toBe("#3F74A8");
    expect(out.a.version).toBe(2);
    expect(out.a.versionNonce).not.toBe(1);
    expect(out.b).toBe(scene[1]); // not selected: the same object
    expect(out.node).toBe(scene[2]); // a node is never restyled
  });

  it("sets the background colour, including transparent", () => {
    const scene = [el("a", { backgroundColor: "#B07D3A" })];
    expect(restyleSelection(scene, select("a"), { backgroundColor: "transparent" })[0].backgroundColor).toBe("transparent");
  });

  it("leaves the scene as it was when nothing drawn is selected", () => {
    const scene = [el("a")];
    expect(restyleSelection(scene, select("zz"), { strokeColor: "#000000" })).toEqual(scene);
  });
});

describe("duplicating the selection", () => {
  const ids = (...names: string[]) => {
    let n = 0;
    return () => names[n++] ?? `id-${n}`;
  };

  it("copies the selected drawn elements, shifted, with new ids, and selects the copies", () => {
    const scene = [el("a", { x: 5, y: 5 }), el("b")];
    const { elements, copies } = duplicateSelection(scene, select("a"), { offset: 20, newId: ids("a2") });
    expect(copies).toEqual(["a2"]);
    expect(elements).toHaveLength(3);
    const copy = elements[2];
    expect(copy.id).toBe("a2");
    expect(copy.x).toBe(25);
    expect(copy.y).toBe(25);
    expect(copy.index).toBeNull();
    expect(elements[0]).toBe(scene[0]); // the original stays
  });

  it("gives a copy of a grouped selection the same new group", () => {
    const scene = [el("a", { groupIds: ["g1"] }), el("b", { groupIds: ["g1"] })];
    const { elements, copies } = duplicateSelection(scene, select("a", "b"), { offset: 20, newId: ids("a2", "b2", "g2") });
    const out = byId(elements);
    expect(copies).toEqual(["a2", "b2"]);
    expect(out.a2.groupIds).toEqual(["g2"]);
    expect(out.b2.groupIds).toEqual(["g2"]);
    expect(out.a.groupIds).toEqual(["g1"]);
  });

  it("keeps a text bound inside a copied container, and drops bindings to what was not copied", () => {
    const scene = [
      el("box", { boundElements: [{ id: "t", type: "text" }, { id: "arrowOut", type: "arrow" }] }),
      el("t", { type: "text", containerId: "box" }),
      el("arrowOut", { type: "arrow", startBinding: { elementId: "box", focus: 0, gap: 1 }, endBinding: { elementId: "elsewhere", focus: 0, gap: 1 } }),
    ];
    // Duplicate the box and its text, not the arrow.
    const { elements, copies } = duplicateSelection(scene, select("box", "t"), { offset: 20, newId: ids("box2", "t2") });
    const out = byId(elements);
    expect(copies).toEqual(["box2", "t2"]);
    expect(out.t2.containerId).toBe("box2");
    expect(out.box2.boundElements).toEqual([{ id: "t2", type: "text" }]);
    expect(out.t.containerId).toBe("box");
  });

  it("drops the binding of a copy to an element that was not duplicated", () => {
    const scene = [el("arrow", { type: "arrow", startBinding: { elementId: "box", focus: 0, gap: 1 }, endBinding: null })];
    const { elements } = duplicateSelection(scene, select("arrow"), { offset: 20, newId: ids("arrow2") });
    expect(byId(elements).arrow2.startBinding).toBeNull();
    expect(byId(elements).arrow2.endBinding).toBeNull();
  });

  it("copies nothing, and says so, when no drawn element is selected", () => {
    const scene = [el("node", { type: "embeddable" })];
    expect(duplicateSelection(scene, select("node"), { offset: 20, newId: ids() })).toEqual({ elements: scene, copies: [] });
  });
});

describe("deleting the selection", () => {
  it("soft-deletes the selected drawn elements and the texts bound inside them", () => {
    const scene = [el("box"), el("t", { type: "text", containerId: "box" }), el("other")];
    const out = byId(deleteSelection(scene, select("box")));
    expect(out.box.isDeleted).toBe(true);
    expect(out.t.isDeleted).toBe(true);
    expect(out.other.isDeleted).toBe(false);
  });

  it("never deletes a node", () => {
    const scene = [el("node", { type: "embeddable" }), el("a")];
    const out = byId(deleteSelection(scene, select("node", "a")));
    expect(out.node.isDeleted).toBe(false);
    expect(out.a.isDeleted).toBe(true);
  });
});
