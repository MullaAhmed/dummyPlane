import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import { toastError } from "@/lib/errorToast";
import { canvasStore } from "@/canvas/canvasStore";
import { isGroup } from "@/canvas/groups";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import { allowRemoval } from "@/canvas/removalGuard";
import { fleetSession } from "@/nodes/terminal/launch";
import { markForAutostart } from "@/nodes/terminal/registry";
import { messages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";
import { nodesStore } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { sceneAccess } from "@/agents/sceneAccess";
import { agentInstalled } from "@/agents/agentsStore";
import { AGENTS } from "@/agents/catalog";
import { clearSpot, fleetSpot } from "@/agents/groupLayout";
import { defaultLaunchOptions } from "@/agents/launchAgent";
import { agentsMessages } from "@/agents/messages";
import type { Point } from "@/agents/terminals";
import { withWire } from "@/agents/wires";
import { ensureFleetAgent, fleetAgent } from "./fleetAgent";
import { fleetMessages } from "./messages";

/** A new fleet with its session on the Fleet's CLI, which starts when it is shown (spec orchestrateur §6). */
async function createFleet(id: string, workspaceId: string) {
  // A new fleet is named in the interface's language (spec first version §7.1).
  const name = messages(nodesMessages).fleet.defaultName;
  const session = fleetSession(name, defaultLaunchOptions(workspaceId), fleetAgent());
  await nodesStore.getState().create(id, { workspaceId, kind: "fleet", payload: { name, session } });
  markForAutostart(id);
}

/**
 * A fleet runs on the CLI the user chose for it (asked before the first one, when there is a choice):
 * without it installed, nothing is created (spec first version §7.2).
 */
export async function refusedWithoutItsCli(): Promise<boolean> {
  const agent = await ensureFleetAgent();
  if (agent === null) return true;
  if (await agentInstalled(agent)) return false;
  toastError(agent === "claude" ? messages(agentsMessages).noClaude : messages(fleetMessages).agent.notInstalled(AGENTS[agent].label));
  return true;
}

/** "Link a fleet" of the group menu: a new fleet left of the group, wired to it, in one undo step. */
export async function addFleetToGroup(groupId: string): Promise<string | null> {
  const api = canvasStore.getState().api;
  const workspaceId = workspacesStore.getState().activeId;
  const group = canvasStore.getState().frames.find((f) => f.id === groupId);
  if (!api || !workspaceId || !group || !isGroup(group) || (await refusedWithoutItsCli())) return null;
  // A second fleet of the same group must not land on the first: moved past what it would cover.
  const { width, height } = NODE_SIZE.fleet;
  const spot = fleetSpot(group);
  const obstacles = api
    .getSceneElements()
    .filter((e) => e.type !== "arrow")
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
  const clear = clearSpot({ x: spot.x - width / 2, y: spot.y - height / 2, width, height }, obstacles);
  const element = createNodeElement("fleet", { x: clear.x + width / 2, y: clear.y + height / 2 });
  await createFleet(element.id, workspaceId);
  api.updateScene({
    elements: withWire([...api.getSceneElementsIncludingDeleted(), element], element.id, groupId),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return element.id;
}

/** The menu's "Fleet", placed with a click like an agent (spec theme §10.1). Its id, null when none was made. */
export async function addFleet(workspaceId: string, center: Point): Promise<string | null> {
  const api = canvasStore.getState().api;
  if (!api || (await refusedWithoutItsCli())) return null;
  const element = createNodeElement("fleet", center);
  await createFleet(element.id, workspaceId);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), element],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return element.id;
}

/** One click of "Link" (spec theme §13). */
export function linkFleet(fleetId: string, targetId: string) {
  const workspaceId = nodesStore.getState().nodes[fleetId]?.workspaceId ?? workspacesStore.getState().activeId;
  const scene = workspaceId ? sceneAccess(workspaceId) : null;
  scene?.write(withWire(scene.elements(), fleetId, targetId));
}

type Bound = { id: string; type: string; isDeleted?: boolean; startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null };

/** The wires of a fleet still on the canvas: they go with it. */
function fleetWires(elements: readonly Bound[], fleetId: string): string[] {
  return elements
    .filter((e) => !e.isDeleted && e.type === "arrow" && (e.startBinding?.elementId === fleetId || e.endBinding?.elementId === fleetId))
    .map((e) => e.id);
}

/** The × of a fleet: it and its wires go, in one undo step. */
export function removeFleet(fleetId: string) {
  const api = canvasStore.getState().api;
  if (!api) return;
  allowRemoval([fleetId]);
  const going = new Set([fleetId, ...fleetWires(api.getSceneElementsIncludingDeleted(), fleetId)]);
  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((e) => (!e.isDeleted && going.has(e.id) ? newElementWith(e, { isDeleted: true }) : e)),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** The × and "Close the fleet": a working fleet asks first (spec first version §5.4). */
export function requestCloseFleet(fleetId: string) {
  const api = canvasStore.getState().api;
  if (!api || !isRunning(fleetId)) return removeFleet(fleetId);
  const wires = fleetWires(api.getSceneElementsIncludingDeleted(), fleetId);
  uiStore.getState().setClosing({ agents: [fleetId], remove: [fleetId, ...wires] });
}

export function renameFleet(fleetId: string, name: string) {
  nodesStore.getState().update(fleetId, { name: name.trim() || messages(nodesMessages).fleet.defaultName });
}
