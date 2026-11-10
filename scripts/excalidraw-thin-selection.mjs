// Excalidraw 0.18.1 outlines the embeddable being worked in (a terminal one types
// into) 4px wide, against 1px for any other selection: in the dark palettes, a
// thick off-white band that hides what sits beside the terminal (its edit tab).
// The width is a constant of its renderer, out of reach of CSS, so the bundle
// is rewritten as it is read: the active one gets the 1px of any selection.
// Re-check the pattern when upgrading Excalidraw: a rewrite that finds nothing
// fails the build instead of silently keeping the thick band.

/** Excalidraw's own bundles, dev and prod: the only modules rewritten. */
const BUNDLE = /[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/](dev|prod)[\\/]index\.js$/;

/** `lineWidth = (activeEmbeddable ? 4 : 1)` in dev, `lineWidth=(p?4:1)` once minified. */
const ACTIVE_WIDTH = /lineWidth\s*=\s*\(\s*[\w$]+\s*\?\s*4\s*:\s*1\s*\)/g;

/**
 * The bundle's code with the active embeddable outlined 1px wide; throws when
 * the pattern is not there exactly once (another Excalidraw version).
 * @param {string} code
 * @param {string} id
 * @returns {string}
 */
export function thinActiveSelection(code, id) {
  const found = code.match(ACTIVE_WIDTH)?.length ?? 0;
  if (found !== 1) throw new Error(`excalidraw-thin-selection: expected one active-embeddable outline in ${id}, found ${found}`);
  return code.replace(ACTIVE_WIDTH, "lineWidth = (1)");
}

/**
 * The rewrite as a plugin, for Vite's build and for its dependency pre-bundling
 * in dev (rolldown), which the app's own plugins never see.
 * @returns {{ name: string, transform: (code: string, id: string) => { code: string, map: null } | null }}
 */
export function excalidrawThinSelection() {
  return {
    name: "excalidraw-thin-selection",
    transform(code, id) {
      return BUNDLE.test(id) ? { code: thinActiveSelection(code, id), map: null } : null;
    },
  };
}
