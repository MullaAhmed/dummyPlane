import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { excalidrawNodeLinkIcons, NODE_LINK_PREFIX } from "../../scripts/excalidraw-link-icon.mjs";
import { thinActiveSelection } from "../../scripts/excalidraw-thin-selection.mjs";
import { NODE_SIZE, nodeLink, type NodeKind } from "./nodeElement";

/**
 * Excalidraw draws a link icon at the corner of every element with a link, and a node's link is its
 * `dummyplane://` address. The build rewrites Excalidraw's bundle as it is read
 * (scripts/excalidraw-link-icon.mjs, registered in vite.config.ts for the build and for dev's pre-bundling)
 * so that no icon is drawn for those links and the corner where it would be is no link to point at.
 * These tests run that rewrite, after the selection width's, on the installed Excalidraw: they fail when
 * an upgrade moves the code it looks for.
 */
const GUARD = `.link.startsWith(${JSON.stringify(NODE_LINK_PREFIX)})`;

/** Every module of one of the installed Excalidraw's bundles, read and rewritten as vite.config.ts does. */
function rewrittenBundle(flavour: "dev" | "prod"): { code: string; index: string } {
  const dir = new URL(`../../node_modules/@excalidraw/excalidraw/dist/${flavour}/`, import.meta.url);
  const plugin = excalidrawNodeLinkIcons();
  plugin.buildStart();
  const modules = readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => {
      const id = fileURLToPath(new URL(name, dir));
      const read = readFileSync(id, "utf8");
      const thin = name === "index.js" ? thinActiveSelection(read, id) : read;
      return { name, code: plugin.transform(thin, id)?.code ?? thin };
    });
  plugin.buildEnd();
  return {
    code: modules.map((module) => module.code).join("\n"),
    index: modules.find((module) => module.name === "index.js")?.code ?? "",
  };
}

describe("the rewrite that hides the link icon on dummyPlane's nodes", () => {
  it("guards the icon's drawing and its hit test in the dev bundle", () => {
    const { code } = rewrittenBundle("dev");
    expect(code.split(GUARD).length - 1).toBe(2);
    expect(code).toMatch(
      /var renderLinkIcon = \(element, context, appState, elementsMap\) => \{\s*if \(element\.link && !element\.link\.startsWith\("dummyplane:\/\/"\) && !appState\.selectedElementIds\[element\.id\]\) \{/,
    );
    expect(code).toMatch(
      /var isPointHittingLinkIcon = \(element, elementsMap, appState, \[x, y\]\) => \{if \(element\.link && element\.link\.startsWith\("dummyplane:\/\/"\)\) return false;\s*const threshold = 4 \/ appState\.zoom\.value;/,
    );
  });

  it("guards the icon's drawing and its hit test in the prod bundle", () => {
    const { code } = rewrittenBundle("prod");
    expect(code.split(GUARD).length - 1).toBe(2);
    // renderLinkIcon, minified: the element is its first parameter, appState its third.
    expect(code).toMatch(/=\(([\w$]+),[\w$]+,([\w$]+),[\w$]+\)=>\{if\(\1\.link && !\1\.link\.startsWith\("dummyplane:\/\/"\) && !\2\.selectedElementIds\[\1\.id\]\)\{/);
    // isPointHittingLinkIcon, minified: the guard, then its 4px threshold.
    expect(code).toMatch(/=\(([\w$]+),[\w$]+,([\w$]+),\[[\w$]+,[\w$]+\]\)=>\{if \(\1\.link && \1\.link\.startsWith\("dummyplane:\/\/"\)\) return false;let [\w$]+=4\/\2\.zoom\.value/);
  });

  it("keeps the selection width's rewrite in both bundles", () => {
    for (const flavour of ["dev", "prod"] as const) {
      const { index } = rewrittenBundle(flavour);
      expect(index).toContain("lineWidth = (1)");
      expect(index).not.toMatch(/lineWidth\s*=\s*\(\s*[\w$]+\s*\?\s*4\s*:\s*1\s*\)/);
    }
  });

  it("covers the link of every kind of node", () => {
    for (const kind of Object.keys(NODE_SIZE) as NodeKind[]) {
      expect(nodeLink(kind, "n1").startsWith(NODE_LINK_PREFIX)).toBe(true);
    }
  });
});
