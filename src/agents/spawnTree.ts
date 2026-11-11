import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { editStoredScene } from "@/canvas/sceneCache";
import { isManagerNode, nodesStore } from "@/store/nodes";
import { sceneAccess } from "./sceneAccess";
import { isPinned, layoutSpawnTree } from "./spawnLayout";
import type { Point } from "./terminals";

/** The terminal whose agent spawned `nodeId` (spawn_agent), closed ones included: their records stay. */
export function spawnedBy(nodeId: string): string | null {
  const record = nodesStore.getState().nodes[nodeId];
  return record?.kind === "terminal" ? (record.payload.spawnedBy ?? null) : null;
}

/** Whether some terminal says `nodeId` spawned it. */
function hasSpawned(nodeId: string): boolean {
  return Object.values(nodesStore.getState().nodes).some((record) => record.kind === "terminal" && record.payload.spawnedBy === nodeId);
}

/** Whether a node up `nodeId`'s spawnedBy chain is in `ids`. */
function hasAncestorIn(nodeId: string, ids: ReadonlySet<string>): boolean {
  const seen = new Set([nodeId]);
  for (let up = spawnedBy(nodeId); up && !seen.has(up); up = spawnedBy(up)) {
    if (ids.has(up)) return true;
    seen.add(up);
  }
  return false;
}

/** Where the nodes of the scene on screen stood at its last change: a node moved since was moved by that change. */
const lastSeen = new Map<string, Point>();

function withPins(elements: readonly ExcalidrawElement[], ids: ReadonlySet<string>): readonly ExcalidrawElement[] {
  if (![...ids].some((id) => elements.some((e) => e.id === id && !isPinned(e)))) return elements;
  return elements.map((e) =>
    ids.has(e.id) && !isPinned(e)
      ? { ...e, customData: { ...e.customData, pinned: true }, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() }
      : e,
  );
}

/**
 * Lays out the spawn tree `nodeId` belongs to (`layoutSpawnTree`): a
 * flowchart, or downward from a Manager (the vertical tree of a mission's
 * team), from any of its nodes, closed ones included: the root stays, its
 * descendants move and their wires take their routes, out of the undo
 * history. `pin` first marks those nodes as moved by hand. For spawn_agent,
 * after it opens or closes a child, and for a mission's Manager once its team
 * is wired to it. False when nothing changed.
 */
export function reflowSpawnTree(workspaceId: string, nodeId: string, pin: readonly string[] = []): boolean {
  const scene = sceneAccess(workspaceId);
  if (!scene) return false;
  const before = scene.elements();
  const pinned = withPins(before, new Set(pin));
  const next = layoutSpawnTree(pinned, spawnedBy, nodeId, isManagerNode) ?? (pinned === before ? null : pinned);
  if (!next) return false;
  if (!scene.shown) {
    editStoredScene(workspaceId, next);
    return true;
  }
  const api = canvasStore.getState().api;
  if (!api) return false;
  // Moved by the layout, not by the user: the drag watch must not take them for a drag.
  for (const e of next) if (lastSeen.has(e.id)) lastSeen.set(e.id, { x: e.x, y: e.y });
  api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER });
  return true;
}

/**
 * After spawned nodes closed, or came back with an undo: their trees close up
 * (children move up to the nearest live ancestor) or open again. A frame later
 * on screen: changing the scene from inside `onChange` would re-enter it.
 */
export function reflowSpawnTreesOf(workspaceId: string, nodeIds: readonly string[]) {
  const spawned = nodeIds.filter((id) => spawnedBy(id) !== null);
  if (spawned.length === 0) return;
  const reflow = () => spawned.forEach((id) => reflowSpawnTree(workspaceId, id));
  if (sceneAccess(workspaceId)?.shown) requestAnimationFrame(reflow);
  else reflow();
}

/**
 * Watches the scene on screen for drags. A spawned node the user drags gets
 * pinned: later layouts leave it there and lay out its own children from it.
 * A spawner dragged takes its tree along. Both when the drag ends, a frame
 * later. Dragging a group's frame selects the frame, not its terminals: it
 * pins nothing.
 */
export function createSpawnDragWatch(workspaceId: string) {
  const dragged = new Set<string>();
  return (elements: readonly ExcalidrawElement[], appState: Pick<AppState, "selectedElementIds" | "selectedElementsAreBeingDragged">) => {
    const dragging = appState.selectedElementsAreBeingDragged;
    for (const e of elements) {
      if (e.isDeleted || e.type !== "embeddable") continue;
      const before = lastSeen.get(e.id);
      if (dragging && before && (before.x !== e.x || before.y !== e.y) && appState.selectedElementIds[e.id]) dragged.add(e.id);
      lastSeen.set(e.id, { x: e.x, y: e.y });
    }
    if (dragging || dragged.size === 0) return;
    const ids = [...dragged].filter((id) => spawnedBy(id) !== null || hasSpawned(id));
    const moved = new Set(dragged);
    dragged.clear();
    if (ids.length === 0) return;
    // A node dragged along with one of its ancestors was not placed by hand: the whole tree moved.
    const pin = ids.filter((id) => spawnedBy(id) !== null && !hasAncestorIn(id, moved));
    requestAnimationFrame(() => ids.forEach((id) => reflowSpawnTree(workspaceId, id, pin)));
  };
}
