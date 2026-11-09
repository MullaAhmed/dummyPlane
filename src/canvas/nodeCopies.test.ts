import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { classifyAddedNodes, sourceIdOf } from "./nodeCopies";

const element = (id: string, link: string) => ({ id, link }) as unknown as ExcalidrawElement;

describe("sourceIdOf", () => {
  it("reads the node id of an dummyPlane link", () => {
    expect(sourceIdOf("dummyplane://terminal/abc-1")).toBe("abc-1");
    expect(sourceIdOf("https://example.com")).toBeNull();
    expect(sourceIdOf(null)).toBeNull();
  });
});

describe("classifyAddedNodes", () => {
  const records = new Set(["t1", "t2"]);
  const has = (id: string) => records.has(id);

  it("tells undone deletions, Excalidraw copies and orphans apart", () => {
    const elements = [
      element("t1", "dummyplane://terminal/t1"),
      element("copy", "dummyplane://terminal/t2"),
      element("ghost", "dummyplane://terminal/gone"),
      element("pasted", "dummyplane://terminal/pasted"),
    ];
    expect(classifyAddedNodes(["t1", "copy", "ghost", "pasted"], elements, has)).toEqual({
      restored: ["t1"],
      copies: [{ id: "copy", sourceId: "t2" }],
      orphans: ["ghost", "pasted"],
    });
  });

  it("treats a copy whose source lives in another workspace as a copy", () => {
    expect(classifyAddedNodes(["c"], [element("c", "dummyplane://terminal/t1")], has).copies).toEqual([
      { id: "c", sourceId: "t1" },
    ]);
  });
});
