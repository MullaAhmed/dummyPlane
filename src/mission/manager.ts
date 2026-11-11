import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Rect } from "@/canvas/groups";
import { createNodeElement, NODE_SIZE, nodeKindOf } from "@/canvas/nodeElement";
import type { Arrival } from "@/agents/arrivals";
import { COLUMN_GAP, clearSpot, GROUP_GAP, ROW_GAP } from "@/agents/groupLayout";
import { namesInWorkspace } from "@/agents/naming";
import { sceneAccess } from "@/agents/sceneAccess";
import { markLaunching } from "@/agents/spawnFamily";
import { reflowSpawnTree } from "@/agents/spawnTree";
import { addTerminal, removeFromStoredScene, removeNodes } from "@/agents/terminals";
import { withWire, withWireBetween } from "@/agents/wires";
import { messages } from "@/i18n";
import { MANAGER_ROLE, type AgentId } from "@/ipc/pty";
import { emptyBoard } from "@/kanban/board";
import { linkedBoards } from "@/kanban/fleetBoards";
import { kanbanMessages } from "@/kanban/messages";
import { agentMessages } from "@/mcp/messages";
import { nodesMessages } from "@/nodes/messages";
import { newTerminalPayload } from "@/nodes/terminal/launch";
import { stopTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { isManagerRecord, nodeNameOf, nodesStore, sessionOf } from "@/store/nodes";
import { missionFolder } from "./folder";
import type { Mission } from "./mission";
import { fleetShown, missionOf, setMission } from "./store";

/**
 * A mission's Manager: at the plan's go-ahead dummyPlane — not the Fleet's model —
 * puts a Kanban board right of the Fleet (wired Fleet → Board), a Manager terminal under the board (wired
 * Board → Manager), and the team's new agents as the Manager's sub-agents (`spawnedBy`), which lay out as a
 * vertical tree under it (`@/agents/spawnLayout`). The Manager runs the mission with the team; the Fleet
 * babysits the board and keeps talking with the user, undisturbed by the team (`missionRunner`).
 */

const nm = () => messages(nodesMessages).fleet;

/** What the go-ahead set up, and what of it this launch made: a failed launch takes back only that. */
export interface MissionSetup {
  boardId: string;
  boardMade: boolean;
  managerId: string;
  managerMade: boolean;
}

const rectOf = (e: Rect): Rect => ({ x: e.x, y: e.y, width: e.width, height: e.height });

function liveElement(workspaceId: string, nodeId: string | undefined): ExcalidrawElement | undefined {
  if (!nodeId) return undefined;
  return sceneAccess(workspaceId)
    ?.elements()
    .find((e) => e.id === nodeId && !e.isDeleted);
}

/** The Manager's name: "Manager", numbered when the workspace already has one. */
function managerName(workspaceId: string): string {
  const taken = new Set(namesInWorkspace(workspaceId).map((name) => name.toLowerCase()));
  const base = nm().managerName;
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/**
 * The Manager's terminal: on the Fleet's CLI (`agent`), in the Fleet's folder, shell and account, with its
 * model, effort and extensions; at night the mission's permission (its night). A conversation of its own.
 */
export function managerPayload(fleetId: string, mission: Mission, agent: AgentId, name: string): TerminalPayload | null {
  const session = sessionOf(nodesStore.getState().nodes[fleetId]);
  if (!session) return null;
  const payload = newTerminalPayload(
    { title: nm().managerTitle(mission.name ?? ""), cwd: missionFolder(fleetId) || session.cwd, agent, command: "", shell: session.shell, accountId: session.accountId },
    name,
  );
  payload.role = MANAGER_ROLE;
  payload.fleet = fleetId;
  if (session.model && session.agent === agent) payload.model = session.model;
  if (session.effort) payload.effort = session.effort;
  if (session.extensions) payload.extensions = session.extensions;
  if (mission.permission) payload.permission = mission.permission;
  return payload;
}

/**
 * Where a new board goes: right of the Fleet, GROUP_GAP from it, tops aligned; moved down past what it would
 * cover, its neighbours kept a column's and a row's air away (a wired group, the Fleet's sub-agents…).
 */
export function boardSpot(fleet: Rect, obstacles: readonly Rect[]): Rect {
  const { width, height } = NODE_SIZE.kanban;
  const grown = obstacles.map((o) => ({ x: o.x - COLUMN_GAP, y: o.y - ROW_GAP, width: o.width + 2 * COLUMN_GAP, height: o.height + 2 * ROW_GAP }));
  return clearSpot({ x: fleet.x + fleet.width + GROUP_GAP, y: fleet.y, width, height }, grown);
}

/** The Manager under the board: centered on it, GROUP_GAP below (`addTerminal` moves it clear of neighbours). */
export function managerCenter(board: Rect): { x: number; y: number } {
  return { x: board.x + board.width / 2, y: board.y + board.height + GROUP_GAP + NODE_SIZE.terminal.height / 2 };
}

/** A new board for the mission, beside the Fleet, linked to it: its first column is the mission's to-do. */
async function makeBoard(fleetId: string, workspaceId: string): Promise<string> {
  const scene = sceneAccess(workspaceId);
  const fleet = liveElement(workspaceId, fleetId);
  if (!scene || !fleet) throw new Error(messages(agentMessages).launch.leftWorkspace);
  const obstacles = scene
    .elements()
    .filter((e) => !e.isDeleted && e.id !== fleetId && (nodeKindOf(e) !== null || e.type === "frame"))
    .map(rectOf);
  const spot = boardSpot(fleet, obstacles);
  const element = createNodeElement("kanban", { x: spot.x + spot.width / 2, y: spot.y + spot.height / 2 });
  const board = emptyBoard(messages(kanbanMessages).defaultColumns);
  const payload = board.columns[0] ? { ...board, orchestrator: { nodeId: fleetId, columnId: board.columns[0].id } } : board;
  await nodesStore.getState().create(element.id, { workspaceId, kind: "kanban", payload });
  // Read again after the wait: the scene may have changed meanwhile.
  const now = sceneAccess(workspaceId);
  if (!now) throw new Error(messages(agentMessages).launch.leftWorkspace);
  now.write([...now.elements(), element]);
  return element.id;
}

/** Wires `from` to `to` on the workspace's scene unless a wire already joins them. */
function wireUp(workspaceId: string, from: string, to: string) {
  const scene = sceneAccess(workspaceId);
  if (!scene) return;
  const before = scene.elements();
  const after = withWireBetween(before, from, to);
  if (after.length !== before.length) scene.write(after);
}

/**
 * The board and its Manager, at the go-ahead: the board the mission already has, else the one handed to the
 * Fleet ("Plan with the fleet"), else a new one; the Manager the mission already has (a launch cut short),
 * else a new one. Both are recorded on the mission at once, so a launch tried again finds them.
 */
export async function setUpBoard(fleetId: string, workspaceId: string, mission: Mission, agent: AgentId, arrival: Arrival): Promise<MissionSetup> {
  const t = messages(agentMessages).launch;
  const known = (id: string | undefined, kind: "kanban" | "terminal") => {
    const record = id ? nodesStore.getState().nodes[id] : undefined;
    return id !== undefined && record?.kind === kind && liveElement(workspaceId, id) !== undefined;
  };
  let boardId = known(mission.board, "kanban") ? mission.board : linkedBoards(fleetId).find((b) => known(b.nodeId, "kanban"))?.nodeId;
  const boardMade = boardId === undefined;
  if (!boardId) boardId = await makeBoard(fleetId, workspaceId);
  const ownBoard = boardMade || (boardId === mission.board && mission.boardMade === true);
  setMission(fleetId, { board: boardId, boardMade: ownBoard || undefined });
  wireUp(workspaceId, fleetId, boardId);

  const reused = mission.manager && known(mission.manager, "terminal") && isManagerRecord(nodesStore.getState().nodes[mission.manager]) ? mission.manager : undefined;
  let managerId = reused;
  if (!managerId) {
    const payload = managerPayload(fleetId, mission, agent, managerName(workspaceId));
    const board = liveElement(workspaceId, boardId);
    if (!payload || !board) {
      if (boardMade) dropNodes(fleetId, workspaceId, [boardId]);
      throw new Error(t.groupFailed);
    }
    managerId = (await addTerminal(workspaceId, payload, managerCenter(board), null, arrival)) ?? undefined;
    if (!managerId) {
      if (boardMade) dropNodes(fleetId, workspaceId, [boardId]);
      setMission(fleetId, { board: undefined, boardMade: undefined });
      throw new Error(t.groupFailed);
    }
  }
  setMission(fleetId, { manager: managerId });
  wireUp(workspaceId, boardId, managerId);
  return { boardId, boardMade, managerId, managerMade: reused === undefined };
}

/** Nodes leave the canvas, on screen or not. */
function dropNodes(fleetId: string, workspaceId: string, ids: readonly string[]) {
  if (ids.length === 0) return;
  if (fleetShown(fleetId)) removeNodes(ids);
  else removeFromStoredScene(workspaceId, new Set(ids));
}

/** A failed launch takes back what it made of the setup: the Manager, and the board if it was new. */
export function undoSetup(fleetId: string, workspaceId: string, setup: MissionSetup) {
  const going = [...(setup.managerMade ? [setup.managerId] : []), ...(setup.boardMade ? [setup.boardId] : [])];
  if (setup.managerMade) stopTerminal(setup.managerId);
  dropNodes(fleetId, workspaceId, going);
  setMission(fleetId, {
    ...(setup.managerMade ? { manager: undefined } : {}),
    ...(setup.boardMade ? { board: undefined, boardMade: undefined } : {}),
  });
}

/**
 * A new agent of the team as the Manager's sub-agent: its terminal under the Manager (`spawnedBy`), the
 * spawn wire from the Manager, held as launching until its sub-task is typed (`assign`): a teammate's message
 * must not land in its shell. The vertical tree lays it out (`reflowTeam`).
 */
export async function addTeamMember(workspaceId: string, managerId: string, payload: TerminalPayload, task: string, arrival: Arrival): Promise<string | null> {
  const manager = liveElement(workspaceId, managerId);
  const center = manager
    ? { x: manager.x + manager.width / 2, y: manager.y + manager.height + GROUP_GAP + NODE_SIZE.terminal.height / 2 }
    : { x: 0, y: 0 };
  const nodeId = await addTerminal(workspaceId, { ...payload, spawnedBy: managerId, task }, center, null, arrival);
  if (!nodeId) return null;
  markLaunching(nodeId, true);
  const scene = sceneAccess(workspaceId);
  if (scene) scene.write(withWire(scene.elements(), managerId, nodeId, undefined, true));
  return nodeId;
}

/** The team's tree under its Manager laid out again, once its agents joined. */
export function reflowTeam(workspaceId: string, managerId: string) {
  reflowSpawnTree(workspaceId, managerId);
}

/** "Clean up the mission": its Manager leaves the canvas with it; the board stays, the record of the work. */
export function removeManager(fleetId: string) {
  const record = nodesStore.getState().nodes[fleetId];
  const managerId = missionOf(record)?.manager;
  if (!record || !managerId || !isManagerRecord(nodesStore.getState().nodes[managerId])) return;
  stopTerminal(managerId);
  dropNodes(fleetId, record.workspaceId, [managerId]);
}

/** The Manager's name as the Fleet and the lines say it. */
export function managerNameOf(fleetId: string): string {
  const managerId = missionOf(nodesStore.getState().nodes[fleetId])?.manager;
  return (managerId && nodeNameOf(nodesStore.getState().nodes[managerId])) || nm().managerName;
}

/** The Fleet's name as the Manager and the lines say it. */
export const fleetNameOf = (fleetId: string) => nodeNameOf(nodesStore.getState().nodes[fleetId]) || nm().defaultName;
