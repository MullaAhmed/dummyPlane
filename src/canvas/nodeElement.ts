import type { ExcalidrawElement, ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";

export type NodeKind = "terminal" | "fleet" | "note" | "kanban" | "git" | "file" | "subagent";

const NODE_KINDS: readonly NodeKind[] = ["terminal", "fleet", "note", "kanban", "git", "file", "subagent"];

/**
 * Stored data: how a fleet's kind is saved, in the `nodes` table of the database (`nodes.kind`), in the
 * `customData.kind` of its scene element and in that element's link (`dummyplane://orchestrator/<id>`).
 * It dates from when the fleet was called the orchestrator: saved projects and older builds read it, so it
 * never changes. Everything else in the app says `"fleet"`: `toStoredKind` and `fromStoredKind` are the only
 * places that translate, and every stored kind goes through them (scene elements, `ipc/db.ts`).
 */
export const STORED_FLEET_KIND = "orchestrator";

/** A node kind as it is saved. */
export type StoredNodeKind = Exclude<NodeKind, "fleet"> | typeof STORED_FLEET_KIND;

/** The kind to write in a scene element or in the database. */
export function toStoredKind(kind: NodeKind): StoredNodeKind {
  return kind === "fleet" ? STORED_FLEET_KIND : kind;
}

/** The kind of a saved node, null for one this build does not know. */
export function fromStoredKind(stored: unknown): NodeKind | null {
  if (stored === STORED_FLEET_KIND) return "fleet";
  // "fleet" itself is never written: it is not a stored kind.
  return stored !== "fleet" && NODE_KINDS.includes(stored as NodeKind) ? (stored as NodeKind) : null;
}

/** The link of a node's embeddable element (`dummyplane://<stored kind>/<id>`). */
export function nodeLink(kind: NodeKind, id: string): string {
  return `dummyplane://${toStoredKind(kind)}/${id}`;
}

export const NODE_SIZE: Record<NodeKind, { width: number; height: number }> = {
  terminal: { width: 720, height: 440 },
  fleet: { width: 640, height: 760 },
  note: { width: 320, height: 240 },
  kanban: { width: 640, height: 400 },
  git: { width: 360, height: 320 },
  file: { width: 520, height: 420 },
  // A group cell: a subagent joins its terminal's grid (src/nodes/subagent).
  subagent: { width: 720, height: 440 },
};

const LINK_PATTERN = new RegExp(`^dummyplane://(${NODE_KINDS.map(toStoredKind).join("|")})/[\\w-]+$`);

/** Only our own nodes may be embedded: no arbitrary iframes on the canvas. */
export function isDummyPlaneLink(link: string): boolean {
  return LINK_PATTERN.test(link);
}

/** The kind of the dummyPlane node an element is, read from its stored kind; null for any other element. */
export function nodeKindOf(element: ExcalidrawElement): NodeKind | null {
  return element.type === "embeddable" ? fromStoredKind(element.customData?.kind) : null;
}

/**
 * Builds a complete embeddable element for an dummyPlane node, centered on `center`
 * (scene coordinates). Excalidraw's skeleton API does not accept embeddables, so
 * every base field is set here; `index: null` lets Excalidraw assign the order.
 */
export function createNodeElement(kind: NodeKind, center: { x: number; y: number }): ExcalidrawEmbeddableElement {
  const id = crypto.randomUUID();
  const { width, height } = NODE_SIZE[kind];
  const random = () => Math.floor(Math.random() * 2 ** 31);
  return {
    id,
    type: "embeddable",
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    angle: 0 as ExcalidrawEmbeddableElement["angle"],
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roundness: null,
    roughness: 0,
    opacity: 100,
    seed: random(),
    version: 1,
    versionNonce: random(),
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: nodeLink(kind, id),
    locked: false,
    customData: { kind: toStoredKind(kind) },
  };
}
