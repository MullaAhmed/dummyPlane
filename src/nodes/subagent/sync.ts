import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { sceneAccess } from "@/agents/sceneAccess";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { onSubagent, onSubagentOutput, onSubagentSessionEnded, subagentSnapshot } from "./ipc";
import { placeSubagent } from "./placement";
import { subagentNodesStore } from "./store";

/**
 * Writes a scene the backend's events changed. On screen it stays out of the
 * undo history: Ctrl+Z must not take away (or bring back) a subagent's node.
 */
function write(workspaceId: string, elements: readonly ExcalidrawElement[]) {
  const scene = sceneAccess(workspaceId);
  if (!scene) return;
  const { api } = canvasStore.getState();
  if (scene.shown && api) api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
  else scene.write(elements);
}

const isLive = (elements: readonly ExcalidrawElement[], id: string | undefined) =>
  id !== undefined && elements.some((e) => e.id === id && !e.isDeleted);

/**
 * Gives a subagent its node, once: beside its parent subagent's node for a
 * nested one, else beside the terminal that runs it. Does nothing while that
 * terminal's scene was never read, or after the user closed the node.
 * Returns the node's element id.
 */
export function ensureSubagentNode(agentId: string): string | undefined {
  const { agents, dismissed } = subagentNodesStore.getState();
  const entry = agents[agentId];
  if (!entry || dismissed[agentId]) return undefined;
  const workspaceId = nodesStore.getState().nodes[entry.nodeId]?.workspaceId;
  const scene = workspaceId ? sceneAccess(workspaceId) : null;
  if (!workspaceId || !scene) return undefined;
  if (entry.elementId) {
    if (isLive(scene.elements(), entry.elementId)) return entry.elementId;
    // Deleted by the user (Delete; the eraser leaves nodes alone): closed like its ✕.
    subagentNodesStore.getState().dismiss(agentId);
    return undefined;
  }
  const parent = entry.parentAgentId && entry.parentAgentId !== agentId ? agents[entry.parentAgentId] : undefined;
  const parentElement = parent ? ensureSubagentNode(parent.agentId) : undefined;
  const elements = scene.elements();
  const anchorId = parentElement && isLive(elements, parentElement) ? parentElement : entry.nodeId;
  const element = createNodeElement("subagent", { x: 0, y: 0 });
  const tagged = { ...element, customData: { ...element.customData, agentId, parentNodeId: entry.nodeId } };
  const placed = placeSubagent(elements, tagged, anchorId);
  if (!placed) return undefined;
  write(workspaceId, placed);
  subagentNodesStore.getState().setElement(agentId, element.id);
  return element.id;
}

/** The session ended (or its process): its subagents' nodes leave the canvas. */
export function removeSubagentNodes(nodeId: string) {
  const gone = subagentNodesStore.getState().forgetNode(nodeId);
  const ids = new Set(gone.flatMap((entry) => (entry.elementId ? [entry.elementId] : [])));
  if (ids.size === 0) return;
  const workspaceId = nodesStore.getState().nodes[nodeId]?.workspaceId;
  const workspaces = workspaceId ? [workspaceId] : workspacesStore.getState().workspaces.map((w) => w.id);
  for (const id of workspaces) {
    const elements = sceneAccess(id)?.elements();
    if (!elements?.some((e) => ids.has(e.id) && !e.isDeleted)) continue;
    write(
      id,
      elements.map((e) => (ids.has(e.id) && !e.isDeleted ? newElementWith(e, { isDeleted: true }) : e)),
    );
  }
}

/** The subagents still without a node, nor closed by the user. */
function unplaced(): string[] {
  const { agents, dismissed } = subagentNodesStore.getState();
  return Object.values(agents)
    .filter((entry) => !entry.elementId && !dismissed[entry.agentId])
    .map((entry) => entry.agentId);
}

function ensureUnplaced() {
  for (const agentId of unplaced()) ensureSubagentNode(agentId);
}

let installed: Promise<void> | undefined;

/**
 * Listens to the subagents of every Claude session, then takes the running
 * ones of a page that reloads. A scene shown later gets the nodes it missed.
 */
export function installSubagentNodes(): Promise<void> {
  installed ??= (async () => {
    const store = subagentNodesStore.getState;
    await onSubagent((info) => {
      store().upsert(info);
      ensureSubagentNode(info.agentId);
    });
    await onSubagentOutput(({ agentId, lines }) => {
      store().append(agentId, lines);
      ensureSubagentNode(agentId);
    });
    await onSubagentSessionEnded(removeSubagentNodes);
    const running = await subagentSnapshot().catch(() => []);
    for (const { lines, ...info } of running) {
      const known = store().agents[info.agentId];
      store().upsert(info);
      // An output event between the listen and the snapshot already brought its newest lines.
      if (!known) store().append(info.agentId, lines);
    }
    ensureUnplaced();
    // A scene shown later (a reload, another workspace) takes the nodes it missed; deferred, as this runs inside Excalidraw's onChange.
    canvasStore.subscribe((s, previous) => {
      if (s.nodeIds !== previous.nodeIds && unplaced().length) requestAnimationFrame(ensureUnplaced);
    });
  })();
  return installed;
}
