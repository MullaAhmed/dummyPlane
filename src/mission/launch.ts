import { groupOf } from "@/canvas/groups";
import { userIsTyping } from "@/canvas/typing";
import { talk } from "@/agents/talkWires";
import { IN_VIEW, quietly, type Arrival } from "@/agents/arrivals";
import { pauseAgents } from "@/agents/broadcast";
import { holdFor } from "@/agents/dialogs";
import { signalFinish } from "@/agents/finishes";
import { GROUP_GAP, groupGrid } from "@/agents/groupLayout";
import { closeGroup, closeStoredGroup, launchGroup, showGroups } from "@/agents/groups";
import { defaultLaunchOptions } from "@/agents/launchAgent";
import { nextName } from "@/agents/names";
import { namesInWorkspace, pantheonForNewGroup } from "@/agents/naming";
import { linkFleet } from "@/fleet/fleets";
import { sceneAccess } from "@/agents/sceneAccess";
import { addTerminal, removeFromStoredScene, removeNodes } from "@/agents/terminals";
import { messages } from "@/i18n";
import { cutWhole } from "@/lib/cut";
import { missionAddAgent, missionCleanup, missionDiscard, missionMerge, missionPrepare, missionProbe, missionRemoveAgent, type Cleanup, type Probe, type Worktree } from "@/ipc/mission";
import { readExtensionChoice, type ExtensionChoice } from "@/ipc/claudeExtensions";
import { ptySendText, ptyWrite, type AgentId, type Permission } from "@/ipc/pty";
import { newConversation, newTerminalPayload } from "@/nodes/terminal/launch";
import { freshText, quietFor, relaunchTerminal, stopTerminal } from "@/nodes/terminal/registry";
import { addTaskCards, finishMissionCard, linkedBoards, reassignMissionCard, startMissionCards } from "@/kanban/fleetBoards";
import { agentMessages } from "@/mcp/messages";
import { missionMessages } from "./messages";
import { isClosedNode } from "@/agents/closedNode";
import { keptOpen, type OpenReason } from "./keptOpen";
import { outReport, outStep } from "@/mcp/protocol";
import { nodeNameOf, nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { isRestarting, isRunning, waitForExit } from "@/store/terminalStatus";
import { hasSpawnedAtWork, markLaunching } from "@/agents/spawnFamily";
import { atWork, takenOver, wakeable, wakeFinished, wakingUp } from "@/agents/finishedStop";
import { subagentSettingsStore } from "@/app/subagentSettings";
import { activeCount, freeSeat, handingOver, hasSeat, holdSeat, moving, oneAtATime, seatsOf } from "./active";
import { notify } from "./events";
import { missionFolder } from "./folder";
import { addTeamMember, fleetNameOf, reflowTeam, removeManager, setUpBoard, undoSetup, type MissionSetup } from "./manager";
import { nightSession } from "./overnight";
import { newWorktreeLine } from "./setup";
import { conflictPending, NEW_AGENT, NEW_MISSION, oneLine, pastTask, queuedTask, reassignable, sameName, squashMessage, worktreeOwners, type Member, type Mission, type SubTask } from "./mission";
import { whenReady } from "./ready";
import { unreported } from "./unreported";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { levelModel, modelLabel } from "./router";
import { levelsRequired, routesLinked, teamAgent, teamModel } from "./teamModel";
import { agentState, canvasKnown, linkedTeamAgents, linkedGroups, missionOf, missionRunner, fleetShown, releaseSpawnedPermission, setMission, spawnedUnder, updateMember, workspaceCanvas } from "./store";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const t = () => messages(agentMessages);

/**
 * What an agent of the mission reads first. `setup`: what the agent of a new worktree is told of its dependencies
 * (`./setup`); none for one that took over a stopped agent's worktree.
 */
export function subTaskText(mission: string, task: SubTask, branch: string, handover?: string, setup?: string): string {
  const brief = oneLine(task.brief);
  const text = t().lines.subTask(mission, task.title, `${brief}${/[.!?]$/.test(brief) ? "" : "."}`, task.budgetMin, branch, setup);
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

/**
 * What the next agent learns of the previous one: its report and the steps it declared, and its branch, to merge in,
 * or the one it works on itself when it took over the previous one's worktree (`inPlace`).
 */
export function handoverText(from: Member, inPlace = false): string {
  const l = t().lines;
  const report = from.report ? l.handoverReport(outReport(from.report.status), oneLine(from.report.summary)) : l.handoverNoReport;
  const text = inPlace ? l.handoverInPlace(from.name, report, from.branch) : l.handover(from.name, report, from.branch);
  const steps = (terminalOf(nodesStore.getState().nodes[from.nodeId])?.steps ?? []).map((s) => `${oneLine(s.title)}: ${outStep(s.state)}`);
  return steps.length > 0 ? `${text} ${l.handoverSteps(steps)}` : text;
}

/**
 * A linked agent moves to `cwd` in a new conversation: a Claude session does
 * not resume from another folder. It takes `model`, the router's or
 * the one it kept, or none to go back to its CLI's own; likewise for what its
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

/** What the Fleet's own Edit panel turned off (skills, plugins, MCP servers, subagents): its new agents start without them too. */
const fleetExtensions = (fleetId: string): ExtensionChoice | undefined => readExtensionChoice(sessionOf(nodesStore.getState().nodes[fleetId])?.extensions);

/** The terminal of an agent created for the mission, in its worktree, on its team's CLI. */
const agentPayload = (agent: AgentId, name: string, cwd: string, model?: string, permission?: Permission, extensions?: ExtensionChoice) => ({
  ...newTerminalPayload({ ...defaultLaunchOptions(), cwd, agent }, name),
  ...(model ? { model } : {}),
  ...(permission ? { permission } : {}),
  ...(extensions && agent === "claude" ? { extensions } : {}),
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

type Team = Required<Pick<Mission, "project" | "slug" | "branch" | "worktree" | "manager" | "board">> & Pick<Mission, "members" | "base">;

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
      const linkedPayload = terminalOf(nodesStore.getState().nodes[agent?.nodeId ?? ""]);
      const model = teamModel(fleetId, mission, task, linkedPayload);
      members.push({
        nodeId: agent?.nodeId ?? "",
        name,
        task: task.title,
        budgetMin: task.budgetMin,
        linked: agent !== null,
        branch: tree.branch,
        worktree: tree.path,
        ...(model ? { model } : {}),
        ...(linkedPayload && !routesLinked(mission, linkedPayload) ? { keptModel: true as const } : {}),
        ...(task.group ? { group: task.group.id } : {}),
      });
    }
    // Shown or not, its scene must be known to take the team.
    if (!canvasKnown(fleetId)) throw new Error(t().launch.leftWorkspace);
    checkGroups(fleetId, plan);
    // The board beside the Fleet, its Manager under it in the team's group: the user just asked for them, they come into view.
    setup = await setUpBoard(fleetId, workspaceId, mission, teamAgent(fleetId), teamArrival(), pantheon);
    for (const [i, member] of members.entries()) {
      if (member.linked || member.group) continue;
      const payload = agentPayload(teamAgent(fleetId), member.name, member.worktree, member.model, mission.permission, fleetExtensions(fleetId));
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
      const nodeId = await addTerminal(workspaceId, agentPayload(teamAgent(fleetId), member.name, member.worktree, member.model, mission.permission, fleetExtensions(fleetId)), frameCenter(frame), frame.id, teamArrival());
      if (!nodeId) throw new Error(t().launch.groupFailed);
      member.nodeId = nodeId;
      joined.push(nodeId);
    }
    // Agents who joined a linked group are shown there. Not while the user types: the notice says so.
    const groups = [...new Set(members.flatMap((m) => m.group ?? []))];
    if (groups.length > 0 && fleetShown(fleetId) && !userIsTyping()) showGroups(groups);
    // Linked agents move only once the whole team exists (final review H2).
    for (const member of members) if (member.linked) restarts.set(member.nodeId, restartIn(member.nodeId, member.worktree, member.model, mission.permission));
    return { project, slug: root.slug, branch: root.branch, worktree: root.path, ...(root.base ? { base: root.base } : {}), members, manager: setup.managerId, board: setup.boardId };
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

/** The members whose sub-task dummyPlane still waits to type: a line their Manager writes meanwhile would cross it. */
const delivering = new Set<string>();

/** Whether dummyPlane still waits for a member's Claude to open, to type its sub-task itself (`write` refuses meanwhile). */
export function deliveryPending(nodeId: string): boolean {
  return delivering.has(nodeId);
}

/**
 * Types `text`, its sub-task, in a member's terminal once it is ready. A question only the user answers (a
 * project's new MCP server) may hold its Claude long past the minute: its runner hears once what it is as soon as it
 * shows (`holdFor`: the member waits for the user), or at the minute that a question may be waiting; the sub-task
 * still goes when the session opens, never twice, and the runner hears it went. Its `sentAt` is what makes its report the mission's (`memberOf`).
 * The text waits on the member (`brief`) until it is typed: dummyPlane restarted, or its terminal stopped and
 * started again, `./redeliver.ts` types it then. A member already waiting for its sub-task is not given a second one.
 */
export async function assign(fleetId: string, member: Member, text: string, restarted: Promise<void> = Promise.resolve()) {
  const id = member.nodeId;
  // Outside the try: this call's `finally` must not end the delivery under way.
  if (delivering.has(id)) return;
  delivering.add(id);
  // Before anything is awaited: the watcher of restarts never sees this member without its text, nor acts meanwhile.
  updateMember(fleetId, id, { brief: text });
  try {
    // Before its relaunch ends, its screen and silence are the previous session's (final review H2).
    await restarted.catch(() => undefined);
    const agent = terminalOf(nodesStore.getState().nodes[id])?.agent;
    // Still its to receive: the mission runs, it holds this sub-task, nobody typed it in meanwhile.
    const awaited = () => {
      const mission = missionOf(nodesStore.getState().nodes[fleetId]);
      const now = mission?.members.find((m) => m.nodeId === id);
      return mission?.state === "en_cours" && now?.task === member.task && !now.handedTo && now.sentAt === undefined;
    };
    let late = false;
    const ready = await whenReady({
      running: () => isRunning(id),
      quietMs: () => quietFor(id),
      screen: () => freshText(id, 50),
      press: (keys) => ptyWrite(id, keys),
      agent,
      waitLonger: () => isRunning(id) && awaited(),
      slow: () => {
        // A dialog shown: its runner already heard what it is (`holdFor`, then `./events`).
        if (!late) notify(missionRunner(fleetId), t().lines.slow(member.name));
        late = true;
      },
      held: holdFor(id, (dialog) => {
        if (dialog) late = true;
      }),
    });
    if (missionOf(nodesStore.getState().nodes[fleetId])?.state !== "en_cours") return;
    // Its Manager hears it, or the Fleet of a mission run the old way: never a Fleet whose board a Manager runs.
    const runner = missionRunner(fleetId);
    if (!isRunning(id)) {
      notify(runner, t().lines.notStarted(member.name));
      return;
    }
    // Handed over meanwhile: its sub-task is another's.
    if (!awaited()) return;
    // Its shell outlives a Claude that quit: the sub-task would be typed as a command (README mission).
    if (!ready) {
      notify(runner, t().lines.notReady(member.name));
      return;
    }
    await ptySendText(id, text);
    talk(runner, id);
    updateMember(fleetId, id, { sentAt: Date.now(), brief: undefined });
    if (late) notify(runner, t().lines.sentLate(member.name));
  } finally {
    delivering.delete(id);
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
  // Max agents lowered since the plan (the panel, a night's dialog): a linked agent's sub-task past it would go to the
  // queue, and to a new agent, unsaid. The plan's own rule, read again (`proposedPlan`).
  const late = mission.plan.findIndex((task, i) => task.agent !== NEW_AGENT && i >= mission.maxAgents);
  if (late !== -1) {
    const error = t().plan.waitsForNew(late + 1, mission.maxAgents);
    setMission(fleetId, { error });
    notify(fleetId, t().lines.couldNotStart(error));
    return;
  }
  // The router was turned on after the plan (its switch, or Settings): without levels, every agent would get its CLI's default model.
  const required = levelsRequired(fleetId, mission);
  const unrated = required ? mission.plan.filter((task) => !task.level) : [];
  if (unrated.length > 0) {
    const error = t().lines.levelsMissing(unrated.map((task) => task.title));
    setMission(fleetId, { error });
    notify(fleetId, t().lines.proposeLevels(error));
    return;
  }
  // A task queued with no level, before the router was on, takes medium as add_tasks gives it now: proposing the plan
  // again would not rate it, so refusing would loop.
  const levelless = required ? (mission.queue ?? []).filter((task) => !task.level) : [];
  setMission(fleetId, { state: "lancement", error: undefined, ...(levelless.length > 0 ? { queue: (mission.queue ?? []).map((task) => (task.level ? task : { ...task, level: "moyen" as const })) } : {}) });
  if (levelless.length > 0) {
    const medium = levelModel(teamAgent(fleetId), "moyen", modelRouterStore.getState().levels);
    notify(fleetId, t().lines.queuedMedium(levelless.map((task) => task.title), medium && modelLabel(medium)));
  }
  // Max agents start at once; the plan's other sub-tasks wait at the head of the queue for a seat, those that wait for
  // other tasks (`waitsFor`) whatever their place: they are handed out as those are done.
  const plan = mission.plan.filter((task) => !task.waitsFor?.length).slice(0, mission.maxAgents);
  const waiting = mission.plan.filter((task) => !plan.includes(task)).map(queuedTask);
  const restarts: Restarts = new Map();
  // Every agent of the team starts in a new worktree: what it is told of its dependencies is read while the team forms.
  const lookingUp = newWorktreeLine(fleetId, record.workspaceId);
  let team: Team;
  try {
    team = await formTeam(fleetId, record.workspaceId, missionFolder(fleetId) || session.cwd, { ...mission, plan }, restarts);
  } catch (error) {
    setMission(fleetId, { state: "plan", error: errorText(error) });
    notify(fleetId, t().lines.couldNotStart(errorText(error)));
    return;
  }
  // Already read, or nearly: no wait to speak of between the team formed and the team set.
  const setup = await lookingUp;
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
  team.members.forEach((member, i) => void assign(fleetId, member, withTicketNote(fleetId, started, withTeamNote(started, subTaskText(mission.name ?? "", carded[i], member.branch, undefined, setup)), carded[i]), restarts.get(member.nodeId)));
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
  // An amendment the user did not answer goes with it: the waiting tasks it changes are no more.
  setMission(fleetId, { state: "terminee", summary, ...(ui ? { summaryUi: ui } : {}), endedAt: Date.now(), amendment: undefined });
  // What it kept in memory goes with it: no merge starts in a mission no longer running (`fusionner`, the queue), and
  // what its runner was told is of no next mission. Imported late: the queue imports this module.
  if (mission.worktree) merging.delete(mission.worktree);
  void import("./queue").then(({ forgetTold }) => forgetTold(fleetId)).catch(() => undefined);
  // The user hears it, if away (`@/shell/finishAlert`).
  signalFinish({ nodeId: fleetId, state: "done", summary });
  // A linked agent the router routed goes back on its CLI's own model; one it did not route keeps its own, as through its sub-task.
  for (const member of mission.members) {
    if (!member.linked || !mission.project) continue;
    const own = terminalOf(nodesStore.getState().nodes[member.nodeId]);
    void restartIn(member.nodeId, mission.project, member.keptModel ? own?.model : undefined);
  }
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

/** Whether a mission worktree still has its line of merges kept. */
export const mergeLineKept = (worktree: string) => merging.has(worktree);

/** A git job in a mission worktree, in turn with its merges: a land's merge of the user's branch (`./land.ts`) too. */
export function oneMergeAtATime<T>(worktree: string, merge: () => Promise<T>): Promise<T> {
  const turn = (merging.get(worktree) ?? Promise.resolve()).then(merge, merge);
  merging.set(worktree, turn.catch(() => undefined));
  return turn;
}

/**
 * Squashes one member's branch into the mission's, one commit named after its sub-task (`squashMessage`): what to say
 * of it, and whether its branch is in. Only what came after its last merge is taken (`squashed`, read when its turn
 * comes: a merge queued before it may have taken some in).
 */
export function mergeMember(fleetId: string, worktree: string, member: Member, probe?: Probe): Promise<{ line: string; merged: boolean; uncommitted: boolean; quiet: boolean }> {
  const m = t().merge;
  const current = () => missionOf(nodesStore.getState().nodes[fleetId])?.members.find((other) => other.nodeId === member.nodeId);
  return oneMergeAtATime(worktree, async () => {
    try {
      const before = current();
      const since = before?.branch === member.branch ? before.squashed : undefined;
      // Its branch is where its last merge left it (`probe`, read with the other agents' at once): what the merge would
      // say without a git call of its own, as `merge_agent` does once it has read the head (`since == head`).
      const { merge, uncommitted, unsigned, head } =
        probe && since !== undefined && probe.head === since
          ? { merge: { kind: "empty" } as const, uncommitted: probe.uncommitted, unsigned: false, head: probe.head }
          : await missionMerge(worktree, member.worktree, member.branch, squashMessage(member), since);
      const note = (uncommitted ? m.uncommitted : "") + (unsigned ? m.unsigned : "");
      if (merge.kind === "conflict") {
        // Its branch waits for its fix: no merge retries it by itself until it reports again (`conflictPending`).
        const now = current();
        if (now?.branch === member.branch && now.report) updateMember(fleetId, member.nodeId, { conflictAt: now.report.at });
        return { line: m.conflict(member.name, conflictFiles(merge.files), note), merged: false, uncommitted, quiet: false };
      }
      const said = merge.kind === "merged" ? m.merged : member.merged ? m.already : m.empty;
      // What its branch holds up to `head` is in, whatever task it is on now; it may have taken another meanwhile,
      // and that one is not merged.
      const now = current();
      let closes = false;
      let again = false;
      if (now?.branch === member.branch) {
        const same = now.task === member.task && now.report?.at === member.report?.at;
        updateMember(fleetId, member.nodeId, { ...(head ? { squashed: head } : {}), ...(same ? { merged: true } : {}), conflictAt: undefined });
        // Its work is in the mission's branch: its card, "Reported, not merged" since its report, goes to Done.
        if (same) void finishMissionCard(fleetId, missionOf(nodesStore.getState().nodes[fleetId])?.plan, now.task).catch(() => undefined);
        // Its work all in, nothing left uncommitted: an agent made for the mission cleans up after itself.
        closes = same && !uncommitted && head !== "" && closesAfterMerge(now);
        // A merge of this head left it open, and its runner heard why (`leftOpen`), or its cleanup is under way: no news.
        again = closes && (now.leftOpen?.head === head || closing.get(member.nodeId) === head);
      }
      // Outside the merge queue: its wait for the agent's exit holds no other merge. One under way is not started twice.
      if (closes && closing.get(member.nodeId) !== head) void cleanUpAfterMerge(fleetId, member.nodeId, head);
      // Merged before and nothing came since, nothing to say of it: `merge` counts such agents, it does not name them.
      const quiet = said === m.already && note === "" && (!closes || again);
      return { line: m.line(member.name, said, `${note}${closes && !again ? m.closes : ""}`), merged: true, uncommitted, quiet };
    } catch (error) {
      return { line: m.failed(member.name, shortError(errorText(error))), merged: false, uncommitted: false, quiet: false };
    }
  });
}

/** The conflicting files a merge names, and how many more: a squash of a big branch may conflict in hundreds. */
const MAX_CONFLICT_FILES = 8;
const conflictFiles = (files: readonly string[]) => files.slice(0, MAX_CONFLICT_FILES).join(", ") + (files.length > MAX_CONFLICT_FILES ? t().merge.moreFiles(files.length - MAX_CONFLICT_FILES) : "");
/** What git said of a merge that failed, cut where it starts to be a log: `merge` answers a line per agent. */
const MAX_ERROR_CHARS = 400;
const shortError = (text: string) => (text.length > MAX_ERROR_CHARS ? `${cutWhole(text, MAX_ERROR_CHARS)}…` : text);

/**
 * A merged agent closes, with its worktree and branch, when it is one made for the mission whose report is done:
 * a linked agent goes back to the user's project at the mission's end, a blocked or failed one waits to be looked at.
 * With "Stop finished agents" off in Settings, nothing closes mid-mission: the mission's cleanup does it all.
 */
function closesAfterMerge(member: Member): boolean {
  return subagentSettingsStore.getState().stopFinished && !member.linked && member.report?.status === "termine" && !member.cleanedUp;
}

/**
 * How long the cleanup waits for the merge queue to let an agent go (`moving`), and for the turn it reported in to end
 * (`atWork`), past which it stays open: a later merge tries again, else its worktree goes with the mission's cleanup.
 */
const MOVING_WAIT_MS = 60_000;
const MOVING_POLL_MS = 250;

/** The agents whose cleanup after a merge is under way, by node, with the head it took in: a merge meanwhile starts no second one. */
const closing = new Map<string, string>();

async function cleanUpAfterMerge(fleetId: string, nodeId: string, head: string) {
  closing.set(nodeId, head);
  try {
    await closeAfterMerge(fleetId, nodeId, head);
  } finally {
    if (closing.get(nodeId) === head) closing.delete(nodeId);
  }
}

/**
 * Once its work is squashed in (`head`), an agent made for the mission cleans up after itself: it stops with its own
 * sub-agents, which share its folder, and once they exited (their process trees hold the worktree), its worktree and
 * branch go (`missionRemoveAgent`, never forced). Only then do their nodes leave the canvas; its report stays on its
 * card and in the panel. Not while the merge queue moves it on, a sub-task is handed to it, one of its sub-agents is
 * at work, the user took its terminal over or it is at work itself a minute on: it stays open, and its runner hears
 * why, once for this head and reason (`leftOpen`); every merge takes the merged agents again, and tries again without
 * a word. What git refuses stays, and its Manager is told which and why. One at a time per agent (`cleanUpAfterMerge`).
 */
async function closeAfterMerge(fleetId: string, nodeId: string, head: string) {
  // Its Manager merges it at its report, while it still ends the turn it reported in: that turn is no new work.
  for (let waited = 0; (moving.has(nodeId) || atWork(nodeId)) && waited < MOVING_WAIT_MS; waited += MOVING_POLL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MOVING_POLL_MS));
  }
  const record = nodesStore.getState().nodes[fleetId];
  const mission = missionOf(record);
  const member = mission?.members.find((m) => m.nodeId === nodeId);
  // Read again: anything may have changed while the queue held it.
  if (!record || mission?.state !== "en_cours" || !mission.project || !mission.slug || !member) return;
  // Its task handed to another meanwhile: its branch is the successor's to take in.
  if (!member.merged || member.handedTo || member.squashed !== head || !closesAfterMerge(member)) return;
  const m = t().merge;
  const runner = missionRunner(fleetId);
  const handed = moving.has(nodeId) || handingOver.has(nodeId) || member.brief !== undefined;
  // Nor while it is at work again (a message reached it since its report) or waiting for an answer: closed, it would lose what it is doing.
  const why = handed ? "handed" : hasSpawnedAtWork(nodeId) ? "subAgents" : takenOver(nodeId) ? "user" : atWork(nodeId) ? "atWork" : null;
  if (why) {
    // Each merge takes it again: its runner hears it once per head and reason, never at every merge.
    if (member.leftOpen?.head !== head || member.leftOpen.why !== why) {
      updateMember(fleetId, nodeId, { leftOpen: { head, why } });
      notify(runner, m.staysOpen(member.name, why));
    }
    return;
  }
  // From now on it takes no other sub-task (`reassign`).
  updateMember(fleetId, nodeId, { cleanedUp: true, leftOpen: undefined });
  const family = [nodeId, ...spawnedUnder(nodeId)];
  // Its stop is no crash to tell its Manager of (`./events`), and its card reads its report.
  nodesStore.getState().update(nodeId, { stoppedFinished: true });
  for (const id of family) stopTerminal(id);
  await Promise.all(family.map((id) => waitForExit(id)));
  // Read again: the wait may have been long. A mission ended, cleaned up or another since (its slug and project, which
  // name the worktree and branch) leaves them to its own cleanup: this one's names may be another mission's by now.
  const now = missionOf(nodesStore.getState().nodes[fleetId]);
  if (now?.state !== "en_cours" || now.slug !== mission.slug || now.project !== mission.project) return;
  try {
    // git named a worktree taken over after the agent that made it (`worktreeOf`).
    const { kept, saved = [], moved = [] } = await missionRemoveAgent(mission.project, mission.slug, { name: member.worktreeOf ?? member.name, squashed: head });
    // A branch's name starts with `dummyplane/`: anything else kept is its worktree, which its nodes stand for.
    if (!kept.some((what) => !what.startsWith("dummyplane/"))) removeTeam(fleetId, record.workspaceId, undefined, family);
    // What it left uncommitted was committed on its branch, and what nothing makes again of its ignored files moved aside: said once, with where.
    const aside = saved.length > 0 || moved.length > 0 ? m.setAside(member.name, saved, moved) : "";
    if (kept.length > 0 || aside) notify(runner, `${kept.length > 0 ? m.kept(member.name, kept) : ""}${kept.length > 0 && aside ? " " : ""}${aside}`);
  } catch (error) {
    notify(runner, m.kept(member.name, [errorText(error)]));
  }
}

/**
 * What each agent merged before holds now (`missionProbe`), read all at once: `merge` takes every agent that reported
 * done, and most were in already, each costing the status of its worktree (a second, with its dependencies) when they
 * were merged one after another: 2 to 5.7 s a call in the log of 10 to 17 November, growing with the roster. An agent
 * whose branch is where its last merge left it needs no merge: `mergeMember` answers for it from this. A probe that
 * failed says nothing: every agent then goes through its own merge, as before.
 */
async function probeMerged(worktree: string, members: readonly Member[]): Promise<Map<string, Probe>> {
  const merged = members.filter((member) => member.squashed !== undefined);
  // One agent alone is no quicker for it: its merge reads the same.
  if (merged.length < 2) return new Map();
  try {
    const probes = await missionProbe(worktree, merged.map((member) => ({ path: member.worktree, branch: member.branch })));
    return new Map(merged.flatMap((member, i) => (probes[i] ? [[member.nodeId, probes[i]] as [string, Probe]] : [])));
  } catch {
    return new Map();
  }
}

/**
 * `merge`: the branches of the agents done since the last merge, and every agent it leaves out, with why: never a
 * silent skip. One fixing its own conflict is merged only once it reports again, or when `named` (the node of the
 * agent `merge` names): a retry while it resolves would undo its work mid-way.
 */
export async function mergeMission(fleetId: string, named?: string): Promise<string> {
  const m = t().merge;
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!mission?.worktree) return m.noBranch;
  // Merged ones too: a merge with nothing new is harmless, and new commits after a merge get in (final review H2).
  // A handed-over agent's branch goes in through its successor's (final review H3). One its merge closed is in, its
  // branch gone with it (`cleanUpAfterMerge`).
  const done = mission.members.filter((m) => m.report?.status === "termine" && !m.handedTo && !m.cleanedUp);
  const fixing = done.filter((member) => member.nodeId !== named && conflictPending(member));
  const ready = done.filter((member) => !fixing.includes(member));
  const left = [...unreported(mission), ...fixing.map(({ name }) => ({ name, how: m.fixing }))];
  if (ready.length === 0) return fixing.length === 0 ? m.nothing(left) : m.notMerged(left);
  const probes = await probeMerged(mission.worktree, ready);
  const results = [];
  for (const member of ready) results.push(await mergeMember(fleetId, mission.worktree, member, probes.get(member.nodeId)));
  // What changed, line by line; the agents already in and unchanged, once, as a count: the answer does not grow with the roster.
  const lines = results.filter((result) => !result.quiet).map((result) => result.line);
  const quiet = results.length - lines.length;
  if (quiet > 0) lines.push(m.quiet(quiet));
  // Never a silent skip: every agent left out, with why.
  if (left.length > 0) lines.push(m.notMerged(left));
  return `${m.header(mission.branch ?? "")}\n${lines.join("\n")}`;
}

/** The cleanups under way, by fleet: a second caller joins the first instead of resetting the mission again behind it. */
const cleaning = new Map<string, Promise<MissionCleanup | string>>();

/** Whether the fleet's mission is being cleaned up now (`./cleanup.ts` answers "already under way"). */
export const cleaningNow = (fleetId: string) => cleaning.has(fleetId);

/** A team terminal the cleanup left open, and why (`./keptOpen`). */
export interface LeftOpen {
  name: string;
  why: OpenReason;
}

/** What a mission's cleanup did: git's answer (`missionCleanup`), and the team terminals it left open. */
export type MissionCleanup = Cleanup & { open: LeftOpen[] };

/**
 * The terminals of the mission's team: the agents made for it, and every sub-agent (spawn_agent) under its Manager or
 * one of its agents, which work in their folders, still on the canvas. Never
 * a linked agent, which went back to the user's project, nor the Manager, which goes with the cleanup.
 */
function teamTerminals(mission: Mission): string[] {
  const linked = new Set(mission.members.filter((m) => m.linked).map((m) => m.nodeId));
  const roots = [...(mission.manager ? [mission.manager] : []), ...mission.members.map((m) => m.nodeId).filter(Boolean)];
  const made = mission.members.filter((m) => !m.linked && m.nodeId).map((m) => m.nodeId);
  const nodes = nodesStore.getState().nodes;
  const ids = [...new Set([...made, ...roots.flatMap((root) => spawnedUnder(root))])];
  // One the user (or the mission's end) took off the canvas is closed already: its record only waits for an undo.
  return ids.filter((id) => id !== mission.manager && !linked.has(id) && terminalOf(nodes[id]) !== undefined && !isClosedNode(id));
}

/**
 * Closes the terminals `ids`, as the merge's own cleanup does (`cleanUpAfterMerge`): stopped, waited for (a process
 * tree holds its folder, and git keeps a worktree it is in), then off the canvas. Their stop is no crash to tell of.
 */
export async function closeTerminals(fleetId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) {
    nodesStore.getState().update(id, { stoppedFinished: true });
    stopTerminal(id);
  }
  await Promise.all(ids.map((id) => waitForExit(id)));
  const workspaceId = nodesStore.getState().nodes[fleetId]?.workspaceId;
  if (workspaceId) removeTeam(fleetId, workspaceId, undefined, ids);
}

/**
 * The team's terminals that finished, stopped or were abandoned close; one that works, waits, is held by a dialog or
 * is still launching stays open (`keptOpen`), and so does the worktree its folder is in: what it is doing is not cut.
 */
async function closeTeam(fleetId: string, mission: Mission): Promise<{ open: (LeftOpen & { cwd?: string })[] }> {
  const nodes = nodesStore.getState().nodes;
  const open: (LeftOpen & { cwd?: string })[] = [];
  const closing: string[] = [];
  for (const id of teamTerminals(mission)) {
    const why = keptOpen(id);
    if (!why) closing.push(id);
    else open.push({ name: nodeNameOf(nodes[id]) || id, why, cwd: terminalOf(nodes[id])?.cwd });
  }
  await closeTerminals(fleetId, closing);
  return { open };
}

/**
 * "Clean up the mission", the panel's button and the Fleet's own cleanup (`./cleanup.ts`) alike, which never loses
 * work: the team's terminals that are done close (`closeTeam`), its Manager with them; then each worktree goes, its
 * uncommitted work committed first on its own branch, and each branch whose work is all on the user's branch is
 * deleted, the others kept, with why (`missionCleanup`); the fleet is free again. The mission stays finished while git
 * works: a call made in that time (a click meanwhile, the Fleet's two calls in one turn) is the one under way, never a
 * second reset that would blank a plan drafted since the first.
 */
export function cleanMission(fleetId: string): Promise<MissionCleanup | string> {
  const under = cleaning.get(fleetId);
  if (under) return under;
  const run = cleanMissionNow(fleetId).finally(() => cleaning.delete(fleetId));
  cleaning.set(fleetId, run);
  return run;
}

async function cleanMissionNow(fleetId: string): Promise<MissionCleanup | string> {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (mission?.state !== "terminee") return t().launch.notFinished;
  // A night's length is that night's absence, no setting for the next mission; the fleet's session goes back to its day.
  const next: Mission = { ...NEW_MISSION, maxAgents: mission.maxAgents };
  if (mission.overnight) void nightSession(fleetId, { linear: false }).catch((error: unknown) => console.warn("fleet session not restored after the night", error));
  // The router's switch is a setting like Max agents: the next mission keeps it as set, on or off, or following Settings.
  if (mission.router !== undefined) next.router = mission.router;
  try {
    const { open } = await closeTeam(fleetId, mission);
    // Its Manager goes with it; its board stays, still the Fleet's: the next mission runs on it.
    removeManager(fleetId);
    const why = messages(missionMessages).openWhy;
    const held = open.flatMap(({ name, why: reason, cwd }) => (cwd ? [{ path: cwd, why: `${name} left open: ${why[reason]}` }] : []));
    const left = open.map(({ name, why: reason }) => ({ name, why: reason }));
    const done = mission.project && mission.slug ? await missionCleanup(mission.project, mission.slug, worktreeOwners(mission), mission.base, held) : { removed: [], kept: [] };
    return { ...done, open: left };
  } catch (error) {
    return errorText(error);
  } finally {
    // Freed even when git fails (project moved, worktrees removed by hand): never stuck "finished" (final review H2).
    nodesStore.getState().update(fleetId, { mission: next });
  }
}

/**
 * A new agent made for `mission` (a reassign's, the queue's) that ended while it was created: stopped and off the
 * canvas, as the end took the agents made for it, never a member, its sub-task never typed, so no longer launching
 * (it would count as at work). Its worktree goes with the mission's cleanup, as a member's; a mission cleaned up
 * meanwhile, or whose cleanup is under way (its list made), takes it back itself, never forced: once its terminal
 * exited (`waitForExit`, bounded), as its process tree holds the worktree as its folder until then and git would keep
 * it. What the discard leaves in place, or why it failed, goes to the log.
 */
export function leftBehind(fleetId: string, mission: Mission, made: Member) {
  stopTerminal(made.nodeId);
  markLaunching(made.nodeId, false);
  const workspaceId = nodesStore.getState().nodes[fleetId]?.workspaceId;
  if (workspaceId) removeTeam(fleetId, workspaceId, undefined, [made.nodeId]);
  const ended = missionOf(nodesStore.getState().nodes[fleetId]);
  if (ended?.state === "terminee" && ended.slug === mission.slug && !cleaning.has(fleetId)) {
    setMission(fleetId, { strays: [...(ended.strays ?? []), made.name] });
    return;
  }
  const project = mission.project;
  // A worktree it took over holds the previous agent's work: it goes with the mission's cleanup, under that agent's name.
  if (!project || made.worktreeOf) return;
  void waitForExit(made.nodeId)
    .then(() => missionDiscard(project, [{ slug: made.name, branch: made.branch, path: made.worktree }]))
    .then(({ kept }) => {
      if (kept.length > 0) console.warn(`worktree of ${made.name}, left behind by the mission's end, not discarded`, kept);
    })
    .catch((error: unknown) => console.warn(`worktree of ${made.name}, left behind by the mission's end, not discarded`, error));
}

/**
 * A new agent for a sub-task (handed over, or from the queue): its worktree,
 * cut from the mission's branch, its terminal in the sub-task's group or the
 * mission's, started now. A member of the mission from then on, so that
 * `endMission` closes it and `cleanMission` removes its worktree. Taking over
 * from a member (`takeOver`), it opens in that member's worktree, on its branch,
 * where its work is, committed or not, instead of a new one.
 */
export async function newMember(fleetId: string, workspaceId: string, mission: Mission, task: SubTask, takeOver?: Member): Promise<Member | string> {
  if (!mission.project || !mission.slug) return t().launch.noFolder;
  const { frames } = workspaceCanvas(workspaceId);
  // The sub-task's group if it still exists, else the mission's.
  const chosen = frames.find((f) => f.id === task.group?.id);
  const frame = chosen ?? frames.find((f) => f.id === mission.frameId);
  // Under a Manager, named as its team is: from the group they stand in.
  const team = mission.manager && !chosen ? groupOf(frames, mission.manager) : null;
  const pantheon = (team ?? frame)?.group?.pantheon ?? pantheonForNewGroup(workspaceId);
  // A closed member's name is free on the canvas, not in git: its branch is still there.
  const name = nextName(pantheon, [...namesInWorkspace(workspaceId), ...mission.members.map((m) => m.name)]);
  // git named the worktree and branch after the agent that made them: its name goes along to whoever takes them over.
  const worktreeOf = takeOver ? (takeOver.worktreeOf ?? takeOver.name) : undefined;
  let tree: Worktree;
  if (takeOver && worktreeOf) tree = { slug: worktreeOf, branch: takeOver.branch, path: takeOver.worktree };
  else {
    try {
      tree = await missionAddAgent(mission.project, mission.slug, name);
    } catch (error) {
      return errorText(error);
    }
  }
  const model = teamModel(fleetId, mission, task);
  let nodeId: string | null = null;
  if (mission.manager && !chosen) {
    // Under its Manager: one more of its sub-agents, in its tree. It arrives on its own, never taking the view nor the keyboard.
    const payload = agentPayload(teamAgent(fleetId), name, tree.path, model, mission.permission, fleetExtensions(fleetId));
    nodeId = await addTeamMember(workspaceId, mission.manager, payload, task.title, quietly("mission"));
    if (nodeId) reflowTeam(workspaceId, mission.manager);
  } else if (frame) {
    // A queue's or a handover's agent arrives on its own, whenever a seat frees up: it never takes the view nor the keyboard.
    nodeId = await addTerminal(workspaceId, agentPayload(teamAgent(fleetId), name, tree.path, model, mission.permission, fleetExtensions(fleetId)), frameCenter(frame), frame.id, quietly("mission"));
  } else {
    const group = await launchGroup(
      { name: `Mission ${mission.name}`, role: "general", agents: [teamAgent(fleetId)] },
      defaultLaunchOptions(),
      besideFleet(fleetId, workspaceId, 1),
      { pantheon, names: [name], cwds: [tree.path], models: [model], permission: mission.permission, extensions: fleetExtensions(fleetId), workspaceId },
      quietly("mission"),
    );
    if (group) {
      nodeId = group.nodeIds[0];
      linkFleet(fleetId, group.frameId);
      setMission(fleetId, { frameId: group.frameId });
    }
  }
  if (!nodeId) {
    // One taken over holds the previous agent's work: it stays.
    if (!worktreeOf) await missionDiscard(mission.project, [tree]).catch(() => undefined);
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
    ...(worktreeOf ? { worktreeOf } : {}),
    // What a merge of that branch took in already: the next one takes only what came after (`mergeMember`).
    ...(takeOver?.squashed ? { squashed: takeOver.squashed } : {}),
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
  const open = reassignable(mission);
  const from = open.find((m) => m.nodeId === fromNodeId);
  const task = mission.plan?.find((s) => s.title === from?.task);
  if (!from || !task) {
    // The titles it takes, as `reassign` names them, so that the call can be made again right.
    const titles = open.map((m) => m.task);
    const holder = mission.members.find((m) => m.nodeId === fromNodeId);
    // A task `next_task` abandoned stays with its agent's report: nobody takes it over.
    return holder?.abandoned ? r.abandoned(holder.task, titles) : t().fleet.noSubtask(holder?.task ?? "", titles);
  }
  let to: Member;
  // A finished member dummyPlane stopped to free its memory starts again on its conversation for the sub-task (`@/agents/finishedStop`).
  let asleep = false;
  // A new agent in the holder's worktree, on its branch: its work, committed or not, is there to go on with.
  let inPlace = false;
  // What its agent is told of the dependencies: only one in a worktree made new for it has none installed.
  let setup = "";
  if (sameName(target, NEW_AGENT)) {
    if (!canvasKnown(fleetId)) return r.hidden;
    inPlace = takesOver(from);
    const lookingUp = inPlace ? undefined : newWorktreeLine(fleetId, record.workspaceId);
    // Max agents caps the agents at work, not the team: those who reported or handed over count no more. From an
    // agent at work, the new one takes its seat: only from one holding none would it be one more.
    const seated = hasSeat(mission, from.nodeId);
    if (!seated && activeCount(fleetId, mission) >= mission.maxAgents) return r.newTeamFull(task.title, seatsOf(fleetId, mission));
    // Its seat is held while it is created, in turn with the queue's new agents: no name nor seat twice. The one it
    // replaces gives it its own: counted once, not twice, so a report meanwhile frees a seat the queue can fill.
    holdSeat(fleetId, `reassign:${task.title}`);
    if (seated) handingOver.add(from.nodeId);
    let made: Member | string;
    try {
      made = await oneAtATime(fleetId, () => newMember(fleetId, record.workspaceId, missionOf(nodesStore.getState().nodes[fleetId]) ?? mission, task, inPlace ? from : undefined));
      // Still holding its seat: between the seat freed and the member counted nothing may wait (the queue would start one agent too many).
      if (typeof made !== "string") setup = (await lookingUp) ?? "";
    } finally {
      freeSeat(fleetId, `reassign:${task.title}`);
      handingOver.delete(from.nodeId);
    }
    if (typeof made === "string") return made;
    // Stopped or ended meanwhile, as in the queue: its team is gone, this one would sit idle in its worktree, and a
    // mission no longer running takes no member, nor pauses its linked agent gone back to the project.
    if (missionOf(nodesStore.getState().nodes[fleetId])?.state !== "en_cours") {
      leftBehind(fleetId, mission, made);
      return r.noMission;
    }
    to = made;
  } else {
    const found = mission.members.find((m) => sameName(m.name, target) && m.nodeId !== from.nodeId && !m.handedTo);
    // The agents it could name, so that the call can be made again right (an agent that has reported is the only one to take it).
    if (!found) return r.notOther(target, mission.members.filter((m) => m.nodeId !== from.nodeId && !m.handedTo && m.report).map((m) => m.name));
    if (!found.report) return r.notDone(found.name);
    // Its merge closed it, its worktree gone (`cleanUpAfterMerge`).
    if (found.cleanedUp) return r.cleanedUp(found.name);
    asleep = wakingUp(found.nodeId) !== undefined || wakeable(found.nodeId);
    // Any other stopped session would only say "did not start" a minute later.
    if (!isRunning(found.nodeId) && !asleep) return r.targetStopped(found.name);
    // Its entry takes the new sub-task: its finished work must be in the mission's branch first (final review H3).
    const finished = found.report.status === "termine";
    // An agent its merge will close takes no other sub-task: its next one goes to a new agent.
    if (finished && !found.merged) return closesAfterMerge(found) ? r.notMergedCloses(found.name, found.task) : r.notMerged(found.name, found.task);
    // Back to work, it takes a seat: one more, unless it or the agent it takes over from holds one now, which it frees.
    const addsSeat = !hasSeat(mission, found.nodeId) && !hasSeat(mission, from.nodeId);
    if (addsSeat && activeCount(fleetId, mission) >= mission.maxAgents) return r.targetTeamFull(found.name, task.title, seatsOf(fleetId, mission));
    to = {
      ...found,
      task: task.title,
      budgetMin: task.budgetMin,
      extraMin: undefined,
      overdue: undefined,
      nearTold: undefined,
      pausedMs: undefined,
      report: undefined,
      sentAt: undefined,
      // Its new sub-task's text is `assign`'s to record: none of an older one may be typed while it is handed over.
      brief: undefined,
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
  if (inPlace) {
    // Its folder is its successor's now: its shell goes, and "Resume all" leaves it stopped (`@/agents/resumable`).
    nodesStore.getState().update(from.nodeId, { stoppedFinished: true });
    stopTerminal(from.nodeId);
  }
  // The previous agent stops: its sub-task is another's now (final review H3).
  await pauseAgents([from.nodeId]).catch(() => 0);
  // One taken over is at its shell at most, being stopped: a line would run there as a command.
  if (!inPlace && isRunning(from.nodeId)) {
    const runner = missionRunner(fleetId);
    void ptySendText(from.nodeId, t().lines.handedAway(from.task, to.name)).then(
      () => talk(runner, from.nodeId),
      () => undefined,
    );
  }
  // Started again once it holds the sub-task: its relaunch's start finds it waiting to be typed, not a stopped member to tell of.
  const restarted = asleep ? (wakingUp(to.nodeId) ?? wakeFinished(to.nodeId)).then(() => undefined) : undefined;
  void assign(fleetId, to, withTicketNote(fleetId, mission, withTeamNote(mission, subTaskText(mission.name ?? "", task, to.branch, handoverText(from, inPlace), setup)), task), restarted);
  return { name: to.name };
}

/**
 * Whether a new agent takes over `from`'s worktree and branch: its agent stopped (dummyPlane restarted, its terminal
 * died or was stopped) before it finished, its work still in its worktree. One at work keeps its own, and its
 * successor starts from the mission's branch; one finished or merged has nothing left there to go on with.
 */
function takesOver(from: Member): boolean {
  return agentState(from.nodeId) === "arrêté" && !isRestarting(from.nodeId) && from.report?.status !== "termine" && !from.merged && !from.cleanedUp;
}
