import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createGroupFrame, groupInfoOf, insertIntoFrame, type Rect } from "@/canvas/groups";
import { createNodeElement, NODE_SIZE, nodeKindOf } from "@/canvas/nodeElement";
import type { Arrival } from "@/agents/arrivals";
import { COLUMN_GAP, clearSpot, frameAround, GROUP_GAP, PADDING, PADDING_TOP, ROW_GAP } from "@/agents/groupLayout";
import { namesInWorkspace, pantheonForNewGroup } from "@/agents/naming";
import { sceneAccess } from "@/agents/sceneAccess";
import { markLaunching } from "@/agents/spawnFamily";
import { reflowSpawnTree } from "@/agents/spawnTree";
import { addTerminal, placeTerminal, removeFromStoredScene, removeNodes } from "@/agents/terminals";
import { withWire, withWireBetween } from "@/agents/wires";
import { messages } from "@/i18n";
import { MANAGER_ROLE, type AgentId } from "@/ipc/pty";
import { emptyBoard } from "@/kanban/board";
import { kanbanWidth } from "@/kanban/width";
import { linkedBoards } from "@/kanban/fleetBoards";
import { kanbanMessages } from "@/kanban/messages";
import { agentMessages } from "@/mcp/messages";
import { nodesMessages } from "@/nodes/messages";
import { newTerminalPayload, relaunchMode } from "@/nodes/terminal/launch";
import { relaunchTerminal, stopTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { isManagerRecord, nodeNameOf, nodesStore, sessionOf } from "@/store/nodes";
import { statusOf } from "@/store/terminalStatus";
import { missionFolder } from "./folder";
import type { Mission } from "./mission";
import { fleetShown, managedFleet, missionOf, setMission } from "./store";
import { teamAgent } from "./teamModel";

/**
 * A mission's Manager: at the plan's go-ahead dummyPlane — not the Fleet's model —
 * puts a Kanban board right of the Fleet (wired Fleet → Board), a Manager terminal under the board (wired
 * Board → Manager), and the team's new agents as the Manager's sub-agents (`spawnedBy`), which lay out as a
 * vertical tree under it (`@/agents/spawnLayout`). The Manager and its team stand in a group of their own,
 * "Mission <name>", as a go-ahead's team did before Managers: the frame grows with their tree, and its
 * agents' own sub-agents join it. The board stays out of it, above it: the record of the work, it outlives
 * the Manager. The whole is kept beside the Fleet as the Fleet's own sub-agents
 * come and go, and taken along when it is dragged (`@/agents/missionLayout`). The Manager runs the mission with the team; the Fleet
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
 * Where a new board `width` wide goes: right of the Fleet, GROUP_GAP from it, tops aligned; moved down past
 * what it would cover, its neighbours kept a column's and a row's air away (a wired group, the Fleet's sub-agents…).
 */
export function boardSpot(fleet: Rect, obstacles: readonly Rect[], width: number = NODE_SIZE.kanban.width): Rect {
  const { height } = NODE_SIZE.kanban;
  const grown = obstacles.map((o) => ({ x: o.x - COLUMN_GAP, y: o.y - ROW_GAP, width: o.width + 2 * COLUMN_GAP, height: o.height + 2 * ROW_GAP }));
  return clearSpot({ x: fleet.x + fleet.width + GROUP_GAP, y: fleet.y, width, height }, grown);
}

/**
 * The Manager under the board, in its team's group: the frame's left edge on the board's, its top GROUP_GAP
 * below the board (`addTerminal` moves it clear of neighbours; the frame is then made around it).
 */
export function managerCenter(board: Rect): { x: number; y: number } {
  return { x: board.x + PADDING + NODE_SIZE.terminal.width / 2, y: board.y + board.height + GROUP_GAP + PADDING_TOP + NODE_SIZE.terminal.height / 2 };
}

/** The group a mission's Manager stands in with its team; none for a Manager made before missions had one. */
export function teamFrameOf(elements: readonly ExcalidrawElement[], managerId: string): ExcalidrawElement | undefined {
  const manager = elements.find((e) => e.id === managerId && !e.isDeleted);
  const frame = manager?.frameId ? elements.find((e) => e.id === manager.frameId && !e.isDeleted) : undefined;
  return frame && groupInfoOf(frame) ? frame : undefined;
}

/** A live group on the scene, by id. */
function liveGroup(elements: readonly ExcalidrawElement[], id: string | undefined): ExcalidrawElement | undefined {
  const frame = id ? elements.find((e) => e.id === id && !e.isDeleted) : undefined;
  return frame && groupInfoOf(frame) ? frame : undefined;
}

/** The mission keeps the group its Manager and team stand in (`Mission.teamFrame`): a re-open or a new agent finds it by that id. */
function rememberTeamFrame(fleetId: string | undefined, frameId: string) {
  const mission = fleetId ? missionOf(nodesStore.getState().nodes[fleetId]) : undefined;
  if (fleetId && mission && mission.teamFrame !== frameId) setMission(fleetId, { teamFrame: frameId });
}

/**
 * The group of an agent made for the mission that stands on the canvas: the team's, never a linked agent's or one sent
 * to a chosen group, which stand in a group of their own.
 */
function memberFrame(elements: readonly ExcalidrawElement[], mission: Mission): ExcalidrawElement | undefined {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const team = mission.members.filter((m) => !m.linked && !m.group && byId.get(m.nodeId)?.isDeleted === false);
  return team.map((m) => liveGroup(elements, byId.get(m.nodeId)?.frameId ?? undefined)).find((frame) => frame !== undefined);
}

/**
 * A mission saved before it kept its group's id: the one group named after it ("Mission <name>") that no other Fleet's
 * mission keeps. Never when the id is kept: a group deleted since was the user's doing.
 */
function namedFrame(elements: readonly ExcalidrawElement[], fleetId: string | undefined, mission: Mission): ExcalidrawElement | undefined {
  if (mission.teamFrame !== undefined) return undefined;
  const claimed = new Set(
    Object.entries(nodesStore.getState().nodes).flatMap(([id, record]) => (id === fleetId ? [] : [missionOf(record)?.teamFrame ?? ""])),
  );
  const name = nm().teamGroup(mission.name ?? "");
  const found = elements.filter((e) => !e.isDeleted && e.type === "frame" && e.name === name && groupInfoOf(e) && !claimed.has(e.id));
  return found.length === 1 ? found[0] : undefined;
}

/**
 * The group a mission's Manager and team stand in, whoever of them is still on the canvas: the live Manager's own, else the
 * one the mission kept (`Mission.teamFrame`: after a restart none of them may stand in it), else that of an agent made for the
 * mission still there, of the closed Manager's own element, or the one named after the mission. None when there is none:
 * a group the user deleted is gone, and a new one is made.
 */
export function missionTeamFrame(elements: readonly ExcalidrawElement[], fleetId: string | undefined, mission: Mission, managerId: string): ExcalidrawElement | undefined {
  const closedManager = elements.find((e) => e.id === managerId);
  return (
    teamFrameOf(elements, managerId) ??
    liveGroup(elements, mission.teamFrame) ??
    memberFrame(elements, mission) ??
    liveGroup(elements, closedManager?.frameId ?? undefined) ??
    namedFrame(elements, fleetId, mission)
  );
}

/**
 * Its group found, a running mission keeps its id, as a restart reads it back: the Fleet's or its Manager's first run
 * after one calls this, for a mission started before the id was kept. Nothing when no group is found.
 */
export function keepTeamFrame(fleetId: string) {
  const record = nodesStore.getState().nodes[fleetId];
  const mission = missionOf(record);
  if (!record || !mission?.manager || mission.teamFrame) return;
  const frame = missionTeamFrame(sceneAccess(record.workspaceId)?.elements() ?? [], fleetId, mission, mission.manager);
  if (frame) rememberTeamFrame(fleetId, frame.id);
}

const random = () => Math.floor(Math.random() * 2 ** 31);

/** `elements` with `nodeId` in `frame`: its frameId set, and it before the frame, which Excalidraw keeps above its members. */
function intoFrame(elements: readonly ExcalidrawElement[], nodeId: string, frame: ExcalidrawElement): ExcalidrawElement[] {
  const element = elements.find((e) => e.id === nodeId);
  if (!element) return [...elements];
  const joined = { ...element, frameId: frame.id, version: element.version + 1, versionNonce: random(), updated: Date.now() };
  return insertIntoFrame(
    elements.filter((e) => e.id !== nodeId),
    joined,
    frame,
  );
}

/** A new Manager in a group of its own around it, named after the mission, whose new agents are named from `pantheon`; the mission keeps it. */
function frameManager(fleetId: string, workspaceId: string, managerId: string, mission: Mission, pantheon: string) {
  const scene = sceneAccess(workspaceId);
  const manager = scene?.elements().find((e) => e.id === managerId && !e.isDeleted);
  if (!scene || !manager || manager.frameId) return;
  const frame = createGroupFrame(frameAround([manager]), nm().teamGroup(mission.name ?? ""), { role: "general", pantheon });
  scene.write(intoFrame(scene.elements(), managerId, frame));
  rememberTeamFrame(fleetId, frame.id);
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
  const board = emptyBoard(messages(kanbanMessages).defaultColumns);
  // As wide as its node makes it once shown (`kanbanWidth`), growing to the right: placed at that width, it covers nothing then.
  const spot = boardSpot(fleet, obstacles, kanbanWidth(board.columns.length));
  const element = { ...createNodeElement("kanban", { x: spot.x + spot.width / 2, y: spot.y + spot.height / 2 }), x: spot.x, y: spot.y, width: spot.width };
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
 * else a new one, in a group of its own whose agents are named from `pantheon` (the team's). Both are
 * recorded on the mission at once, so a launch tried again finds them.
 */
export async function setUpBoard(
  fleetId: string,
  workspaceId: string,
  mission: Mission,
  agent: AgentId,
  arrival: Arrival,
  pantheon: string = pantheonForNewGroup(workspaceId),
): Promise<MissionSetup> {
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
      setMission(fleetId, { board: undefined, boardMade: undefined });
      throw new Error(t.groupFailed);
    }
    managerId = (await addTerminal(workspaceId, payload, managerCenter(board), null, arrival)) ?? undefined;
    if (!managerId) {
      if (boardMade) dropNodes(fleetId, workspaceId, [boardId]);
      setMission(fleetId, { board: undefined, boardMade: undefined });
      throw new Error(t.groupFailed);
    }
    frameManager(fleetId, workspaceId, managerId, mission, pantheon);
  } else {
    // A launch tried again: its group is there already, and the mission keeps it.
    const frame = teamFrameOf(sceneAccess(workspaceId)?.elements() ?? [], managerId);
    if (frame) rememberTeamFrame(fleetId, frame.id);
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
  const going = [...(setup.managerMade ? withEmptyFrame(workspaceId, setup.managerId) : []), ...(setup.boardMade ? [setup.boardId] : [])];
  if (setup.managerMade) stopTerminal(setup.managerId);
  dropNodes(fleetId, workspaceId, going);
  setMission(fleetId, {
    ...(setup.managerMade ? { manager: undefined, teamFrame: undefined } : {}),
    ...(setup.boardMade ? { board: undefined, boardMade: undefined } : {}),
  });
}

/** The Manager, and its team's group when nothing else stands in it: an empty frame would outlive the mission. */
function withEmptyFrame(workspaceId: string, managerId: string): string[] {
  const elements = sceneAccess(workspaceId)?.elements() ?? [];
  const frame = teamFrameOf(elements, managerId);
  const alone = frame && !elements.some((e) => !e.isDeleted && e.frameId === frame.id && e.id !== managerId);
  return alone ? [managerId, frame.id] : [managerId];
}

/**
 * A new agent of the team as the Manager's sub-agent: its terminal under the Manager (`spawnedBy`), in its
 * group, the spawn wire from the Manager, held as launching until its sub-task is typed (`assign`): a
 * teammate's message must not land in its shell. The vertical tree lays it out (`reflowTeam`), the group
 * growing around it; until then the frame hides it.
 */
export async function addTeamMember(workspaceId: string, managerId: string, payload: TerminalPayload, task: string, arrival: Arrival): Promise<string | null> {
  const manager = liveElement(workspaceId, managerId);
  const fleetId = managedFleet(managerId);
  const mission = missionOf(fleetId ? nodesStore.getState().nodes[fleetId] : undefined);
  // Its Manager closed (or gone with a restart), the mission's group is still where the team stands.
  const kept = !manager && mission ? missionTeamFrame(sceneAccess(workspaceId)?.elements() ?? [], fleetId, mission, managerId) : undefined;
  const center = manager
    ? { x: manager.x + manager.width / 2, y: manager.y + manager.height + GROUP_GAP + NODE_SIZE.terminal.height / 2 }
    : kept
      ? { x: kept.x + kept.width / 2, y: kept.y + kept.height / 2 }
      : { x: 0, y: 0 };
  const nodeId = await addTerminal(workspaceId, { ...payload, spawnedBy: managerId, task }, center, null, arrival);
  if (!nodeId) return null;
  markLaunching(nodeId, true);
  const scene = sceneAccess(workspaceId);
  if (!scene) return nodeId;
  const frame = mission ? missionTeamFrame(scene.elements(), fleetId, mission, managerId) : teamFrameOf(scene.elements(), managerId);
  if (frame) rememberTeamFrame(fleetId, frame.id);
  scene.write(withWire(frame ? intoFrame(scene.elements(), nodeId, frame) : scene.elements(), managerId, nodeId, undefined, true));
  return nodeId;
}

/** The team's tree under its Manager laid out again, once its agents joined. */
export function reflowTeam(workspaceId: string, managerId: string) {
  reflowSpawnTree(workspaceId, managerId);
}

/**
 * "Clean up the mission": its Manager leaves the canvas with it, and its team's group once nothing else stands
 * in it (the team left at the mission's end); the board stays, the record of the work.
 */
export function removeManager(fleetId: string) {
  const record = nodesStore.getState().nodes[fleetId];
  const managerId = missionOf(record)?.manager;
  if (!record || !managerId || !isManagerRecord(nodesStore.getState().nodes[managerId])) return;
  stopTerminal(managerId);
  dropNodes(fleetId, record.workspaceId, withEmptyFrame(record.workspaceId, managerId));
}

/** The Manager's name as the Fleet and the lines say it. */
export function managerNameOf(fleetId: string): string {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  const managerId = mission?.manager;
  // Closed before a restart, its node is gone: the name it had is kept with its conversation.
  const kept = managerId && mission?.managerSession?.nodeId === managerId ? mission.managerSession.name : "";
  return (managerId && nodeNameOf(nodesStore.getState().nodes[managerId])) || kept || nm().managerName;
}

/**
 * What a closed Manager comes back with: its node's own payload while its record is still in memory (closed since
 * dummyPlane started), else one made as the go-ahead makes it, on the conversation the mission kept
 * (`managerSession`). Rust starts a new one under that id when none was saved.
 */
function reopenedPayload(fleetId: string, workspaceId: string, mission: Mission, managerId: string): TerminalPayload | null {
  const record = nodesStore.getState().nodes[managerId];
  if (record?.kind === "terminal") return record.payload;
  const kept = mission.managerSession?.nodeId === managerId ? mission.managerSession : undefined;
  const payload = managerPayload(fleetId, mission, kept?.agent ?? teamAgent(fleetId), kept?.name ?? managerName(workspaceId));
  if (!payload) return null;
  if (kept?.claudeSessionId) payload.claudeSessionId = kept.claudeSessionId;
  if (kept?.codexSessionId) payload.codexSessionId = kept.codexSessionId;
  return payload;
}

/**
 * The Fleet's `relaunch` of a Manager closed while its mission runs: back on the canvas under the same node (its
 * team's spawn wires, its board's wire and its role follow the id), in its team's group under the board, as the
 * go-ahead places it, then started again on its own conversation. Why it could not, or null.
 */
export async function reopenManager(fleetId: string): Promise<string | null> {
  const t = messages(agentMessages).launch;
  const record = nodesStore.getState().nodes[fleetId];
  const mission = missionOf(record);
  const managerId = mission?.manager;
  if (!record || !mission || !managerId) return t.groupFailed;
  const { workspaceId } = record;
  const anchor = liveElement(workspaceId, mission.board) ?? liveElement(workspaceId, fleetId);
  const payload = reopenedPayload(fleetId, workspaceId, mission, managerId);
  if (!sceneAccess(workspaceId) || !anchor) return t.leftWorkspace;
  if (!payload) return t.groupFailed;
  // Its row first: a scene save drops the rows of nodes it does not hold, and a node with no row is taken for a copy.
  await nodesStore.getState().create(managerId, { workspaceId, kind: "terminal", payload });
  const scene = sceneAccess(workspaceId);
  if (!scene) return t.leftWorkspace;
  const elements = scene.elements();
  // The mission's own group, found by the id it kept even when no agent stands in it any more: never a second one.
  const frame = missionTeamFrame(elements, fleetId, mission, managerId);
  // The one it was, deleted, gives way: two elements never share an id, and the new one is the newer version of it.
  const old = elements.find((e) => e.id === managerId);
  const element = {
    ...createNodeElement("terminal", managerCenter(anchor)),
    id: managerId,
    ...(old ? { version: old.version + 1, versionNonce: random(), updated: Date.now() } : {}),
  } as ExcalidrawElement;
  scene.write(placeTerminal(elements.filter((e) => e.id !== managerId), element, frame?.id ?? null));
  if (frame) {
    rememberTeamFrame(fleetId, frame.id);
    reflowTeam(workspaceId, managerId);
  } else frameManager(fleetId, workspaceId, managerId, mission, pantheonForNewGroup(workspaceId));
  if (mission.board) wireUp(workspaceId, mission.board, managerId);
  try {
    await relaunchTerminal(managerId, payload, relaunchMode(payload));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  // A refused spawn leaves its error on the terminal, it does not throw.
  const status = statusOf(managerId);
  return status.state === "error" ? status.message : null;
}

/** The Fleet's name as the Manager and the lines say it. */
export const fleetNameOf = (fleetId: string) => nodeNameOf(nodesStore.getState().nodes[fleetId]) || nm().defaultName;
