import { userIsTyping } from "@/canvas/typing";
import { talk } from "@/agents/talkWires";
import { IN_VIEW, quietly, type Arrival } from "@/agents/arrivals";
import { pauseAgents } from "@/agents/broadcast";
import { signalFinish } from "@/agents/finishes";
import { GROUP_GAP, groupGrid } from "@/agents/groupLayout";
import { closeGroup, closeStoredGroup, launchGroup, showGroups } from "@/agents/groups";
import { defaultLaunchOptions } from "@/agents/launchAgent";
import { nextName } from "@/agents/names";
import { namesInWorkspace, pantheonForNewGroup } from "@/agents/naming";
import { fleetAgent } from "@/fleet/fleetAgent";
import { linkFleet } from "@/fleet/fleets";
import { sceneAccess } from "@/agents/sceneAccess";
import { addTerminal, removeFromStoredScene, removeNodes } from "@/agents/terminals";
import { messages } from "@/i18n";
import { missionAddAgent, missionCleanup, missionDiscard, missionMerge, missionPrepare, type Cleanup, type Worktree } from "@/ipc/mission";
import { ptySendText, ptyWrite, type AgentId, type Permission } from "@/ipc/pty";
import { FLEET_CAPABLE } from "@/fleet/capable";
import { newConversation, newTerminalPayload } from "@/nodes/terminal/launch";
import { freshText, quietFor, relaunchTerminal, stopTerminal } from "@/nodes/terminal/registry";
import { addTaskCards, linkedBoards, reassignMissionCard, startMissionCards } from "@/kanban/fleetBoards";
import { agentMessages } from "@/mcp/messages";
import { outReport } from "@/mcp/protocol";
import type { TerminalPayload } from "@/nodes/types";
import { nodeNameOf, nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { markLaunching } from "@/agents/spawnFamily";
import { activeCount, freeSeat, holdSeat, oneAtATime } from "./active";
import { notify } from "./events";
import { missionFolder } from "./folder";
import { addTeamMember, fleetNameOf, reflowTeam, removeManager, setUpBoard, undoSetup, type MissionSetup } from "./manager";
import { nightSession } from "./overnight";
import { NEW_AGENT, NEW_MISSION, oneLine, pastTask, queuedTask, sameName, type Member, type Mission, type SubTask } from "./mission";
import { whenReady } from "./ready";
import { modelFor } from "./router";
import { canvasKnown, linkedTeamAgents, linkedGroups, missionOf, missionRunner, fleetShown, releaseSpawnedPermission, setMission, updateMember, workspaceCanvas } from "./store";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const t = () => messages(agentMessages);

/** What an agent of the mission reads first. */
export function subTaskText(mission: string, task: SubTask, branch: string, handover?: string): string {
  const brief = oneLine(task.brief);
  const text = t().lines.subTask(mission, task.title, `${brief}${/[.!?]$/.test(brief) ? "" : "."}`, task.budgetMin, branch);
  return handover ? `${text} ${handover}` : text;
}

/**
 * What an agent is told of a task that may come from a ticket or from a Kanban
 * card, which GitHub may have filled: the fleet's note stops at the
 * fleet. A linked board counts whether the
 * task names its card or not: `card` is optional, the card's text was still read.
 */
export function withTicketNote(fleetId: string, mission: Mission, text: string, task?: { card?: string }): string {
  // A board the go-ahead made holds only the plan's own cards: nobody else wrote them.
  const handed = !mission.boardMade && (task?.card !== undefined || linkedBoards(fleetId).length > 0);
  return mission.tickets || handed ? `${text} ${t().lines.ticketData}` : text;
}

/**
 * What an agent of a mission its Manager runs is told beyond its sub-task: who runs it, and that it reaches
 * the Manager and its teammates with message_agent, no wire drawn by hand.
 */
export function withTeamNote(mission: Mission, text: string): string {
  const name = mission.manager ? nodeNameOf(nodesStore.getState().nodes[mission.manager]) : "";
  return name ? `${text} ${t().lines.teamNote(name)}` : text;
}

/** What the next agent learns of the previous one. */
export function handoverText(from: Member): string {
  const l = t().lines;
  const report = from.report ? l.handoverReport(outReport(from.report.status), oneLine(from.report.summary)) : l.handoverNoReport;
  return l.handover(from.name, report, from.branch);
}

/**
 * A linked agent moves to `cwd` in a new conversation: a Claude session does
 * not resume from another folder. It takes `model`, the router's,
 * or none to go back to Claude's own; likewise for what its
 * mission lets it do unasked.
 */
export function restartIn(nodeId: string, cwd: string, model?: string, permission?: Permission): Promise<void> {
  const payload = terminalOf(nodesStore.getState().nodes[nodeId]);
  if (!payload) return Promise.resolve();
  const patch = { cwd, model, permission, ...newConversation() };
  nodesStore.getState().update(nodeId, patch);
  return relaunchTerminal(nodeId, { ...payload, ...patch }, "new");
}

/**
 * Right of the fleet, GROUP_GAP from it, tops aligned: the wire between
 * them keeps a run of GROUP_GAP minus its two ends off the nodes. `launchGroup`
 * moves the group down past what it would cover.
 */
function besideFleet(fleetId: string, workspaceId: string, count: number) {
  const element = sceneAccess(workspaceId)?.elements().find((e) => e.id === fleetId && !e.isDeleted);
  if (!element) return undefined;
  const grid = groupGrid(count);
  return { x: element.x + element.width + GROUP_GAP + grid.width / 2, y: element.y + grid.height / 2 };
}

const frameCenter = (frame: { x: number; y: number; width: number; height: number }) => ({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });

/** The CLI a fleet's team runs on: the fleet's own (fleet/fleetAgent.ts). */
export function teamAgent(fleetId: string): AgentId {
  const agent = sessionOf(nodesStore.getState().nodes[fleetId])?.agent;
  return agent && FLEET_CAPABLE.includes(agent) ? agent : fleetAgent();
}

/**
 * The router's model for a task: its levels name Claude's models, which another CLI would refuse. The mission's
 * router routes the team of a Claude Fleet; a linked Claude agent whose own router is on (`linked`) takes it on a
 * Fleet of another CLI too, and keeps the model it has when the task names no level.
 */
function teamModel(fleetId: string, mission: Mission, task: SubTask, linked?: TerminalPayload): string | undefined {
  const byMission = teamAgent(fleetId) === "claude" && mission.router === true;
  const own = linked?.agent === "claude" && linked.router === true;
  return modelFor({ router: byMission }, task, { router: own }) ?? (own ? linked?.model : undefined);
}

/** The terminal of an agent created for the mission, in its worktree, on its team's CLI. */
const agentPayload = (agent: AgentId, name: string, cwd: string, model?: string, permission?: Permission) => ({
  ...newTerminalPayload({ ...defaultLaunchOptions(), cwd, agent }, name),
  ...(model ? { model } : {}),
  ...(permission ? { permission } : {}),
});

/** Like a linked agent, a group chosen in the plan may be gone at the go-ahead. */
function checkGroups(fleetId: string, plan: readonly SubTask[]) {
  const linked = linkedGroups(fleetId);
  const lost = plan.find((task) => task.group && !linked.some((g) => g.id === task.group?.id));
  if (lost?.group) throw new Error(t().launch.groupLost(lost.group.name));
}

/**
 * How the team of the go-ahead arrives: framed on the canvas, since the user just asked for it, unless they are
 * typing by now (forming it takes a while): then it joins quietly, and a notice says so.
 */
const teamArrival = (): Arrival => (userIsTyping() ? quietly("mission") : IN_VIEW);

type Team = Required<Pick<Mission, "project" | "slug" | "branch" | "worktree" | "manager" | "board">> & Pick<Mission, "members">;

/** The relaunch of each linked agent: it is judged ready only once it is done. */
type Restarts = Map<string, Promise<void>>;

/**
 * dummyPlane — not the AI — forms the team: every worktree first, then the board and its Manager
 * (`./manager`), then the agents, the new ones as the Manager's sub-agents in a tree under it. A failure takes back what this launch made.
 */
async function formTeam(fleetId: string, workspaceId: string, project: string, mission: Mission, restarts: Restarts): Promise<Team> {
  const plan = mission.plan ?? [];
  const linked = linkedTeamAgents(fleetId);
  const agents = plan.map((task) => (task.agent === NEW_AGENT ? null : (linked.find((a) => sameName(a.name, task.agent)) ?? null)));
  const lost = plan.find((task, i) => task.agent !== NEW_AGENT && !agents[i]);
  if (lost) throw new Error(t().launch.unlinked(lost.agent));
  checkGroups(fleetId, plan);
  const pantheon = pantheonForNewGroup(workspaceId);
  const taken = namesInWorkspace(workspaceId);
  const pantheonOf = (task: SubTask) => workspaceCanvas(workspaceId).frames.find((f) => f.id === task.group?.id)?.group?.pantheon ?? pantheon;
  const made: Worktree[] = [];
  const joined: string[] = [];
  let setup: MissionSetup | null = null;
  try {
    const root = await missionPrepare(project, mission.name ?? "mission");
    made.push(root);
    const members: Member[] = [];
    for (const [i, task] of plan.entries()) {
      const agent = agents[i];
      const name = agent?.name ?? nextName(pantheonOf(task), taken);
      taken.push(name);
      const tree = await missionAddAgent(project, root.slug, name);
      made.push(tree);
      const model = teamModel(fleetId, mission, task, terminalOf(nodesStore.getState().nodes[agent?.nodeId ?? ""]));
      members.push({
        nodeId: agent?.nodeId ?? "",
        name,
        task: task.title,
        budgetMin: task.budgetMin,
        linked: agent !== null,
        branch: tree.branch,
        worktree: tree.path,
        ...(model ? { model } : {}),
        ...(task.group ? { group: task.group.id } : {}),
      });
    }
    // Shown or not, its scene must be known to take the team.
    if (!canvasKnown(fleetId)) throw new Error(t().launch.leftWorkspace);
    checkGroups(fleetId, plan);
    // The board beside the Fleet, its Manager under it: the user just asked for them, they come into view.
    setup = await setUpBoard(fleetId, workspaceId, mission, teamAgent(fleetId), teamArrival());
    for (const [i, member] of members.entries()) {
      if (member.linked || member.group) continue;
      const payload = agentPayload(teamAgent(fleetId), member.name, member.worktree, member.model, mission.permission);
      const nodeId = await addTeamMember(workspaceId, setup.managerId, payload, plan[i].title, quietly("mission"));
      if (!nodeId) throw new Error(t().launch.groupFailed);
      member.nodeId = nodeId;
      joined.push(nodeId);
    }
    reflowTeam(workspaceId, setup.managerId);
    for (const [i, member] of members.entries()) {
      const group = plan[i].group;
      if (!group) continue;
      const frame = workspaceCanvas(workspaceId).frames.find((f) => f.id === group.id);
      if (!frame) throw new Error(t().launch.groupLost(group.name));
      const nodeId = await addTerminal(workspaceId, agentPayload(teamAgent(fleetId), member.name, member.worktree, member.model, mission.permission), frameCenter(frame), frame.id, teamArrival());
      if (!nodeId) throw new Error(t().launch.groupFailed);
      member.nodeId = nodeId;
      joined.push(nodeId);
    }
    // Agents who joined a linked group are shown there. Not while the user types: the notice says so.
    const groups = [...new Set(members.flatMap((m) => m.group ?? []))];
    if (groups.length > 0 && fleetShown(fleetId) && !userIsTyping()) showGroups(groups);
    // Linked agents move only once the whole team exists (final review H2).
    for (const member of members) if (member.linked) restarts.set(member.nodeId, restartIn(member.nodeId, member.worktree, member.model, mission.permission));
    return { project, slug: root.slug, branch: root.branch, worktree: root.path, members, manager: setup.managerId, board: setup.boardId };
  } catch (error) {
    // Its terminals first: no agent may sit in a folder that goes.
    removeTeam(fleetId, workspaceId, undefined, joined);
    if (setup) undoSetup(fleetId, workspaceId, setup);
    // What this launch made goes, so the plan can be launched again; never forced (final review H2).
    if (made.length > 0) await missionDiscard(project, made).catch(() => undefined);
    throw error;
  }
}

/** The mission's group and the agents that joined other groups leave the canvas, on screen or not. */
function removeTeam(fleetId: string, workspaceId: string, frameId: string | undefined, joined: readonly string[]) {
  if (fleetShown(fleetId)) {
    if (joined.length > 0) removeNodes(joined);
    if (frameId) closeGroup(frameId);
    return;
  }
  if (joined.length > 0) removeFromStoredScene(workspaceId, new Set(joined));
  if (frameId) closeStoredGroup(workspaceId, frameId);
}

/** Types `text`, its sub-task, in a member's terminal once it is ready. */
export async function assign(fleetId: string, member: Member, text: string, restarted: Promise<void> = Promise.resolve()) {
  const id = member.nodeId;
  try {
    // Before its relaunch ends, its screen and silence are the previous session's (final review H2).
    await restarted.catch(() => undefined);
    const agent = terminalOf(nodesStore.getState().nodes[id])?.agent;
    const ready = await whenReady({ running: () => isRunning(id), quietMs: () => quietFor(id), screen: () => freshText(id, 50), press: (keys) => ptyWrite(id, keys), agent });
    if (missionOf(nodesStore.getState().nodes[fleetId])?.state !== "en_cours") return;
    // Its Manager hears it, or the Fleet of a mission run the old way: never a Fleet whose board a Manager runs.
    const runner = missionRunner(fleetId);
    if (!isRunning(id)) {
      notify(runner, t().lines.notStarted(member.name));
      return;
    }
    // Its shell outlives a Claude that quit: the sub-task would be typed as a command (README mission).
    if (!ready) {
      notify(runner, t().lines.notReady(member.name));
      return;
    }
    await ptySendText(id, text);
    talk(runner, id);
    updateMember(fleetId, id, { sentAt: Date.now() });
  } finally {
    // Its sub-task typed or given up: teammates may message it now.
    markLaunching(id, false);
  }
}

/** "Launch the mission": the plan's go-ahead. A second click while it launches does nothing. */
export async function launchMission(fleetId: string): Promise<void> {
  const record = nodesStore.getState().nodes[fleetId];
  const mission = missionOf(record);
  const session = sessionOf(record);
  if (!record || !mission || !session || mission.state !== "plan" || !mission.plan?.length) return;
  // The router was turned on after the plan: without levels, every agent would get Claude's default model (final review maj §3).
  if (mission.router && [...mission.plan, ...(mission.queue ?? [])].some((task) => !task.level)) {
    const error = t().lines.levelsMissing;
    setMission(fleetId, { error });
    notify(fleetId, t().lines.proposeLevels(error));
    return;
  }
  setMission(fleetId, { state: "lancement", error: undefined });
  // Max agents start at once; the plan's other sub-tasks wait at the head of the queue for a seat.
  const plan = mission.plan.slice(0, mission.maxAgents);
  const waiting = mission.plan.slice(mission.maxAgents).map(queuedTask);
  const restarts: Restarts = new Map();
  let team: Team;
  try {
    team = await formTeam(fleetId, record.workspaceId, missionFolder(fleetId) || session.cwd, { ...mission, plan }, restarts);
  } catch (error) {
    setMission(fleetId, { state: "plan", error: errorText(error) });
    notify(fleetId, t().lines.couldNotStart(errorText(error)));
    return;
  }
  // `add_tasks` may have queued more while the team formed. Every task, the plan's and the queue's, is a card of the board.
  const queue = [...waiting, ...(missionOf(nodesStore.getState().nodes[fleetId])?.queue ?? mission.queue ?? [])];
  const carded = addTaskCards(fleetId, plan);
  const cardedQueue = addTaskCards(fleetId, queue);
  setMission(fleetId, { state: "en_cours", startedAt: Date.now(), ...team, plan: carded, frameId: undefined, ...(cardedQueue.length > 0 ? { queue: cardedQueue } : {}) });
  const started = missionOf(nodesStore.getState().nodes[fleetId]) ?? mission;
  // The Manager gets its orders; the Fleet hears nothing of the team from now on (`missionRunner`).
  const names = team.members.map((m) => `${m.name} (${m.task})`).join(", ");
  notify(team.manager, t().lines.managerOrders(mission.name ?? "", fleetNameOf(fleetId), oneLine(mission.task ?? ""), team.board, names, team.branch, mission.maxAgents));
  talk(fleetId, team.board);
  talk(team.board, team.manager);
  void startMissionCards(fleetId, team.members, carded).catch(() => undefined);
  team.members.forEach((member, i) => void assign(fleetId, member, withTicketNote(fleetId, started, withTeamNote(started, subTaskText(mission.name ?? "", carded[i], member.branch)), carded[i]), restarts.get(member.nodeId)));
  // Fewer sub-tasks than Max agents, and tasks queued: new agents take them now. Imported late: the queue imports this module.
  if (plan.length < mission.maxAgents && queue?.length) void import("./queue").then(({ pumpQueue }) => pumpQueue(fleetId)).catch(() => undefined);
}

/** `finish`: created agents close, linked ones go back to the project. */
/** `ui`: the summary as the fleet wrote it in OpenUI Lang, when it did; `summary` is then its text. */
export function endMission(fleetId: string, summary: string, ui?: string) {
  const record = nodesStore.getState().nodes[fleetId];
  const mission = missionOf(record);
  if (!record || mission?.state !== "en_cours") return;
  // Ended first: the agents stopping now are no events.
  setMission(fleetId, { state: "terminee", summary, ...(ui ? { summaryUi: ui } : {}), endedAt: Date.now() });
  // The user hears it, if away (`@/shell/finishAlert`).
  signalFinish({ nodeId: fleetId, state: "done", summary });
  for (const member of mission.members) if (member.linked && mission.project) void restartIn(member.nodeId, mission.project);
  // Its own sub-agents (spawn_agent) stay open, without the night's permission: a later restart asks. So do its Manager's.
  releaseSpawnedPermission(fleetId, mission.permission);
  // Those who joined a group go alone: it stays, with its own agents. Under a
  // Manager, every agent made for the mission goes one by one (no mission group); the Manager stays until the
  // user cleans the mission up, its terminal showing how it ended.
  const joined = mission.members.filter((m) => !m.linked && (mission.manager !== undefined || m.group)).map((m) => m.nodeId);
  if (canvasKnown(fleetId)) {
    removeTeam(fleetId, record.workspaceId, mission.frameId, joined);
    return;
  }
  // Its scene was never read: the created agents stop, freeing their worktrees (final review H2).
  for (const member of mission.members) if (!member.linked) stopTerminal(member.nodeId);
}

/** The merges under way, by mission worktree: git merges one branch at a time there. */
const merging = new Map<string, Promise<unknown>>();

function oneMergeAtATime<T>(worktree: string, merge: () => Promise<T>): Promise<T> {
  const turn = (merging.get(worktree) ?? Promise.resolve()).then(merge, merge);
  merging.set(worktree, turn.catch(() => undefined));
  return turn;
}

/** Merges one member's branch into the mission's: what to say of it, and whether its branch is in. */
export function mergeMember(fleetId: string, worktree: string, member: Member): Promise<{ line: string; merged: boolean; uncommitted: boolean }> {
  const m = t().merge;
  return oneMergeAtATime(worktree, async () => {
    try {
      const { merge, uncommitted } = await missionMerge(worktree, member.worktree, member.branch);
      const note = uncommitted ? m.uncommitted : "";
      if (merge.kind === "conflict") return { line: m.conflict(member.name, merge.files.join(", "), note), merged: false, uncommitted };
      const said = merge.kind === "merged" ? m.merged : member.merged ? m.already : m.empty;
      // It may have taken another task meanwhile: that one is not merged.
      const now = missionOf(nodesStore.getState().nodes[fleetId])?.members.find((other) => other.nodeId === member.nodeId);
      if (now?.task === member.task && now.report?.at === member.report?.at) updateMember(fleetId, member.nodeId, { merged: true });
      return { line: m.line(member.name, said, note), merged: true, uncommitted };
    } catch (error) {
      return { line: m.failed(member.name, errorText(error)), merged: false, uncommitted: false };
    }
  });
}

/** `merge`: the branches of the agents done since the last merge. */
export async function mergeMission(fleetId: string): Promise<string> {
  const m = t().merge;
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!mission?.worktree) return m.noBranch;
  // Merged ones too: a merge with nothing new is harmless, and new commits after a merge get in (final review H2).
  // A handed-over agent's branch goes in through its successor's (final review H3).
  const ready = mission.members.filter((m) => m.report?.status === "termine" && !m.handedTo);
  if (ready.length === 0) return m.nothing;
  const lines: string[] = [];
  for (const member of ready) lines.push((await mergeMember(fleetId, mission.worktree, member)).line);
  return `${m.header(mission.branch ?? "")}\n${lines.join("\n")}`;
}

/** The cleanups under way, by fleet: a second caller joins the first instead of resetting the mission again behind it. */
const cleaning = new Map<string, Promise<Cleanup | string>>();

/**
 * "Clean up the mission": merged worktrees go, the branches stay; the fleet is free again. The panel's
 * button and the Fleet's own cleanup (`./cleanup.ts`) are this. The mission stays finished while git works: a call
 * made in that time (a click meanwhile, the Fleet's two calls in one turn) is the one under way, never a second
 * reset that would blank a plan drafted since the first.
 */
export function cleanMission(fleetId: string): Promise<Cleanup | string> {
  const under = cleaning.get(fleetId);
  if (under) return under;
  const run = cleanMissionNow(fleetId).finally(() => cleaning.delete(fleetId));
  cleaning.set(fleetId, run);
  return run;
}

async function cleanMissionNow(fleetId: string): Promise<Cleanup | string> {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (mission?.state !== "terminee") return t().launch.notFinished;
  // A night's length is that night's absence, no setting for the next mission; the fleet's session goes back to its day.
  const next: Mission = { ...NEW_MISSION, maxAgents: mission.maxAgents };
  if (mission.overnight) void nightSession(fleetId, { linear: false }).catch((error: unknown) => console.warn("fleet session not restored after the night", error));
  // The router is a setting like Max agents: the next mission keeps it checked.
  if (mission.router) next.router = true;
  // Its Manager goes with it; its board stays, still the Fleet's: the next mission runs on it.
  removeManager(fleetId);
  try {
    return mission.project && mission.slug ? await missionCleanup(mission.project, mission.slug, mission.members.map((m) => m.name)) : { removed: [], kept: [] };
  } catch (error) {
    return errorText(error);
  } finally {
    // Freed even when git fails (project moved, worktrees removed by hand): never stuck "finished" (final review H2).
    nodesStore.getState().update(fleetId, { mission: next });
  }
}

/**
 * A new agent for a sub-task (handed over, or from the queue): its worktree,
 * cut from the mission's branch, its terminal in the sub-task's group or the
 * mission's, started now. A member of the mission from then on, so that
 * `endMission` closes it and `cleanMission` removes its worktree.
 */
export async function newMember(fleetId: string, workspaceId: string, mission: Mission, task: SubTask): Promise<Member | string> {
  if (!mission.project || !mission.slug) return t().launch.noFolder;
  const { frames } = workspaceCanvas(workspaceId);
  // The sub-task's group if it still exists, else the mission's.
  const chosen = frames.find((f) => f.id === task.group?.id);
  const frame = chosen ?? frames.find((f) => f.id === mission.frameId);
  const pantheon = frame?.group?.pantheon ?? pantheonForNewGroup(workspaceId);
  // A closed member's name is free on the canvas, not in git: its branch is still there.
  const name = nextName(pantheon, [...namesInWorkspace(workspaceId), ...mission.members.map((m) => m.name)]);
  let tree: Worktree;
  try {
    tree = await missionAddAgent(mission.project, mission.slug, name);
  } catch (error) {
    return errorText(error);
  }
  const model = teamModel(fleetId, mission, task);
  let nodeId: string | null = null;
  if (mission.manager && !chosen) {
    // Under its Manager: one more of its sub-agents, in its tree. It arrives on its own, never taking the view nor the keyboard.
    const payload = agentPayload(teamAgent(fleetId), name, tree.path, model, mission.permission);
    nodeId = await addTeamMember(workspaceId, mission.manager, payload, task.title, quietly("mission"));
    if (nodeId) reflowTeam(workspaceId, mission.manager);
  } else if (frame) {
    // A queue's or a handover's agent arrives on its own, whenever a seat frees up: it never takes the view nor the keyboard.
    nodeId = await addTerminal(workspaceId, agentPayload(teamAgent(fleetId), name, tree.path, model, mission.permission), frameCenter(frame), frame.id, quietly("mission"));
  } else {
    const group = await launchGroup(
      { name: `Mission ${mission.name}`, role: "general", agents: [teamAgent(fleetId)] },
      defaultLaunchOptions(),
      besideFleet(fleetId, workspaceId, 1),
      { pantheon, names: [name], cwds: [tree.path], models: [model], permission: mission.permission, workspaceId },
      quietly("mission"),
    );
    if (group) {
      nodeId = group.nodeIds[0];
      linkFleet(fleetId, group.frameId);
      setMission(fleetId, { frameId: group.frameId });
    }
  }
  if (!nodeId) {
    await missionDiscard(mission.project, [tree]).catch(() => undefined);
    return t().reassign.createFailed;
  }
  return {
    nodeId,
    name,
    task: task.title,
    budgetMin: task.budgetMin,
    linked: false,
    branch: tree.branch,
    worktree: tree.path,
    ...(model ? { model } : {}),
    ...(chosen ? { group: chosen.id } : {}),
  };
}

/** `reassign`: to a member who reported, or to a new agent; it gets the previous one's report and branch. */
export async function reassignTask(fleetId: string, fromNodeId: string, target: string): Promise<{ name: string } | string> {
  const r = t().reassign;
  const record = nodesStore.getState().nodes[fleetId];
  const mission = missionOf(record);
  if (!record || mission?.state !== "en_cours") return r.noMission;
  // A task `next_task` abandoned stays with its agent's report: nobody takes it over.
  const from = mission.members.find((m) => m.nodeId === fromNodeId && !m.handedTo && !m.abandoned);
  const task = mission.plan?.find((s) => s.title === from?.task);
  if (!from || !task) return r.notFound;
  let to: Member;
  if (sameName(target, NEW_AGENT)) {
    if (!canvasKnown(fleetId)) return r.hidden;
    // Max agents caps the agents at work, not the team: those who reported or handed over count no more.
    if (activeCount(fleetId, mission) >= mission.maxAgents) return r.teamFull(mission.maxAgents);
    // Its seat is held while it is created, in turn with the queue's new agents: no name nor seat twice.
    holdSeat(fleetId, `reassign:${task.title}`);
    let made: Member | string;
    try {
      made = await oneAtATime(fleetId, () => newMember(fleetId, record.workspaceId, missionOf(nodesStore.getState().nodes[fleetId]) ?? mission, task));
    } finally {
      freeSeat(fleetId, `reassign:${task.title}`);
    }
    if (typeof made === "string") return made;
    to = made;
  } else {
    const found = mission.members.find((m) => sameName(m.name, target) && m.nodeId !== from.nodeId && !m.handedTo);
    if (!found) return r.notOther(target);
    if (!found.report) return r.notDone(found.name);
    // A stopped session would only say "did not start" a minute later.
    if (!isRunning(found.nodeId)) return r.targetStopped(found.name);
    // Its entry takes the new sub-task: its finished work must be in the mission's branch first (final review H3).
    const finished = found.report.status === "termine";
    if (finished && !found.merged) return r.notMerged(found.name, found.task);
    to = {
      ...found,
      task: task.title,
      budgetMin: task.budgetMin,
      extraMin: undefined,
      overdue: undefined,
      report: undefined,
      sentAt: undefined,
      merged: undefined,
      // Given a task again, it is no longer the one that left its own.
      abandoned: undefined,
      done: finished ? [...(found.done ?? []), found.task] : found.done,
      past: [...(found.past ?? []), pastTask(found, found.report)],
    };
  }
  const latest = missionOf(nodesStore.getState().nodes[fleetId]) ?? mission;
  const members = latest.members.map((m) => (m.nodeId === from.nodeId ? { ...m, handedTo: to.name } : m.nodeId === to.nodeId ? to : m));
  setMission(fleetId, { members: members.some((m) => m.nodeId === to.nodeId) ? members : [...members, to] });
  void reassignMissionCard(fleetId, latest.plan, task.title, to.name).catch(() => undefined);
  // The previous agent stops: its sub-task is another's now (final review H3).
  await pauseAgents([from.nodeId]).catch(() => 0);
  if (isRunning(from.nodeId)) {
    const runner = missionRunner(fleetId);
    void ptySendText(from.nodeId, t().lines.handedAway(from.task, to.name)).then(
      () => talk(runner, from.nodeId),
      () => undefined,
    );
  }
  void assign(fleetId, to, withTicketNote(fleetId, mission, withTeamNote(mission, subTaskText(mission.name ?? "", task, to.branch, handoverText(from))), task));
  return { name: to.name };
}
