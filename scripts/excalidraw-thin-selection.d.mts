import type { Plugin } from "vite";

/** The bundle's code with the active embeddable outlined 1px wide; throws when the pattern is not there exactly once. */
export function thinActiveSelection(code: string, id: string): string;

/** The rewrite as a plugin, for Vite's build and for its dependency pre-bundling in dev. */
export function excalidrawThinSelection(): Plugin;
