/** The links that get no icon: those of dummyPlane's own nodes. */
export const NODE_LINK_PREFIX: string;

/** The module's code with the link icon left out for dummyPlane's nodes, and how many of each function it guarded. */
export function guardNodeLinks(code: string): { code: string; draw: number; hit: number };

/** The rewrite as a Vite (and rolldown) plugin; its build fails unless each function was guarded exactly once. */
export interface NodeLinkIconsPlugin {
  name: string;
  buildStart(): void;
  transform(code: string, id: string): { code: string; map: null } | null;
  buildEnd(error?: Error): void;
}

/** The rewrite as a plugin, for Vite's build and for its dependency pre-bundling in dev. */
export function excalidrawNodeLinkIcons(): NodeLinkIconsPlugin;
