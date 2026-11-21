import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { groupInfoOf, type Rect } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { settleNotes } from "@/nodes/note/link";
import { isManagerRecord, nodesStore } from "@/store/nodes";
import { anchorsOf, type Attachment } from "./attachments";
import { COLUMN_GAP, GROUP_GAP, overlap, ROW_GAP } from "./groupLayout";
import { layoutSpawnTree, spawnTreeOf, type IsDownRoot, type ParentOf } from "./spawnLayout";
import type { Point } from "./terminals";
import { rerouteWires } from "./wires";

/**
 * A Fleet's mission on the canvas (src/mission/manager.ts): its board, its
 * Manager under the board, the Manager's team as its spawn tree. Arrange moves
 * them with their Fleet as one block (./attachments.ts); between two Arranges
 * this file keeps them so:
 *
 * - a mission docked beside its Fleet (its board in the column the go-ahead put
 *   it in, right of the Fleet, GROUP_GAP from it) stands as high as it fits
 *   there, under the Fleet's own sub-agents: their flowchart grows from the
 *   Fleet into that column too, so the two make room for each other in one
 *   way only, the mission's. Before, each took the other for an obstacle: the
 *   go-ahead wedged the board under the Fleet's sub-agents and pushed the team
 *   away from its Manager, and the next spawn, close or minimize of a Fleet's
 *   sub-agent threw all of them past the mission, far from their Fleet;
 * - a mission the user moved away from that column stays where they put it,
 *   moved down only past what it would cover;
 * - a dragged Fleet takes its mission along, and a dragged board its Manager
 *   and team, as Arrange would move them.
 */

/** What a Fleet's payload says of its mission's nodes. */
export interface FleetMission {
  board?: string;
  manager?: string;
}

/** A Fleet's mission, null for a node that is not a Fleet or has none. */
export type MissionOf = (fleetId: string) => FleetMission | null;

/** The store's reading. */
export const missionOfFleet: MissionOf = (fleetId) => {
  const record = nodesStore.getState().nodes[fleetId];
  return record?.kind === "fleet" ? (record.payload.mission ?? null) : null;
};

/** The Fleet whose mission `nodeId` belongs to as its board or its Manager; null for any other node. */
export function fleetOfMissionNode(nodeId: string): string | null {
  const nodes = nodesStore.getState().nodes;
  const record = nodes[nodeId];
  if (isManagerRecord(record) && record?.kind === "terminal") return record.payload.fleet ?? null;
  if (record?.kind !== "kanban") return null;
  return Object.entries(nodes).find(([, r]) => r.kind === "fleet" && r.payload.mission?.board === nodeId)?.[0] ?? null;
}

/** A mission's block: the node it hangs from its Fleet by (its board, or its Manager once the board is gone), and every element of it. */
export interface MissionBlock {
  head: ExcalidrawElement;
  /** Whether the head is the board: only a board docks. */
  board: boolean;
  /**
   * The board, the Manager, the Manager's spawn tree, the group the Manager and its team stand in with what
   * it holds, and what is attached to any of them (a quick note, an output).
   */
  ids: Set<string>;
}

/**
 * The block of `fleetId`'s mission as `elements` hold it; null when neither its
 * board nor its Manager is on the canvas.
 */
export function missionBlockOf(
  elements: readonly ExcalidrawElement[],
  fleetId: string,
  parentOf: ParentOf,
  missionOf: MissionOf = missionOfFleet,
  attachedTo: (element: ExcalidrawElement) => Attachment | null = anchorsOf(elements),
): MissionBlock | null {
  const mission = missionOf(fleetId);
  if (!mission) return null;
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const board = mission.board ? byId.get(mission.board) : undefined;
  const manager = mission.manager ? byId.get(mission.manager) : undefined;
  const head = board ?? manager;
  if (!head) return null;
  const ids = new Set<string>([head.id]);
  if (manager) for (const id of spawnTreeOf(elements, parentOf, manager.id)?.ids ?? [manager.id]) ids.add(id);
  // The team's group (src/mission/manager.ts) with whatever stands in it.
  const frame = manager?.frameId ? byId.get(manager.frameId) : undefined;
  if (frame && groupInfoOf(frame)) {
    ids.add(frame.id);
    for (const e of live) if (e.frameId === frame.id) ids.add(e.id);
  }
  // What hangs from them goes with them, and what hangs from that: never the Fleet nor what is its own.
  for (let grown = true; grown; ) {
    grown = false;
    for (const e of live) {
      if (ids.has(e.id) || e.id === fleetId) continue;
      const anchor = attachedTo(e)?.anchor;
      if (anchor && ids.has(anchor)) {
        ids.add(e.id);
        grown = true;
      }
    }
  }
  return { head, board: head === board, ids };
}

/** Whether a mission stands docked beside its Fleet: its board in the column the go-ahead puts it in (`boardSpot`). */
export function isDocked(block: MissionBlock, fleet: Rect): boolean {
  return block.board && Math.abs(block.head.x - (fleet.x + fleet.width + GROUP_GAP)) <= 0.5;
}

/**
 * How far down `rects`, moved as one by `from`, go before none of them covers
 * an obstacle: `from` when they cover nothing there, else past what they would
 * cover, a column's and a row's air kept around it and GROUP_GAP under it, as
 * `boardSpot` places a new board. Only ever down: some depth is always free.
 */
export function clearDrop(rects: readonly Rect[], obstacles: readonly Rect[], from: number): number {
  const grown = obstacles.map((o) => ({ x: o.x - COLUMN_GAP, y: o.y - ROW_GAP, width: o.width + 2 * COLUMN_GAP, height: o.height + 2 * ROW_GAP }));
  let dy = from;
  for (;;) {
    let need = dy;
    for (const r of rects) {
      for (const o of grown) if (overlap({ ...r, y: r.y + dy }, o) > 0) need = Math.max(need, o.y + o.height + GROUP_GAP - r.y);
    }
    if (need === dy) return dy;
    dy = need;
  }
}

const random = () => Math.floor(Math.random() * 2 ** 31);

/** `element` moved, its version bumped as Excalidraw's newElementWith does (tests cannot load Excalidraw). */
function movedBy<T extends ExcalidrawElement>(element: T, dx: number, dy: number): T {
  return { ...element, x: element.x + dx, y: element.y + dy, version: element.version + 1, versionNonce: random(), updated: Date.now() };
}

export interface SettleOptions {
  parentOf: ParentOf;
  missionOf?: MissionOf;
  /** How far the Fleet or the board was dragged: the members of the block the drag left behind follow it first. */
  delta?: Point;
  /** What the drag itself moved: those members already went that far. */
  moved?: ReadonlySet<string>;
}

/**
 * The scene with `fleetId`'s mission where it goes (see the top of this file):
 * moved as one, its shape kept, by the drag's `delta` for the members it left
 * behind, then docked as high as it fits beside its Fleet (from the Fleet's top
 * down past what it would cover), or, away from the Fleet, down only past what
 * it would cover. The Fleet, its own sub-agents and every other node and frame
 * are obstacles; the wires of what moved take their routes again, quick notes
 * their places. Null when nothing moves; a second call changes nothing.
 */
export function settledMission(elements: readonly ExcalidrawElement[], fleetId: string, options: SettleOptions): ExcalidrawElement[] | null {
  const fleet = elements.find((e) => e.id === fleetId && !e.isDeleted);
  const block = fleet ? missionBlockOf(elements, fleetId, options.parentOf, options.missionOf) : null;
  if (!fleet || !block) return null;
  const moved = options.moved ?? new Set<string>();
  const delta = options.delta ?? { x: 0, y: 0 };
  const members = elements.filter((e) => !e.isDeleted && block.ids.has(e.id));
  const dragged = (e: ExcalidrawElement) => (moved.has(e.id) ? { x: 0, y: 0 } : delta);
  const head = { ...block.head, x: block.head.x + dragged(block.head).x, y: block.head.y + dragged(block.head).y };
  const docked = isDocked({ ...block, head }, fleet);
  const rects = members
    .filter((e) => nodeKindOf(e) !== null || e.type === "frame")
    .map((e) => ({ x: e.x + dragged(e).x, y: e.y + dragged(e).y, width: e.width, height: e.height }));
  const obstacles = elements
    .filter((e) => !e.isDeleted && !block.ids.has(e.id) && (nodeKindOf(e) !== null || e.type === "frame"))
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
  const dy = clearDrop(rects, obstacles, docked ? fleet.y - head.y : 0);
  const shifts = new Map(members.map((e) => [e.id, { x: dragged(e).x, y: dragged(e).y + dy }]));
  const movedIds = new Set([...shifts].filter(([, s]) => Math.abs(s.x) > 0.5 || Math.abs(s.y) > 0.5).map(([id]) => id));
  if (movedIds.size === 0) return null;
  const next = elements.map((e) => {
    const shift = movedIds.has(e.id) ? shifts.get(e.id)! : null;
    return shift ? movedBy(e, shift.x, shift.y) : e;
  });
  return [...settleNotes(rerouteWires(next, movedIds))];
}

/** The Fleet a spawn tree rooted at `rootId` belongs to: the root itself when it is a Fleet, the Fleet of a mission's Manager; else null. */
function fleetOfRoot(elements: readonly ExcalidrawElement[], rootId: string, missionOf: MissionOf): string | null {
  const live = elements.filter((e) => !e.isDeleted && nodeKindOf(e) === "fleet");
  if (live.some((e) => e.id === rootId)) return rootId;
  return live.find((e) => missionOf(e.id)?.manager === rootId)?.id ?? null;
}

/**
 * `layoutSpawnTree` for the tree `nodeId` belongs to, and the mission of the
 * Fleet it is part of where it goes after it. With the mission docked, the
 * Fleet's own tree does not go around the mission, nor the Manager's tree
 * around the Fleet's: each is laid out from its root as if alone, then the
 * mission settles under the Fleet's sub-agents (`settledMission`). Any other
 * tree, as `layoutSpawnTree` lays it out. Null when nothing changes.
 */
export function laidOutWithMission(
  elements: readonly ExcalidrawElement[],
  parentOf: ParentOf,
  nodeId: string,
  isDownRoot?: IsDownRoot,
  missionOf: MissionOf = missionOfFleet,
): ExcalidrawElement[] | null {
  const rootId = spawnTreeOf(elements, parentOf, nodeId)?.rootId;
  const fleetId = rootId ? fleetOfRoot(elements, rootId, missionOf) : null;
  const fleet = fleetId ? elements.find((e) => e.id === fleetId && !e.isDeleted) : undefined;
  const block = fleetId && fleet ? missionBlockOf(elements, fleetId, parentOf, missionOf) : null;
  if (!fleetId || !fleet || !block) return layoutSpawnTree(elements, parentOf, nodeId, isDownRoot);
  let yielding: ReadonlySet<string> | undefined;
  if (isDocked(block, fleet)) yielding = rootId === fleetId ? block.ids : (spawnTreeOf(elements, parentOf, fleetId)?.ids ?? new Set([fleetId]));
  const laid = layoutSpawnTree(elements, parentOf, nodeId, isDownRoot, yielding);
  return settledMission(laid ?? elements, fleetId, { parentOf, missionOf }) ?? laid;
}
