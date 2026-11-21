// Excalidraw 0.18.1 draws a link icon at the top-right corner of every element
// that has a link, and a dummyPlane node's link is its address on the canvas
// (`dummyplane://<kind>/<id>`, src/canvas/nodeElement.ts). The result is an icon
// on every node that opens nothing. Excalidraw has no option to turn the icon
// off, so its bundle is rewritten as it is read, like the selection width
// (excalidraw-thin-selection.mjs). For a dummyplane:// link the icon is not
// drawn, and its corner is not a link target (no pointer cursor, no tooltip).
// A link on a drawn shape keeps its icon. Reading mode, where the whole node
// counts as its link, is left as it is.
// Re-check the patterns when upgrading Excalidraw: a bundle where each is not
// found exactly once fails the build instead of quietly bringing the icon back.

/** The links that get no icon: those of dummyPlane's own nodes. */
export const NODE_LINK_PREFIX = "dummyplane://";

/** Every module of Excalidraw's bundles, dev and prod: the link icon code sits in one of its chunks. */
const BUNDLE_FILE = /[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/](dev|prod)[\\/][^\\/]+\.js$/;

/**
 * `renderLinkIcon(element, context, appState, elementsMap)`, whose first line is
 * `if (element.link && !appState.selectedElementIds[element.id]) {`, in dev or minified.
 */
const DRAW =
  /(=\s*\(\s*([\w$]+)\s*,\s*[\w$]+\s*,\s*([\w$]+)\s*,\s*[\w$]+\s*\)\s*=>\s*\{\s*if\s*\(\s*)\2\.link\s*&&\s*!\s*\3\.selectedElementIds\[\s*\2\.id\s*\]/g;

/**
 * `isPointHittingLinkIcon(element, elementsMap, appState, [x, y])`, whose first line is
 * `const threshold = 4 / appState.zoom.value;`, in dev or minified: up to its opening brace.
 */
const HIT =
  /=\s*\(\s*([\w$]+)\s*,\s*[\w$]+\s*,\s*([\w$]+)\s*,\s*\[\s*[\w$]+\s*,\s*[\w$]+\s*\]\s*\)\s*=>\s*\{(?=\s*(?:const|let|var)\s+[\w$]+\s*=\s*4\s*\/\s*\2\.zoom\.value)/g;

const isNodeLink = (element) => `${element}.link.startsWith(${JSON.stringify(NODE_LINK_PREFIX)})`;

/**
 * The module's code with the link icon left out for dummyPlane's nodes, and how
 * many of each function it guarded (0 in the modules that do not hold them).
 * @param {string} code
 * @returns {{ code: string, draw: number, hit: number }}
 */
export function guardNodeLinks(code) {
  let draw = 0;
  let hit = 0;
  const guarded = code
    .replace(DRAW, (_, head, element, appState) => {
      draw += 1;
      return `${head}${element}.link && !${isNodeLink(element)} && !${appState}.selectedElementIds[${element}.id]`;
    })
    .replace(HIT, (head, element) => {
      hit += 1;
      return `${head}if (${element}.link && ${isNodeLink(element)}) return false;`;
    });
  return { code: guarded, draw, hit };
}

/**
 * The rewrite as a plugin, for Vite's build and for its dependency pre-bundling
 * in dev (rolldown), which the app's own plugins never see. Once the bundle is
 * read, each function must have been guarded exactly once, or the build fails.
 * @returns {import("./excalidraw-link-icon.d.mts").NodeLinkIconsPlugin}
 */
export function excalidrawNodeLinkIcons() {
  let seen = false;
  let draw = 0;
  let hit = 0;
  return {
    name: "excalidraw-node-link-icons",
    buildStart() {
      seen = false;
      draw = 0;
      hit = 0;
    },
    transform(code, id) {
      if (!BUNDLE_FILE.test(id)) return null;
      seen = true;
      const guarded = guardNodeLinks(code);
      if (guarded.draw === 0 && guarded.hit === 0) return null;
      draw += guarded.draw;
      hit += guarded.hit;
      return { code: guarded.code, map: null };
    },
    buildEnd(error) {
      if (error || !seen || (draw === 1 && hit === 1)) return;
      throw new Error(
        `excalidraw-node-link-icons: expected one link icon drawing and one link icon hit test in Excalidraw's bundle, found ${draw} and ${hit}`,
      );
    },
  };
}
