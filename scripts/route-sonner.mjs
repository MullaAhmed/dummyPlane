// The notification history records every popup the app shows. Popups are sonner's toasts, called from a
// hundred places, and sonner offers no way to listen to them but a hook that only sees them a tick late.
// So every import of "sonner" is sent to a shim (src/notifications/sonner.ts) that re-exports sonner and
// records what its `toast` shows. Only the shim's own folder reads the real package, or the shim would
// import itself. TypeScript keeps reading the real package's types: the shim is typed the same.

import { fileURLToPath } from "node:url";

/** The shim, and the folder that is allowed to import the real package. */
const SHIM = fileURLToPath(new URL("../src/notifications/sonner.ts", import.meta.url));
const OWN_FOLDER = SHIM.replace(/\\/g, "/").replace(/[^/]*$/, "").toLowerCase();

/**
 * Whether `importer` is a file of the shim's folder. Compared whole and case-insensitively on slashes
 * normalised: a worktree's own path can hold "notifications" too, so a substring would match it.
 * @param {string} importer
 * @returns {boolean}
 */
export function importsRealSonner(importer) {
  const file = importer.split("?")[0].replace(/\\/g, "/").toLowerCase();
  return file.startsWith(OWN_FOLDER);
}

/**
 * The routing as a plugin, for Vite's build, its dev server and Vitest (the same config).
 * @returns {{ name: string, enforce: "pre", resolveId: (source: string, importer?: string) => string | null }}
 */
export function routeSonner() {
  return {
    name: "route-sonner",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "sonner" || !importer) return null;
      return importsRealSonner(importer) ? null : SHIM;
    },
  };
}
