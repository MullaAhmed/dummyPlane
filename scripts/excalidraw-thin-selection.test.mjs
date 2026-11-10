import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { excalidrawThinSelection, thinActiveSelection } from "./excalidraw-thin-selection.mjs";

const bundle = (flavour) => fileURLToPath(new URL(`../node_modules/@excalidraw/excalidraw/dist/${flavour}/index.js`, import.meta.url));

describe("thinActiveSelection", () => {
  it("outlines the active embeddable 1px wide in both of the installed Excalidraw's bundles", () => {
    for (const flavour of ["dev", "prod"]) {
      const code = readFileSync(bundle(flavour), "utf8");
      const thin = thinActiveSelection(code, flavour);
      expect(thin).not.toMatch(/lineWidth\s*=\s*\(\s*[\w$]+\s*\?\s*4\s*:\s*1\s*\)/);
      expect(thin).toContain("lineWidth = (1)");
    }
  });

  it("fails loudly on a bundle that no longer has the pattern, or has it twice", () => {
    expect(() => thinActiveSelection("ctx.lineWidth = 2;", "other")).toThrow(/found 0/);
    expect(() => thinActiveSelection("a.lineWidth=(p?4:1);b.lineWidth=(q?4:1)", "twice")).toThrow(/found 2/);
  });
});

describe("excalidrawThinSelection", () => {
  const { transform } = excalidrawThinSelection();

  it("rewrites Excalidraw's bundles only, on Windows paths too", () => {
    const code = "e.lineWidth=(p?4:1)/o.zoom.value";
    expect(transform(code, "D:\\app\\node_modules\\@excalidraw\\excalidraw\\dist\\prod\\index.js")?.code).toBe("e.lineWidth = (1)/o.zoom.value");
    expect(transform(code, "/app/node_modules/@excalidraw/excalidraw/dist/dev/index.js")?.code).toBe("e.lineWidth = (1)/o.zoom.value");
    expect(transform(code, "/app/src/canvas/Canvas.tsx")).toBeNull();
    expect(transform(code, "/app/node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js")).toBeNull();
  });
});
