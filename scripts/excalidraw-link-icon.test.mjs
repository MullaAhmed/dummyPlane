import { describe, expect, it } from "vitest";
import { excalidrawNodeLinkIcons, guardNodeLinks } from "./excalidraw-link-icon.mjs";

// The two functions as Excalidraw 0.18.1 writes them, dev and minified, with the drawing reduced to a record.
const DEV = [
  "var renderLinkIcon = (element, context, appState, elementsMap) => {",
  "  if (element.link && !appState.selectedElementIds[element.id]) {",
  "    context.drawn.push(element.id);",
  "  }",
  "};",
  "var isPointHittingLinkIcon = (element, elementsMap, appState, [x, y]) => {",
  "  const threshold = 4 / appState.zoom.value;",
  "  return x > -threshold && y > -threshold;",
  "};",
].join("\n");
const PROD =
  "var ap=null,sp=(e,t,n,r)=>{if(e.link&&!n.selectedElementIds[e.id]){t.drawn.push(e.id)}},b7=(e,t,n,[r,o])=>{let i=4/n.zoom.value;return r>-i&&o>-i};";

/** The drawing and the hit test the code defines. */
const load = (code, draw, hit) => new Function(`${code}\nreturn [${draw}, ${hit}];`)();

const node = { id: "node", link: "dummyplane://terminal/t1" };
const shape = { id: "shape", link: "https://example.com" };
const appState = { selectedElementIds: {}, zoom: { value: 1 } };

describe("guardNodeLinks", () => {
  it("draws no link icon for a node and leaves its corner unhit, in both of Excalidraw's bundles", () => {
    for (const [code, draw, hit] of [
      [DEV, "renderLinkIcon", "isPointHittingLinkIcon"],
      [PROD, "sp", "b7"],
    ]) {
      const guarded = guardNodeLinks(code);
      expect(guarded).toMatchObject({ draw: 1, hit: 1 });
      const [renderLinkIcon, isPointHittingLinkIcon] = load(guarded.code, draw, hit);
      const context = { drawn: [] };
      renderLinkIcon(node, context, appState, new Map());
      renderLinkIcon(shape, context, appState, new Map());
      expect(context.drawn).toEqual(["shape"]);
      expect(isPointHittingLinkIcon(node, new Map(), appState, [0, 0])).toBe(false);
      expect(isPointHittingLinkIcon(shape, new Map(), appState, [0, 0])).toBe(true);
    }
  });

  it("leaves a module without them as it is", () => {
    const code = "var isPointHittingLink = (element, elementsMap, appState, [x, y], isMobile) => {};";
    expect(guardNodeLinks(code)).toEqual({ code, draw: 0, hit: 0 });
  });
});

describe("excalidrawNodeLinkIcons", () => {
  const build = (modules) => {
    const plugin = excalidrawNodeLinkIcons();
    plugin.buildStart();
    const out = modules.map(([code, id]) => plugin.transform(code, id));
    plugin.buildEnd();
    return out;
  };

  it("rewrites Excalidraw's modules only, on Windows paths too", () => {
    const { transform } = excalidrawNodeLinkIcons();
    const guarded = guardNodeLinks(PROD).code;
    expect(transform(PROD, "D:\\app\\node_modules\\@excalidraw\\excalidraw\\dist\\prod\\chunk-K2UTITRG.js")?.code).toBe(guarded);
    expect(transform(PROD, "/app/node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js")?.code).toBe(guarded);
    expect(transform(PROD, "/app/src/canvas/Canvas.tsx")).toBeNull();
    expect(transform("var a = 1;", "/app/node_modules/@excalidraw/excalidraw/dist/prod/index.js")).toBeNull();
  });

  it("fails the build when Excalidraw's bundle no longer has each function exactly once", () => {
    const id = (name) => `/app/node_modules/@excalidraw/excalidraw/dist/prod/${name}`;
    expect(() => build([["var a = 1;", id("index.js")]])).toThrow(/found 0 and 0/);
    expect(() => build([[DEV, id("chunk-A.js")], [PROD, id("chunk-B.js")]])).toThrow(/found 2 and 2/);
    expect(() => build([["var a = 1;", id("index.js")], [DEV, id("chunk-A.js")]])).not.toThrow();
  });

  it("checks nothing in a build that never read Excalidraw, or that failed already", () => {
    expect(() => build([["var a = 1;", "/app/src/main.tsx"]])).not.toThrow();
    const plugin = excalidrawNodeLinkIcons();
    plugin.buildStart();
    plugin.transform("var a = 1;", "/app/node_modules/@excalidraw/excalidraw/dist/dev/index.js");
    expect(() => plugin.buildEnd(new Error("earlier"))).not.toThrow();
  });
});
