import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createNodeElement, fromStoredKind, isDummyPlaneLink, nodeKindOf, STORED_FLEET_KIND, toStoredKind } from "./nodeElement";

describe("createNodeElement", () => {
  it("makes a 640 × 760 fleet linked to its own id", () => {
    const element = createNodeElement("fleet", { x: 0, y: 0 });
    expect(element).toMatchObject({ x: -320, y: -380, width: 640, height: 760 });
    expect(nodeKindOf(element as unknown as ExcalidrawElement)).toBe("fleet");
    expect(isDummyPlaneLink(element.link!)).toBe(true);
  });

  it("saves a fleet under its stored kind: the scene still says orchestrator, in customData and in the link", () => {
    const element = createNodeElement("fleet", { x: 0, y: 0 });
    expect(STORED_FLEET_KIND).toBe("orchestrator");
    expect(element.customData).toEqual({ kind: "orchestrator" });
    expect(element.link).toBe(`dummyplane://orchestrator/${element.id}`);
  });

  it("loads a fleet saved before it was renamed: its element reads as a fleet", () => {
    // What a scene stored by an older build holds.
    const saved = { ...createNodeElement("note", { x: 0, y: 0 }), customData: { kind: "orchestrator" }, link: "dummyplane://orchestrator/abc-1" };
    expect(nodeKindOf(saved as unknown as ExcalidrawElement)).toBe("fleet");
    expect(isDummyPlaneLink(saved.link)).toBe(true);
  });

  it("does not take the in-memory kind for a stored one", () => {
    const element = { ...createNodeElement("note", { x: 0, y: 0 }), customData: { kind: "fleet" } };
    expect(nodeKindOf(element as unknown as ExcalidrawElement)).toBeNull();
    expect(isDummyPlaneLink("dummyplane://fleet/abc-1")).toBe(false);
  });

  it("centers a terminal on the given point and links it to its own id", () => {
    const element = createNodeElement("terminal", { x: 100, y: 50 });
    expect(element).toMatchObject({ type: "embeddable", x: -260, y: -170, width: 720, height: 440 });
    expect(element.link).toBe(`dummyplane://terminal/${element.id}`);
    expect(element.customData).toEqual({ kind: "terminal" });
  });

  it("gives every node a fresh id", () => {
    expect(createNodeElement("note", { x: 0, y: 0 }).id).not.toBe(createNodeElement("note", { x: 0, y: 0 }).id);
  });
});

describe("isDummyPlaneLink", () => {
  it("accepts our node links only", () => {
    expect(isDummyPlaneLink("dummyplane://kanban/3f2a-b1")).toBe(true);
    expect(isDummyPlaneLink("https://youtube.com/watch?v=x")).toBe(false);
    expect(isDummyPlaneLink("dummyplane://browser/1")).toBe(false);
    expect(isDummyPlaneLink("dummyplane://note/1?x=<script>")).toBe(false);
  });
});

describe("stored kinds", () => {
  it("translate the fleet in one place and leave the other kinds alone", () => {
    expect(toStoredKind("fleet")).toBe("orchestrator");
    expect(fromStoredKind("orchestrator")).toBe("fleet");
    for (const kind of ["terminal", "note", "kanban", "git", "file", "subagent"] as const) {
      expect(toStoredKind(kind)).toBe(kind);
      expect(fromStoredKind(kind)).toBe(kind);
    }
    expect(fromStoredKind("fleet")).toBeNull();
    expect(fromStoredKind(undefined)).toBeNull();
  });
});

describe("nodeKindOf", () => {
  it("reads the kind of an dummyPlane embeddable", () => {
    expect(nodeKindOf(createNodeElement("git", { x: 0, y: 0 }))).toBe("git");
  });

  it("ignores other elements and unknown kinds", () => {
    const rectangle = { ...createNodeElement("note", { x: 0, y: 0 }), type: "rectangle" } as unknown as ExcalidrawElement;
    expect(nodeKindOf(rectangle)).toBeNull();
    const unknown = { ...createNodeElement("note", { x: 0, y: 0 }), customData: { kind: "browser" } };
    expect(nodeKindOf(unknown)).toBeNull();
  });
});

describe("an agent's output", () => {
  it("is a node of its own kind, linked dummyplane://output/<id>, saved and read under that kind", () => {
    const element = createNodeElement("output", { x: 0, y: 0 });
    expect(element.link).toBe(`dummyplane://output/${element.id}`);
    expect(isDummyPlaneLink(element.link!)).toBe(true);
    expect(nodeKindOf(element as unknown as ExcalidrawElement)).toBe("output");
    expect(toStoredKind("output")).toBe("output");
    expect(fromStoredKind("output")).toBe("output");
  });
});
