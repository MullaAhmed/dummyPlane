import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { editStoredScene } from "@/canvas/sceneCache";
import { sameInputs, sceneStamp, type SceneStamp } from "@/canvas/sceneChanges";
import { isManagerNode, nodesStore } from "@/store/nodes";
import { fleetOfMissionNode, laidOutWithMission, missionBlockOf, missionOfFleet, settledMission } from "./missionLayout";
import { sceneAccess } from "./sceneAccess";
import { isDownTree, isPinned } from "./spawnLayout";
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
 * team) or from a root Arrange laid out as a tree (`isDownTree`), from any of
 * its nodes, closed ones included: the root stays, its
 * descendants move and their wires take their routes, out of the undo
 * history. `pin` first marks those nodes as moved by hand. A Fleet's tree, or
 * its mission Manager's, takes the mission along (./missionLayout.ts): it
 * settles beside its Fleet once the tree is laid out. For spawn_agent,
 * after it opens or closes a child, and for a mission's Manager once its team
 * is wired to it. False when nothing changed.
 */
export function reflowSpawnTree(workspaceId: string, nodeId: string, pin: readonly string[] = []): boolean {
  const scene = sceneAccess(workspaceId);
  if (!scene) return false;
  const next = spawnLayoutOf(scene.elements(), nodeId, pin);
  return next ? writeLaidOut(workspaceId, next) : false;
}

/** The scene `reflowSpawnTree` lays out for `nodeId`'s tree, `pin` first pinned, unwritten: null when nothing changes. */
export function spawnLayoutOf(before: readonly ExcalidrawElement[], nodeId: string, pin: readonly string[] = []): readonly ExcalidrawElement[] | null {
  const pinned = withPins(before, new Set(pin));
  const byId = new Map(pinned.map((e) => [e.id, e]));
  const isDownRoot = (id: string) => isManagerNode(id) || isDownTree(byId.get(id));
  return laidOutWithMission(pinned, spawnedBy, nodeId, isDownRoot) ?? (pinned === before ? null : pinned);
}

/** A layout's scene written out of the undo history, on screen or stored. False when it could not be. */
function writeLaidOut(workspaceId: string, next: readonly ExcalidrawElement[]): boolean {
  const scene = sceneAccess(workspaceId);
  if (!scene) return false;
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
 * pins nothing. A Fleet dragged takes its mission along, and a mission's board
 * its Manager and team (./missionLayout.ts); so does a Fleet with a mission
 * moved some other way, the arrow keys or an undo of its drag, its mission
 * left where it was: its own sub-agents with it.
 * `version` is the scene's (Canvas has it), summed here when not given.
 */
export function createSpawnDragWatch(workspaceId: string) {
  const dragged = new Set<string>();
  // Where each dragged node stood when the drag took it: how far it went, for what follows it.
  const startOf = new Map<string, Point>();
  // The scene and the drag of the last change: a pan's frames hand both again, and moved nothing.
  let last: (SceneStamp & { dragging: boolean }) | null = null;
  return (
    elements: readonly ExcalidrawElement[],
    appState: Pick<AppState, "selectedElementIds" | "selectedElementsAreBeingDragged">,
    version?: number,
  ) => {
    const dragging = appState.selectedElementsAreBeingDragged;
    const seen = { ...sceneStamp(elements, version), dragging };
    if (sameInputs(last, seen)) return;
    last = seen;
    // What moved without a drag since the last change, and how far.
    const shifted = new Map<string, Point>();
    for (const e of elements) {
      if (e.isDeleted || e.type !== "embeddable") continue;
      const before = lastSeen.get(e.id);
      const moved = before !== undefined && (before.x !== e.x || before.y !== e.y);
      if (dragging && moved && appState.selectedElementIds[e.id]) {
        if (!dragged.has(e.id)) startOf.set(e.id, before);
        dragged.add(e.id);
      } else if (!dragging && moved && !dragged.has(e.id)) shifted.set(e.id, { x: e.x - before.x, y: e.y - before.y });
      lastSeen.set(e.id, { x: e.x, y: e.y });
    }
    const nudges = dragging ? [] : missionNudges(elements, shifted);
    // Its own sub-agents follow it too, as a drag's reflow takes them: the mission settles under them again.
    if (nudges.length > 0) {
      requestAnimationFrame(() =>
        nudges.forEach(({ fleetId, delta }) => {
          followMission(workspaceId, fleetId, delta, new Set([fleetId]));
          reflowSpawnTree(workspaceId, fleetId);
        }),
      );
    }
    if (dragging || dragged.size === 0) return;
    const ids = [...dragged].filter((id) => spawnedBy(id) !== null || hasSpawned(id));
    const moved = new Set(dragged);
    const follows = missionFollows(elements, moved, startOf);
    dragged.clear();
    startOf.clear();
    if (ids.length === 0 && follows.length === 0) return;
    // A node dragged along with one of its ancestors, or with the Fleet or board its mission hangs from, was not placed by hand.
    const carried = new Set(follows.flatMap((f) => [...f.carried]));
    const pin = ids.filter((id) => spawnedBy(id) !== null && !hasAncestorIn(id, moved) && !carried.has(id));
    requestAnimationFrame(() => {
      for (const { fleetId, delta } of follows) followMission(workspaceId, fleetId, delta, moved);
      ids.forEach((id) => reflowSpawnTree(workspaceId, id, pin));
    });
  };
}

/** A mission a drag takes along: its Fleet's id, how far the Fleet (or the board) went, and the block it carries. */
interface MissionFollow {
  fleetId: string;
  delta: Point;
  carried: ReadonlySet<string>;
}

/**
 * The missions a drag takes along: a dragged Fleet's, a dragged board's (its
 * Manager and team with it). The Fleet's drag wins when both went.
 */
function missionFollows(elements: readonly ExcalidrawElement[], moved: ReadonlySet<string>, startOf: ReadonlyMap<string, Point>): MissionFollow[] {
  const byFleet = new Map<string, MissionFollow>();
  for (const id of moved) {
    const fleetId = missionOfFleet(id) ? id : fleetOfMissionNode(id);
    // A Manager dragged takes its team along as any spawner does; its board stays: the Manager hangs from it, not it from the Manager.
    if (!fleetId || (fleetId !== id && missionOfFleet(fleetId)?.board !== id)) continue;
    if (byFleet.has(fleetId) && fleetId !== id) continue;
    const start = startOf.get(id);
    const now = elements.find((e) => e.id === id && !e.isDeleted);
    const block = missionBlockOf(elements, fleetId, spawnedBy);
    if (!start || !now || !block) continue;
    byFleet.set(fleetId, { fleetId, delta: { x: now.x - start.x, y: now.y - start.y }, carried: block.ids });
  }
  return [...byFleet.values()];
}

/**
 * The Fleets moved without a drag (the arrow keys, an undo of a drag), whose mission stayed where it was: it
 * follows them. Not one that moved along (an Arrange, its undo): it went with its Fleet already.
 */
function missionNudges(elements: readonly ExcalidrawElement[], shifted: ReadonlyMap<string, Point>): { fleetId: string; delta: Point }[] {
  return [...shifted].flatMap(([fleetId, delta]) => {
    if (!missionOfFleet(fleetId)) return [];
    const block = missionBlockOf(elements, fleetId, spawnedBy);
    return block && ![...block.ids].some((id) => shifted.has(id)) ? [{ fleetId, delta }] : [];
  });
}

/** A dragged Fleet's mission, or a dragged board's Manager and team, follow it (./missionLayout.ts), out of the undo history like a tree's reflow. */
function followMission(workspaceId: string, fleetId: string, delta: Point, moved: ReadonlySet<string>) {
  const scene = sceneAccess(workspaceId);
  const next = scene ? settledMission(scene.elements(), fleetId, { parentOf: spawnedBy, delta, moved }) : null;
  if (next) writeLaidOut(workspaceId, next);
}
