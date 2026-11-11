import type { ExcalidrawElement, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { SceneData } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { NODE_SIZE } from "@/canvas/nodeElement";
import { cachedElements, editStoredScene } from "@/canvas/sceneCache";
import { rerouteWires } from "@/agents/wires";
import { onTextSent } from "@/ipc/pty";
import { settledSteps } from "@/nodes/steps";
import type { TerminalPayload, TerminalReportStatus } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";

/**
 * A minimized terminal: its element shrinks to a small card, a tab (a header
 * and one line), from its top-left corner; its process and its xterm go on
 * underneath, and it expands to the size it had. The size changes stay out of
 * the undo history, like a folded group's.
 */

/** The card's height: a header (36 px) and one line of summary. */
export const MINIMIZED_HEIGHT = 68;
/** The card's width: room for the agent's icon, a name, its status and the expand button, not a strip as wide as the terminal. */
export const MINIMIZED_WIDTH = 280;

export interface Size {
  width: number;
  height: number;
}

const MINIMIZED: Size = { width: MINIMIZED_WIDTH, height: MINIMIZED_HEIGHT };

const random = () => Math.floor(Math.random() * 2 ** 31);

/** `CaptureUpdateAction.NEVER` as a literal: importing Excalidraw's runtime for it would load it wherever a terminal expands. */
const NEVER: SceneData["captureUpdate"] = "NEVER";

/** `elements` with the node `nodeId` at `size` (its top-left corner stays) and its wires routed again; the scene itself when nothing changes. */
export function resizedScene(elements: readonly ExcalidrawElement[], nodeId: string, size: Size): readonly ExcalidrawElement[] {
  const element = elements.find((e) => e.id === nodeId && !e.isDeleted);
  if (!element || (element.width === size.width && element.height === size.height)) return elements;
  const { width, height } = size;
  const resized = elements.map((e) =>
    e === element ? ({ ...e, width, height, version: e.version + 1, versionNonce: random(), updated: Date.now() } as ExcalidrawElement) : e,
  );
  return rerouteWires(resized, new Set([nodeId]));
}

/** The live canvas when the node's workspace is on screen. */
function liveApi(workspaceId: string) {
  const { api } = canvasStore.getState();
  return api && workspaceId === workspacesStore.getState().activeId ? api : null;
}

/** The node's element as it stands, on screen or in its stored scene. */
function elementOf(nodeId: string, workspaceId: string): ExcalidrawElement | undefined {
  const elements = liveApi(workspaceId)?.getSceneElementsIncludingDeleted() ?? cachedElements(workspaceId) ?? [];
  return elements.find((e) => e.id === nodeId && !e.isDeleted);
}

/** Sets the node's size where its scene is, outside the undo history. */
function resize(nodeId: string, workspaceId: string, size: Size) {
  const api = liveApi(workspaceId);
  if (api) {
    const elements = api.getSceneElementsIncludingDeleted();
    const next = resizedScene(elements, nodeId, size);
    if (next === elements) return;
    // Excalidraw knows its active node by the element object: the new one stays active.
    const active = api.getAppState().activeEmbeddable;
    const resized = next.find((e) => e.id === nodeId) as NonDeletedExcalidrawElement | undefined;
    const keepActive = active && resized && active.element.id === nodeId ? { activeEmbeddable: { element: resized, state: active.state } } : null;
    api.updateScene({ elements: next, ...(keepActive ? { appState: keepActive } : {}), captureUpdate: NEVER });
    return;
  }
  // Another workspace: its stored scene, when it was read; else the card puts it right once shown.
  const stored = cachedElements(workspaceId);
  if (!stored) return;
  const next = resizedScene(stored, nodeId, size);
  if (next !== stored) editStoredScene(workspaceId, next);
}

/** Whether the terminal belongs to a spawn tree (spawn_agent): it was spawned, or spawned others. */
function inSpawnTree(nodeId: string): boolean {
  const nodes = nodesStore.getState().nodes;
  if (terminalOf(nodes[nodeId])?.spawnedBy) return true;
  return Object.values(nodes).some((record) => record.kind === "terminal" && record.payload.spawnedBy === nodeId);
}

/**
 * A terminal of a spawn tree changed height: the tree is laid out again around
 * it (`reflowSpawnTree`), its siblings below moving up when it shrinks, down
 * when it grows. Loaded when needed, as the layout brings Excalidraw's runtime.
 */
function reflowAround(nodeId: string, workspaceId: string) {
  if (!inSpawnTree(nodeId)) return;
  void import("@/agents/spawnTree")
    .then(({ reflowSpawnTree }) => reflowSpawnTree(workspaceId, nodeId))
    .catch((error: unknown) => console.warn(`terminal ${nodeId}: spawn tree not laid out again`, error));
}

export function isMinimized(nodeId: string): boolean {
  return terminalOf(nodesStore.getState().nodes[nodeId])?.minimized === true;
}

/** The sides of `element` larger than the card, to be given back when it expands; those `payload` already keeps stay. */
function keptSize(element: ExcalidrawElement | undefined, payload: Pick<TerminalPayload, "expandedHeight" | "expandedWidth">): Partial<TerminalPayload> {
  if (!element) return {};
  return {
    ...(payload.expandedHeight === undefined && element.height > MINIMIZED_HEIGHT ? { expandedHeight: element.height } : {}),
    ...(payload.expandedWidth === undefined && element.width > MINIMIZED_WIDTH ? { expandedWidth: element.width } : {}),
  };
}

/** Shrinks a terminal to its card. False when it is not a terminal or is already minimized. */
export function minimizeTerminal(nodeId: string): boolean {
  const record = nodesStore.getState().nodes[nodeId];
  const payload = terminalOf(record);
  if (!record || !payload || payload.minimized) return false;
  nodesStore.getState().update(nodeId, { minimized: true, ...keptSize(elementOf(nodeId, record.workspaceId), {}) });
  resize(nodeId, record.workspaceId, MINIMIZED);
  reflowAround(nodeId, record.workspaceId);
  return true;
}

/** The size a minimized terminal expands to: the one it had, else a new terminal's. */
export function expandedSize(payload: Pick<TerminalPayload, "expandedHeight" | "expandedWidth">): Size {
  return { width: payload.expandedWidth ?? NODE_SIZE.terminal.width, height: payload.expandedHeight ?? NODE_SIZE.terminal.height };
}

/** Gives a minimized terminal its size back. False when it was not minimized. */
export function expandTerminal(nodeId: string): boolean {
  const record = nodesStore.getState().nodes[nodeId];
  const payload = terminalOf(record);
  if (!record || !payload?.minimized) return false;
  const size = expandedSize(payload);
  nodesStore.getState().update(nodeId, { minimized: undefined, expandedHeight: undefined, expandedWidth: undefined });
  resize(nodeId, record.workspaceId, size);
  reflowAround(nodeId, record.workspaceId);
  return true;
}

export function toggleMinimized(nodeId: string): boolean {
  return isMinimized(nodeId) ? expandTerminal(nodeId) : minimizeTerminal(nodeId);
}

/**
 * A minimized terminal shown somewhere its element is not the card's size yet
 * (minimized while its workspace's scene was never read, or before cards were
 * narrow, a strip as wide as the terminal): the card's size, the sides it had
 * kept for its expansion.
 */
export function settleMinimizedSize(nodeId: string) {
  const record = nodesStore.getState().nodes[nodeId];
  const payload = terminalOf(record);
  if (!record || !payload?.minimized) return;
  const element = elementOf(nodeId, record.workspaceId);
  if (!element || (element.width === MINIMIZED_WIDTH && element.height === MINIMIZED_HEIGHT)) return;
  const kept = keptSize(element, payload);
  if (Object.keys(kept).length > 0) nodesStore.getState().update(nodeId, kept);
  resize(nodeId, record.workspaceId, MINIMIZED);
  reflowAround(nodeId, record.workspaceId);
}

/** The statuses `report` accepts (internal names, `../../mcp/protocol.ts`), as the card shows them. */
const REPORTED = new Map<unknown, TerminalReportStatus>([
  ["termine", "done"],
  ["bloque", "blocked"],
  ["echec", "failed"],
]);

/**
 * An agent's `report` (mission member or not): its card shows it, and a
 * terminal whose work is done minimizes. Blocked or failed stays open: someone
 * has to look. A reported agent is finished: its steps are settled with its
 * report, whether or not it marked its last one. A report `report` refuses (no
 * summary, unknown status) changes nothing. Never throws: the report must
 * reach its fleet whatever happens here.
 */
export function onAgentReported(nodeId: string, status: unknown, summary: unknown) {
  try {
    const reported = REPORTED.get(status);
    const text = typeof summary === "string" ? summary.trim() : "";
    if (!reported || !text) return;
    const payload = terminalOf(nodesStore.getState().nodes[nodeId]);
    if (!payload) return;
    nodesStore.getState().update(nodeId, {
      lastReport: { status: reported, summary: text },
      ...(payload.steps ? { steps: settledSteps(payload.steps, reported) } : {}),
    });
    if (reported === "done") minimizeTerminal(nodeId);
  } catch (error) {
    console.warn(`terminal ${nodeId}: report not shown`, error);
  }
}

/**
 * New work for a terminal: a task, a message or the command bar's Send typed
 * into it, or the user typing in it. A minimized one expands, and its last
 * report is no longer where it stands.
 */
export function onNewWork(nodeId: string) {
  try {
    const payload = terminalOf(nodesStore.getState().nodes[nodeId]);
    if (!payload || (!payload.minimized && !payload.lastReport)) return;
    if (payload.lastReport) nodesStore.getState().update(nodeId, { lastReport: undefined });
    expandTerminal(nodeId);
  } catch (error) {
    console.warn(`terminal ${nodeId}: not expanded`, error);
  }
}

/** For the app's life: every text sent to an agent (a mission's task, the Fleet's messages, the command bar's Send) is new work. */
export function installMinimizing(): () => void {
  return onTextSent(onNewWork);
}
