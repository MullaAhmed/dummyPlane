import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { revealNode } from "@/canvas/arrive";
import { canvasStore } from "@/canvas/canvasStore";
import { groupInfoOf, groupOf, insertIntoFrame, withGroupFolded } from "@/canvas/groups";
import { allowRemoval } from "@/canvas/removalGuard";
import { createNodeElement, nodeKindOf, nodeLink } from "@/canvas/nodeElement";
import { expandedSize } from "@/nodes/terminal/minimize";
import { disposeTerminal, markForAutostart, startUnseen } from "@/nodes/terminal/registry";
import { emptyNotesOf, remapCopiedNotes } from "@/nodes/note/link";
import { isEmptyNote } from "@/nodes/note/notes";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { announceArrival, IN_VIEW, type Arrival } from "./arrivals";
import { cloneTerminalPayload } from "./clone";
import { arrangeInFrame, freeCell, freeSpot, NODE_GAP } from "./groupLayout";
import { nameForNewAgent, pantheonsForCopiedGroups } from "./naming";
import { sceneAccess } from "./sceneAccess";
import { withSpawnedChildren } from "./spawnFamily";
import { reflowSpawnTreesOf } from "./spawnTree";

export interface Point {
  x: number;
  y: number;
}

/** How long Excalidraw is given to mount what is in sight: it starts those itself, sized by their host. */
export const MOUNT_WAIT_MS = 100;

/**
 * Starts a terminal that arrived on its own. Out of sight, or in another workspace, nothing will mount it. In sight, it is
 * mounted within a render, and that first mount starts it at its size: only one still waiting after `MOUNT_WAIT_MS` starts here
 * (a timer, since frames stop while the window is minimized).
 */
export function startArrival(nodeId: string, payload: TerminalPayload, shown: boolean) {
  if (shown) setTimeout(() => startUnseen(nodeId, payload), MOUNT_WAIT_MS);
  else startUnseen(nodeId, payload);
}

/**
 * Adds a terminal centered on `center` (scene coordinates), or in the first
 * free cell of the group `groupId`, and starts it. It comes
 * into view unless `arrival` says it arrives on its own: then the view stays,
 * the keyboard too, and a notice tells of it.
 */
export async function addTerminal(
  workspaceId: string,
  payload: TerminalPayload,
  center: Point,
  groupId: string | null = null,
  arrival: Arrival = IN_VIEW,
): Promise<string | null> {
  if (!sceneAccess(workspaceId)) return null;
  const element = createNodeElement("terminal", center);
  // The node row must exist before the process can save its scrollback.
  await nodesStore.getState().create(element.id, { workspaceId, kind: "terminal", payload });
  markForAutostart(element.id);
  // Read after the wait: the scene may have changed meanwhile, and the user may have left it.
  const scene = sceneAccess(workspaceId);
  if (!scene) return null;
  const elements = scene.elements();
  const frame = groupId ? elements.find((e) => e.id === groupId && !e.isDeleted && groupInfoOf(e)) : undefined;
  scene.write(frame ? joinGroup(elements, element, frame) : [...elements, placeFree(elements, element)]);
  // Out of sight, Excalidraw would neither show it nor start its agent; in another workspace nothing mounts it at all.
  if (scene.shown && arrival.reveal) {
    revealNode(element.id);
    return element.id;
  }
  startArrival(element.id, payload, scene.shown);
  if (!arrival.reveal) announceArrival(workspaceId, arrival.source, [{ nodeId: element.id, name: payload.name }]);
  return element.id;
}

/**
 * `element` moved to the nearest spot that covers no node nor group frame of
 * `elements` (NODE_GAP apart), so two terminals never end up one on top of the other.
 */
function placeFree(elements: readonly ExcalidrawElement[], element: ExcalidrawElement): ExcalidrawElement {
  const obstacles = elements
    .filter((e) => !e.isDeleted && (nodeKindOf(e) !== null || e.type === "frame"))
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
  const spot = freeSpot(element, obstacles);
  return spot.x === element.x && spot.y === element.y ? element : newElementWith(element, { x: spot.x, y: spot.y });
}

/** `elements` with `element` in the first free cell of `frame`, grown if it was full. */
function joinGroup(elements: readonly ExcalidrawElement[], element: ExcalidrawElement, frame: ExcalidrawElement) {
  const members = elements.filter((e) => !e.isDeleted && e.frameId === frame.id);
  const placed = freeCell(frame, members);
  return insertIntoFrame(
    elements,
    newElementWith(element, { x: placed.cell.x, y: placed.cell.y, frameId: frame.id }),
    newElementWith(frame, { width: placed.frame.width, height: placed.frame.height, customData: withGroupFolded(frame.customData, false) }),
  );
}

/** "Duplicate" of the header: a copy of the agent to the right of the node, or in its group's grid. */
export async function duplicateTerminal(workspaceId: string, nodeId: string) {
  const element = canvasStore.getState().api?.getSceneElements().find((e) => e.id === nodeId);
  const source = terminalOf(nodesStore.getState().nodes[nodeId]);
  if (!element || !source) return;
  const group = groupOf(canvasStore.getState().frames, nodeId);
  // Right of the source, NODE_GAP apart; addTerminal then moves it clear of any neighbour.
  const center = { x: element.x + element.width * 1.5 + NODE_GAP, y: element.y + element.height / 2 };
  const name = await nameForNewAgent(workspaceId, group?.group.pantheon);
  await addTerminal(workspaceId, cloneTerminalPayload(source, name), center, group?.id ?? null);
}

/**
 * Gives terminal elements copied by Excalidraw (Ctrl+D, copy-paste) a node of
 * their own, then points their link at it. They start like any new agent.
 */
export async function adoptCopies(workspaceId: string, copies: readonly { id: string; sourceId: string }[]) {
  const api = canvasStore.getState().api;
  if (!api) return;
  const refused = new Set<string>();
  // A group copied whole takes a pantheon of its own: its agents are named from it.
  const workspacePantheon = workspacesStore.getState().workspaces.find((w) => w.id === workspaceId)?.pantheon;
  const pantheons = pantheonsForCopiedGroups(api.getSceneElementsIncludingDeleted(), new Set(copies.map((copy) => copy.id)), workspacePantheon);
  for (const { id, sourceId } of copies) {
    const source = nodesStore.getState().nodes[sourceId];
    if (!source) continue;
    if (source.kind === "fleet") {
      // A fleet runs on the Fleet's CLI: without it, the copy is taken back.
      // Imported late: the fleet module reaches this one through the canvas.
      const { refusedWithoutItsCli } = await import("@/fleet/fleets");
      if (await refusedWithoutItsCli()) {
        refused.add(id);
        continue;
      }
      // A copied fleet keeps its name; its session, created when shown, and its wires are its own.
      await nodesStore.getState().create(id, { workspaceId, kind: "fleet", payload: { name: source.payload.name } });
      continue;
    }
    if (source.kind === "file") {
      await nodesStore.getState().create(id, { workspaceId, kind: "file", payload: { ...source.payload } });
      continue;
    }
    if (source.kind === "output") {
      // A copied output shows the same content; its agent can only update the one it made.
      await nodesStore.getState().create(id, { workspaceId, kind: "output", payload: { ...source.payload } });
      continue;
    }
    if (source.kind === "note") {
      // A copied note keeps its text, then lives on its own.
      await nodesStore.getState().create(id, { workspaceId, kind: "note", payload: { ...source.payload } });
      continue;
    }
    if (source.kind === "kanban") {
      // A copied board starts with the same columns and cards, then lives on its own.
      await nodesStore.getState().create(id, { workspaceId, kind: "kanban", payload: structuredClone(source.payload) });
      continue;
    }
    markForAutostart(id);
    const frameId = api.getSceneElementsIncludingDeleted().find((e) => e.id === id)?.frameId;
    const group = canvasStore.getState().frames.find((f) => f.id === frameId);
    const name = await nameForNewAgent(workspaceId, (frameId ? pantheons.get(frameId) : undefined) ?? group?.group?.pantheon);
    await nodesStore.getState().create(id, { workspaceId, kind: "terminal", payload: cloneTerminalPayload(source.payload, name) });
  }
  if (refused.size) removeNodes([...refused]);
  const ids = new Set(copies.map((copy) => copy.id).filter((id) => !refused.has(id)));
  // A minimized terminal's copy starts open: its element takes the size the card stood for.
  const fullSizes = new Map(
    copies.flatMap(({ id, sourceId }) => {
      const source = terminalOf(nodesStore.getState().nodes[sourceId]);
      return ids.has(id) && source?.minimized ? [[id, expandedSize(source)] as const] : [];
    }),
  );
  const scene = api.getSceneElementsIncludingDeleted();
  const homes = new Set(scene.filter((e) => ids.has(e.id)).map((e) => e.frameId));
  const linked = scene
    .map((e) => (homes.has(e.id) && groupInfoOf(e)?.folded ? newElementWith(e, { customData: withGroupFolded(e.customData, false) }) : e))
    .map((e) => {
      const pantheon = pantheons.get(e.id);
      if (pantheon) return newElementWith(e, { customData: { ...e.customData, dummyplane: { ...(e.customData?.dummyplane as object), pantheon } } });
      const size = fullSizes.get(e.id);
      return ids.has(e.id) ? newElementWith(e, { link: nodeLink(nodeKindOf(e) ?? "terminal", e.id), ...(size ?? {}) }) : e;
    });
  // A note copied with its terminal stands beside the terminal's copy.
  const copyOf = new Map(copies.filter(({ id }) => ids.has(id)).map(({ id, sourceId }) => [sourceId, id]));
  const notes = new Set(copies.filter(({ id, sourceId }) => ids.has(id) && nodesStore.getState().nodes[sourceId]?.kind === "note").map(({ id }) => id));
  api.updateScene({ elements: [...remapCopiedNotes(alignCopies(linked, ids), copyOf, notes)], captureUpdate: CaptureUpdateAction.NEVER });
}

/** Copies made inside a group (Ctrl+D, copy-paste) take its first free cells too. */
function alignCopies(elements: readonly ExcalidrawElement[], copyIds: ReadonlySet<string>): ExcalidrawElement[] {
  const byFrame = new Map<string, string[]>();
  for (const e of elements) {
    if (copyIds.has(e.id) && e.frameId && nodeKindOf(e) === "terminal") byFrame.set(e.frameId, [...(byFrame.get(e.frameId) ?? []), e.id]);
  }
  let result = [...elements];
  for (const [frameId, ids] of byFrame) {
    const frame = result.find((e) => e.id === frameId && !e.isDeleted);
    if (!frame || !groupInfoOf(frame)) continue;
    const members = result.filter((e) => !e.isDeleted && e.frameId === frameId && !copyIds.has(e.id));
    const placed = arrangeInFrame(frame, members, ids.length);
    const cells = new Map(ids.map((id, i) => [id, placed.cells[i]]));
    result = result.map((e) => {
      const cell = cells.get(e.id);
      if (cell) return newElementWith(e, { x: cell.x, y: cell.y });
      if (e.id === frameId) return newElementWith(e, { width: placed.frame.width, height: placed.frame.height });
      return e;
    });
  }
  return result;
}

/**
 * Deletes elements in one step, their closing confirmed or needing none: the
 * removal guard lets them go. Undo brings them back, stopped.
 */
export function removeNodes(ids: readonly string[]) {
  const api = canvasStore.getState().api;
  if (!api) return;
  const elements = api.getSceneElementsIncludingDeleted();
  // Only those really leaving: the guard forgets a pass when a node goes, so one already gone would keep its pass for later.
  const removed = new Set(elements.filter((e) => ids.includes(e.id) && !e.isDeleted).map((e) => e.id));
  allowRemoval(removed);
  api.updateScene({
    elements: elements.map((e) => (removed.has(e.id) ? newElementWith(e, { isDeleted: true }) : e)),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** Removes `ids` from a scene not on screen: no canvas will free their terminals. */
export function removeFromStoredScene(workspaceId: string, ids: ReadonlySet<string>) {
  const scene = sceneAccess(workspaceId);
  if (!scene || scene.shown) return;
  const elements = scene.elements();
  const terminals = elements.filter((e) => ids.has(e.id) && nodeKindOf(e) === "terminal").map((e) => e.id);
  // Their empty notes go with them; a note with text stays, alone (src/nodes/note).
  const gone = new Set([...ids, ...emptyNotesOf(elements, ids, isEmptyNote)]);
  scene.write(elements.map((e) => (gone.has(e.id) && !e.isDeleted ? newElementWith(e, { isDeleted: true }) : e)));
  for (const id of terminals) disposeTerminal(id);
  reflowSpawnTreesOf(workspaceId, terminals);
}

export function removeNode(nodeId: string) {
  removeNodes([nodeId]);
}

/**
 * "Close" of the header: a running agent asks for confirmation first, and so does one whose sub-agents (spawn_agent) are still on the
 * canvas: they may close with it.
 */
export function requestClose(nodeId: string) {
  const closing = withSpawnedChildren({ agents: [nodeId], remove: [nodeId] });
  if (isRunning(nodeId) || closing.children) uiStore.getState().setClosing(closing);
  else removeNode(nodeId);
}
