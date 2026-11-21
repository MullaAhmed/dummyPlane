import { talk } from "@/agents/talkWires";
import { pauseAgents } from "@/agents/broadcast";
import { wakeable, wakeFinished, wakingUp } from "@/agents/finishedStop";
import { setRemoteControl } from "@/agents/remoteControl";
import { messages } from "@/i18n";
import { ptySendText } from "@/ipc/pty";
import { hasUnsentInput } from "@/nodes/terminal/draft";
import { missionFolder } from "@/mission/folder";
import { closeTerminals, deliveryPending, endMission, launchMission, mergeMission, reassignTask } from "@/mission/launch";
import { missionMessages } from "@/mission/messages";
import { levelsRequired, subTaskModel, teamAgent } from "@/mission/teamModel";
import { BUDGET_WARN_AT, budgetOf, conflictPending, memberTime, NEW_AGENT, nightMin, oneLine, proposedPlan, proposedTasks, reassignable, remainingGlobal, sameName, spentMin, subTasksNamedBy, type Member, type Mission, type QueuedTask, type SubTask } from "@/mission/mission";
import type { StepState } from "@/nodes/steps";
import { activeCount, relaunchTakesSeat, seatsOf } from "@/mission/active";
import { stopMission } from "@/mission/stop";
import { duplicateWork } from "@/mission/activeWork";
import { cleanUpFinished } from "@/mission/cleanup";
import { askLeftovers } from "@/mission/leftovers";
import { askToLand } from "@/mission/land";
import { changesOf, inFlightTitles, proposedAmendment, titlesOf } from "@/mission/amendment";
import { resolvedWaits, startedTitles, waitState } from "@/mission/waits";
import { giveNext, pumpQueue, settleQueue } from "@/mission/queue";
import { todoColumnOf } from "@/kanban/missionLink";
import { moveCard as movedCard } from "@/kanban/board";
import { fleetNameOf, managerNameOf, reopenManager } from "@/mission/manager";
import { restoreReopened } from "@/mission/restore";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { levelModel, modelLabel, type Level } from "@/mission/router";
import { missionRouterOn } from "@/mission/routerState";
import { readTickets } from "@/mission/tickets";
import { addTaskCards, linkedBoards, missionBoard, moveMissionCard } from "@/kanban/fleetBoards";
import { isClosedNode } from "@/agents/closedNode";
import { busyNow, keptOpen } from "@/mission/keptOpen";
import { agentGroup, agentState, linkedTeamAgents, linkedGroups, managedFleet, missionOf, canvasKnown, isFleetClosed, setMission, spawnedUnder, updateMember } from "@/mission/store";
import { notify } from "@/mission/events";
import { KANBAN_PRIORITIES, type KanbanPriority } from "@/nodes/types";
import { sceneAccess } from "@/agents/sceneAccess";
import { relaunchMode } from "@/nodes/terminal/launch";
import { relaunchTerminal, terminalText } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { isManagerNode, nodeNameOf, nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { isRestarting, isRunning, statusOf } from "@/store/terminalStatus";
import { splitGenerated } from "@/openui/detect";
import { cutWhole } from "@/lib/cut";
import { recordMemberReport, refused, said, type ToolResult } from "./agentTools";
import { agentMessages } from "./messages";
import { boardsAnswer } from "./boardAnswer";
import { DETAIL_CHARS, fitted, lined, LISTED_CHARS, shortened, shortenedKeepingLines } from "./compact";
import { outAgent, outLevel, outMission, outReport, outStep } from "./protocol";
import { stateMinutes, stateWord } from "./teamState";

const NO_ARGS = { type: "object", properties: {} } as const;
const t = () => messages(agentMessages);

/** Every mission tool, in the order tools/list gives them; each role takes its own (`fleetTools`, `managerTools`). */
function missionToolSpecs(manager: boolean) {
  const d = t().tools;
  return [
    { name: "mission", description: d.mission, inputSchema: { type: "object", properties: { subtask: { type: "string", description: d.missionSubtask } } } },
    {
      name: "propose_plan",
      description: d.proposePlan,
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 60, description: d.planName },
          task: { type: "string", description: d.planTask },
          subtasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string", maxLength: 60 },
                brief: { type: "string" },
                agent: { type: "string", description: d.planAgent },
                group: { type: "string", description: d.planGroup },
                budget_min: { type: "integer", minimum: 1 },
                level: { type: "string", enum: ["low", "medium", "high", "extreme"], description: d.planLevel },
                card: { type: "string", description: d.planCard },
                waits_for: { type: "array", items: { type: "string" }, description: d.planWaitsFor },
              },
              required: ["title", "brief", "agent", "budget_min"],
            },
          },
          drop: { type: "array", items: { type: "string" }, description: d.planDrop },
        },
        // The first plan needs a name and sub-tasks, an amendment may only drop: the call checks them.
        required: ["task"],
      },
    },
    {
      name: "add_tasks",
      description: d.addTasks,
      inputSchema: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                title: { type: "string", maxLength: 60 },
                brief: { type: "string" },
                budget_min: { type: "integer", minimum: 1 },
                level: { type: "string", enum: ["low", "medium", "high", "extreme"], description: d.queueLevel },
                group: { type: "string", description: d.taskGroup },
                card: { type: "string", description: d.taskCard },
                waits_for: { type: "array", items: { type: "string" }, description: d.taskWaitsFor },
              },
              required: ["title", "brief", "budget_min"],
            },
          },
        },
        required: ["tasks"],
      },
    },
    { name: "queue", description: d.queue, inputSchema: { type: "object", properties: { task: { type: "string", description: d.queueTask } } } },
    {
      name: "prioritize",
      description: d.prioritize,
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: d.prioritizeTask },
          position: { type: "integer", minimum: 1, description: d.prioritizePosition },
          priority: { type: "string", enum: [...KANBAN_PRIORITIES], description: d.prioritizePriority },
        },
        required: ["task"],
      },
    },
    { name: "next_task", description: d.nextTask, inputSchema: { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] } },
    { name: "tickets", description: d.tickets, inputSchema: NO_ARGS },
    { name: "board", description: manager ? d.managerBoard : d.board, inputSchema: { type: "object", properties: { card: { type: "string", description: d.boardCard } } } },
    {
      name: "move_card",
      description: d.moveCard,
      inputSchema: {
        type: "object",
        properties: { card: { type: "string", description: d.moveCardCard }, column: { type: "string", description: d.moveCardColumn } },
        required: ["card", "column"],
      },
    },
    { name: "team", description: d.team, inputSchema: { type: "object", properties: { agent: { type: "string", description: d.teamAgent } } } },
    {
      name: "read_output",
      description: d.readOutput,
      inputSchema: { type: "object", properties: { agent: { type: "string" }, lines: { type: "integer", minimum: 1, maximum: 200 } }, required: ["agent"] },
    },
    {
      name: "write",
      description: d.write,
      inputSchema: { type: "object", properties: { agent: { type: "string" }, text: { type: "string" } }, required: ["agent", "text"] },
    },
    {
      name: "extend",
      description: d.extend,
      inputSchema: { type: "object", properties: { agent: { type: "string" }, minutes: { type: "integer", minimum: 1 } }, required: ["agent", "minutes"] },
    },
    { name: "interrupt", description: d.interrupt, inputSchema: { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] } },
    // The Fleet's brings back its Manager, by itself: agent only for a mission run the old way.
    manager
      ? { name: "relaunch", description: d.relaunch, inputSchema: { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] } }
      : { name: "relaunch", description: d.fleetRelaunch, inputSchema: { type: "object", properties: { agent: { type: "string" } } } },
    {
      name: "reassign",
      description: d.reassign,
      inputSchema: {
        type: "object",
        properties: { subtask: { type: "string", description: d.reassignSubtask }, agent: { type: "string", description: d.reassignAgent } },
        required: ["subtask", "agent"],
      },
    },
    {
      name: "merge",
      description: d.merge,
      inputSchema: { type: "object", properties: { agent: { type: "string", description: d.mergeAgent }, summary: { type: "string", description: d.mergeSummary } } },
    },
    {
      name: "finish",
      description: manager ? d.managerFinish : d.finish,
      inputSchema: { type: "object", properties: { summary: { type: "string", description: d.finishSummary }, check: { type: "array", items: { type: "string" }, description: d.finishCheck } }, required: ["summary"] },
    },
    { name: "need_user", description: d.needUser, inputSchema: { type: "object", properties: { reason: { type: "string", description: d.needUserReason } }, required: ["reason"] } },
    { name: "message_manager", description: d.messageManager, inputSchema: { type: "object", properties: { text: { type: "string", description: d.messageText } }, required: ["text"] } },
    { name: "message_fleet", description: d.messageFleet, inputSchema: { type: "object", properties: { text: { type: "string", description: d.messageText } }, required: ["text"] } },
    { name: "stop_mission", description: d.stopMission, inputSchema: { type: "object", properties: { reason: { type: "string", description: d.stopReason } }, required: ["reason"] } },
    { name: "land", description: d.land, inputSchema: NO_ARGS },
    { name: "close_agent", description: d.closeAgent, inputSchema: { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] } },
    { name: "clean_up_mission", description: d.cleanUpMission, inputSchema: NO_ARGS },
    { name: "clean_up_leftovers", description: d.cleanUpLeftovers, inputSchema: NO_ARGS },
    {
      name: "remote_control",
      description: d.remoteControl,
      inputSchema: {
        type: "object",
        properties: { on: { type: "boolean" }, agents: { type: "array", minItems: 1, items: { type: "string" }, description: d.remoteAgents } },
        required: ["on", "agents"],
      },
    },
  ];
}

/**
 * The Fleet's tools while it plans and babysits its board, by English name. message_manager is listed whatever its
 * mission's state: tools/list is read once, when the Fleet's session starts, long before a go-ahead makes its Manager.
 */
export const FLEET_TOOLS: readonly string[] = ["mission", "propose_plan", "add_tasks", "queue", "prioritize", "tickets", "board", "team", "message_manager", "relaunch", "stop_mission", "land", "clean_up_mission", "clean_up_leftovers", "remote_control"];
/** The team's tools, the Fleet's only for a mission launched before Managers existed: it runs it to its end the old way. */
export const LEGACY_TOOLS: readonly string[] = ["next_task", "read_output", "write", "extend", "interrupt", "reassign", "merge", "finish"];
/** A mission's Manager's tools: it runs the board's cards with the team, and answers its Fleet with message_fleet. */
export const MANAGER_TOOLS: readonly string[] = ["mission", "add_tasks", "queue", "next_task", "board", "move_card", "team", "read_output", "write", "extend", "interrupt", "relaunch", "reassign", "merge", "land", "close_agent", "finish", "need_user", "message_fleet"];

/** Whether a Fleet's mission runs the old way: under way, with no Manager. Only then does the Fleet list the team's tools. */
export const runsTheOldWay = (mission: Mission | undefined) => (mission?.state === "en_cours" || mission?.state === "lancement") && !mission.manager;

/**
 * The Fleet's tools, named in English, described in the interface's language:
 * `legacy` adds the team's for a mission run the old way; without Claude, no Remote Control.
 */
export function fleetTools({ legacy = false, claude = true }: { legacy?: boolean; claude?: boolean } = {}) {
  const names = new Set([...FLEET_TOOLS, ...(legacy ? LEGACY_TOOLS : [])]);
  if (!claude) names.delete("remote_control");
  return missionToolSpecs(false).filter((tool) => names.has(tool.name));
}

/** A Manager's tools, the same table read for its role. */
export function managerTools() {
  const names = new Set(MANAGER_TOOLS);
  return missionToolSpecs(true).filter((tool) => names.has(tool.name));
}

/** Internal names of the mission's tools (`./protocol.ts`): no plain agent calls them. */
export const FLEET_ONLY = new Set([
  "mission",
  "proposer_plan",
  "add_tasks",
  "queue",
  "next_task",
  "tickets",
  "board",
  "equipe",
  "lire_sortie",
  "ecrire",
  "prolonger",
  "interrompre",
  "relaunch",
  "reattribuer",
  "fusionner",
  "terminer",
  "remote_control",
  "prioritize",
  "stop_mission",
  "land",
  "clean_up_mission",
  "clean_up_leftovers",
  "close_agent",
  "move_card",
  "need_user",
  "message_manager",
  "message_fleet",
]);

/** Internal names of the Manager's own tools: a Fleet, or an agent, that calls one is told whose it is. */
export const MANAGER_ONLY = new Set(["move_card", "need_user", "message_fleet", "close_agent"]);
/** Internal names of the team's tools the Fleet keeps for a mission run the old way. */
const LEGACY_INTERNAL = new Set(["next_task", "lire_sortie", "ecrire", "prolonger", "interrompre", "relaunch", "reattribuer", "fusionner", "terminer"]);
/** Internal names of the Manager's tools; message_manager is not one of them, the Fleet's alone (`FLEET_ONLY`). */
const MANAGER_INTERNAL = new Set(["mission", "add_tasks", "queue", "next_task", "board", "move_card", "equipe", "lire_sortie", "ecrire", "prolonger", "interrompre", "relaunch", "reattribuer", "fusionner", "land", "close_agent", "terminer", "need_user", "message_fleet"]);

const json = (value: unknown) => said(JSON.stringify(value, null, 2));
const formed = (mission: Mission) => mission.state === "en_cours" || mission.state === "terminee";

function memberNamed(mission: Mission, raw: unknown): Member | string {
  if (!formed(mission)) return t().fleet.notFormed(mission.state);
  const name = typeof raw === "string" ? raw : "";
  // The refusal names the team, so that the next call can name an agent right.
  return mission.members.find((m) => sameName(m.name, name)) ?? t().fleet.notMember(name, mission.members.map((m) => m.name));
}

/** The model a sub-task's agent has, once one holds it; before, the one the go-ahead will give it, a linked agent's included (`subTaskModel`). */
function modelOfSubTask(fleetId: string, mission: Mission, subtask: { title: string; agent: string; level?: Level }): string | null {
  const holder = mission.members.find((m) => !m.handedTo && m.task === subtask.title);
  if (holder) return holder.model ? modelLabel(holder.model) : null;
  const model = subTaskModel(fleetId, mission, subtask);
  return model ? modelLabel(model) : null;
}

/** The mission as a plan or the queue reads its tasks: `router` on where they need a level (`levelsRequired`). */
const asPlanned = (fleetId: string, mission: Mission): Mission => ({ ...mission, router: levelsRequired(fleetId, mission) });

/** A sub-task of the plan, as `mission` lists it: `brief` is the text it is given, whole or cut (`describeMission`). */
function planEntry(fleetId: string, mission: Mission, s: SubTask, brief: string) {
  return {
    title: s.title,
    brief,
    agent: outAgent(s.agent),
    group: s.group?.name ?? null,
    budget_min: s.budgetMin,
    level: s.level ? outLevel(s.level) : null,
    // Once an agent holds the sub-task, its own model counts: reassign may have given it to one that keeps its own.
    model: modelOfSubTask(fleetId, mission, s),
    card: s.card ?? null,
  };
}

/** The sub-task `raw` names: its title, else the start of it when that fits one only. */
function namedTask<T extends { title: string }>(tasks: readonly T[], raw: string): T | undefined {
  const wanted = raw.trim();
  const exact = tasks.find((task) => sameName(task.title, wanted));
  if (exact) return exact;
  const starts = tasks.filter((task) => wanted !== "" && task.title.toLowerCase().startsWith(wanted.toLowerCase()));
  return starts.length === 1 ? starts[0] : undefined;
}

/**
 * `mission`. Whatever the plan's size the answer stays short (`./compact.ts`): the briefs are cut, and `subtask` reads
 * one sub-task whole.
 */
function describeMission(fleetId: string, mission: Mission, args: Record<string, unknown> = {}): ToolResult {
  const f = t().answers;
  const asked = typeof args.subtask === "string" ? args.subtask.trim() : "";
  if (asked) {
    if (!mission.plan) return refused(f.noPlan);
    const found = namedTask(mission.plan, asked);
    if (!found) return refused(f.noSubtask(asked, mission.plan.map((s) => s.title)));
    return said(lined(planEntry(fleetId, mission, found, shortenedKeepingLines(found.brief, DETAIL_CHARS, f.rest))));
  }
  const team = new Set(mission.members.map((m) => m.nodeId));
  const plan = mission.plan?.map((s) => planEntry(fleetId, mission, s, shortened(s.brief, LISTED_CHARS, f.how.mission(s.title)))) ?? null;
  const amendment = describedAmendment(mission);
  return said(fitted(plan?.length ?? 0, (shown) => lined({
    state: outMission(mission.state),
    name: mission.name ?? null,
    task: mission.task === undefined ? null : shortened(mission.task, TASK_CHARS, f.rest),
    runs: mission.manager ? "manager" : "fleet",
    manager: mission.manager ? managerNameOf(fleetId) : null,
    board: mission.board ?? null,
    away_min: nightMin(mission) ?? null,
    max_agents: mission.maxAgents,
    active_agents: mission.state === "en_cours" ? activeCount(fleetId, mission) : null,
    // Its switch when set, else the global setting: on, each sub-task's level picks its agent's model.
    router: missionRouterOn(mission),
    branch: mission.branch ?? null,
    plan: plan && plan.slice(0, shown),
    ...(plan && shown < plan.length ? { plan_left_out: f.left.subtasks(plan.length - shown) } : {}),
    linked_agents: canvasKnown(fleetId)
      ? linkedTeamAgents(fleetId)
          .filter((a) => !team.has(a.nodeId))
          // `router`: its own switch, set: true routes it with the mission's off, false keeps its own model with the mission's on.
          .map((a) => {
            const own = terminalOf(nodesStore.getState().nodes[a.nodeId])?.router;
            return { name: a.name, state: stateWord(a.nodeId), ...agentGroup(a.nodeId), ...(own === undefined ? {} : { router: own }) };
          })
      : null,
    linked_groups: canvasKnown(fleetId) ? linkedGroups(fleetId).map(({ name, speciality }) => ({ name, speciality })) : null,
    linked_agents_note: canvasKnown(fleetId) ? null : t().fleet.hiddenAgents,
    queue_waiting: mission.queue?.length ?? 0,
    amendment,
    left_min: remainingGlobal(mission, Date.now()) ?? null,
    overnight: mission.overnight === true,
    auto_launch: mission.autoLaunch === true,
    elapsed_min: mission.state === "en_cours" && mission.startedAt !== undefined ? Math.floor((Date.now() - mission.startedAt) / 60_000) : null,
    error: mission.error === undefined ? null : shortened(mission.error, TASK_CHARS, f.rest),
  })));
}

/** The user's task, an amendment's and an error in `mission`: a few paragraphs at most, whatever was written. */
const TASK_CHARS = 1_500;

/** The amendment the user has yet to answer, as the Fleet reads it: what it asked, and the titles it adds, edits and drops. */
function describedAmendment(mission: Mission) {
  if (!mission.amendment) return null;
  const { added, edited, dropped } = titlesOf(changesOf(mission.queue ?? [], mission.amendment));
  return { task: shortened(mission.amendment.task, TASK_CHARS, t().answers.rest), add: added, edit: edited, drop: dropped };
}

/** The tasks of a plan or a queue that an agent already works on (`@/mission/duplicateTask`), numbered as the agent gave them. */
function alreadyOnIt(fleetId: string, tasks: readonly { title: string; brief: string; card?: string }[], exclude: readonly (string | undefined)[]) {
  const workspaceId = nodesStore.getState().nodes[fleetId]?.workspaceId;
  return tasks.flatMap((task, i) => {
    const who = duplicateWork(task, workspaceId, exclude);
    return who ? [{ n: i + 1, title: task.title, who }] : [];
  });
}

/**
 * `propose_plan` on a running mission: an amendment to its waiting tasks, which the user approves in the panel as they
 * did the first plan (`@/mission/amendment`). Nothing changes before; a later call replaces the pending one.
 */
function proposeAmendment(fleetId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  const named = Array.isArray(args.sous_taches) && args.sous_taches.some((s) => Boolean((s as Record<string, unknown> | null)?.groupe));
  if (named && !canvasKnown(fleetId)) return refused(t().fleet.hiddenWorkspace);
  const cards = linkedBoards(fleetId).flatMap(({ board }) => Object.keys(board.cards));
  const result = proposedAmendment(args, asPlanned(fleetId, mission), inFlightTitles(fleetId, mission), linkedGroups(fleetId), cards);
  if (typeof result === "string") return refused(result);
  const { amendment, changes } = result;
  // A task an agent is at work on is not queued again, as for add_tasks: only the tasks the amendment adds.
  const already = alreadyOnIt(fleetId, changes.added, [fleetId, mission.manager]);
  if (already.length > 0) return refused(t().fleet.duplicatePlan(already));
  const replaced = mission.amendment !== undefined;
  setMission(fleetId, { amendment });
  const proposed = t().fleet.amendmentProposed(changes.added.length, changes.edited.length, changes.dropped.length);
  return said(replaced ? `${t().fleet.amendmentPending} ${proposed}` : proposed);
}

async function proposePlan(fleetId: string, asked: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  if (asked.state === "lancement") return refused(t().fleet.running);
  if (asked.state === "en_cours") return proposeAmendment(fleetId, asked, args);
  let mission = asked;
  // What the Fleet's cleanup told it, to say with whatever follows: the mission it drafts on is a new one.
  let cleaned = "";
  if (asked.state === "terminee") {
    // The panel's "Clean up the mission", done here unless the mission's work is not over: then the old refusal stands, and the user decides.
    const cleanup = await cleanUpFinished(fleetId, t().fleet.planAgain);
    if (cleanup.cleaned === false) return refused(`${t().fleet.finished} ${cleanup.reason}`);
    // Still under way when a tool must answer: the plan waits for a blank mission, sent again once the result comes.
    if (cleanup.cleaned === "later") return refused(`${cleanup.text} ${t().fleet.planAfterCleanup}`);
    cleaned = cleanup.text;
    // Read again: the mission was reset, its settings (Max agents, the router) kept.
    mission = missionOf(nodesStore.getState().nodes[fleetId]) ?? mission;
  }
  const failed = (text: string) => refused(cleaned ? `${cleaned} ${text}` : text);
  const onCanvas = (s: Record<string, unknown> | null) => !sameName(String(s?.agent ?? ""), NEW_AGENT) || Boolean(s?.groupe);
  const named = Array.isArray(args.sous_taches) && args.sous_taches.some((s) => onCanvas(s as Record<string, unknown> | null));
  if (named && !canvasKnown(fleetId)) return failed(t().fleet.hiddenWorkspace);
  const cards = linkedBoards(fleetId).flatMap(({ board }) => Object.keys(board.cards));
  const linked = linkedTeamAgents(fleetId);
  const drafted = proposedPlan(args, asPlanned(fleetId, mission), linked.map((a) => a.name), linkedGroups(fleetId), cards);
  if (typeof drafted === "string") return failed(drafted);
  // The tasks a sub-task waits for are tasks of this plan, or of the queue: the plan replaces the pending one.
  const waits = resolvedWaits(drafted.plan, mission.queue ?? [], [], (mission.plan ?? []).map((s) => s.title));
  if (typeof waits === "string") return failed(waits);
  // Waiting sub-tasks start from the queue: at the go-ahead some sub-task has to start, or the team would be empty.
  if (waits.every((s) => s.waitsFor?.length)) return failed(t().plan.waitsAll);
  const result = { ...drafted, plan: waits };
  // The linked agents the plan names take their sub-task: whatever they hold is theirs to give up.
  const taking = linked.filter((a) => result.plan.some((s) => sameName(s.agent, a.name))).map((a) => a.nodeId);
  const already = alreadyOnIt(fleetId, result.plan, [fleetId, mission.manager, ...taking]);
  if (already.length > 0) return failed(t().fleet.duplicatePlan(already));
  setMission(fleetId, { state: "plan", ...result, error: undefined });
  // The dialog was the go-ahead: the user has left.
  if (mission.overnight && mission.autoLaunch) {
    void launchMission(fleetId);
    return said(t().fleet.launchingNight);
  }
  const proposed = t().fleet.proposed(result.plan.length, mission.maxAgents);
  return said(cleaned ? `${cleaned} ${proposed}` : proposed);
}

/** `land` (the Fleet, the Manager): asks the user, who alone lands the mission with a click (`@/mission/land`). */
async function land(fleetId: string, callerId: string): Promise<ToolResult> {
  const asked = await askToLand(fleetId, callerId);
  return asked.refused ? refused(asked.text) : said(asked.text);
}

/**
 * `clean_up_mission` (the Fleet): the panel's cleanup of a finished mission, which never loses work (`cleanUpFinished`).
 * It answers in time however long git takes: a cleanup still running is told under way, its result typed later.
 */
async function cleanUpMission(fleetId: string): Promise<ToolResult> {
  const result = await cleanUpFinished(fleetId);
  return result.cleaned === false ? refused(result.reason) : said(result.text);
}

/** `clean_up_leftovers` (the Fleet): asks the user, whose click alone cleans the leftovers up (`@/mission/leftovers`). */
async function cleanUpLeftovers(fleetId: string): Promise<ToolResult> {
  const asked = await askLeftovers(fleetId, fleetId);
  return asked.refused ? refused(asked.text) : said(asked.text);
}

/**
 * How long `tickets` waits for its source: under the 30 s Rust gives a tool, past which the Fleet only hears "dummyPlane
 * is not responding", where a `gh` that gets no answer runs up to its own 60 s limit.
 */
const TICKETS_WAIT_MS = 20_000;

/**
 * `tickets`: dummyPlane reads the source, the fleet may not run commands.
 * It reads in the folder recorded when the team was formed: only before the launch is the live one used.
 */
async function tickets(fleetId: string, mission: Mission): Promise<ToolResult> {
  const project = mission.project || missionFolder(fleetId);
  if (!mission.tickets || !project) return refused(t().fleet.noTickets);
  // Linear's tickets are the fleet's to read, with Linear's own read-only tools.
  if (mission.tickets.kind === "linear") return json({ note: t().fleet.ticketsNote, linear: t().fleet.linearTickets(mission.tickets.team, mission.tickets.label) });
  const reading = readTickets(project, mission.tickets);
  // Read on past the wait, it ends unheard: its failure then is no one's.
  reading.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), TICKETS_WAIT_MS)));
  try {
    const read = await Promise.race([reading, late]);
    if (read === "late") return refused(t().fleet.ticketsLate);
    return json({ note: t().fleet.ticketsNote, tickets: read });
  } catch (error) {
    return refused(t().fleet.ticketsFailed(error instanceof Error ? error.message : String(error)));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The core of `add_tasks`, shared with a linked agent's `hand_off` (`./handOff.ts`): the tasks join the queue, each one
 * also a card of the to-do column on a board a Manager runs; `handedBy` names the agent that handed them over. The tasks
 * with their cards and the queue they joined, or what is wrong.
 */
export function enqueueTasks(fleetId: string, mission: Mission, args: Record<string, unknown>, handedBy?: string): { tasks: QueuedTask[]; queue: QueuedTask[]; latest: Mission } | string {
  if (mission.state === "terminee") return t().fleet.finished;
  const grouped = Array.isArray(args.tasks) && args.tasks.some((s) => Boolean((s as Record<string, unknown> | null)?.groupe));
  if (grouped && !canvasKnown(fleetId)) return t().fleet.hiddenWorkspace;
  const cards = linkedBoards(fleetId).flatMap(({ board }) => Object.keys(board.cards));
  const asked = proposedTasks(args, asPlanned(fleetId, mission), linkedGroups(fleetId), cards);
  if (typeof asked === "string") return asked;
  // What a task waits for: a task of the queue, of the plan (still pending, or running), or one started.
  const proposed = resolvedWaits(asked, mission.queue ?? [], [...startedTitles(mission), ...(mission.plan ?? []).map((s) => s.title)]);
  if (typeof proposed === "string") return proposed;
  // Before any card is written: a task another agent already works on is not queued again, from add_tasks or hand_off.
  const already = alreadyOnIt(fleetId, proposed, [fleetId, mission.manager]);
  if (already.length > 0) return t().fleet.duplicateTasks(already);
  const tasks = addTaskCards(fleetId, handedBy ? proposed.map((task) => ({ ...task, handedBy })) : proposed);
  // Read again: the cards were written meanwhile.
  const latest = missionOf(nodesStore.getState().nodes[fleetId]) ?? mission;
  const queue = [...(latest.queue ?? []), ...tasks];
  setMission(fleetId, { queue });
  return { tasks, queue, latest };
}

/**
 * `add_tasks`, the Fleet's or the Manager's: the tasks join the queue; on a board a Manager runs, each is also a
 * card in its to-do column. The queue starts a new agent for each as seats free up, without waiting for anyone.
 * The Fleet's cards travel to the board, then to the Manager, who is told.
 */
/**
 * `add_tasks`' tasks with a level each where the router picks the team's model (`levelsRequired`): medium for want
 * of one, as hand_off's and spawn_agent's, rather than a refusal now that the router is on unless turned off. A plan
 * still needs one per sub-task: the Fleet rates them all at once. How many took medium, for the answer.
 */
function withDefaultLevels(fleetId: string, mission: Mission, args: Record<string, unknown>): { args: Record<string, unknown>; defaulted: number } {
  if (!Array.isArray(args.tasks) || !levelsRequired(fleetId, mission)) return { args, defaulted: 0 };
  let defaulted = 0;
  const tasks = args.tasks.map((item: unknown) => {
    const r = item as Record<string, unknown> | null;
    if (typeof r !== "object" || r === null || (r.niveau !== undefined && r.niveau !== null)) return item;
    defaulted++;
    return { ...r, niveau: "moyen" };
  });
  return { args: { ...args, tasks }, defaulted };
}

function addTasks(fleetId: string, mission: Mission, asked: Record<string, unknown>, caller: string = fleetId): ToolResult {
  // Before enqueueTasks: it also serves hand_off, which checks the finished mission itself; here the refusal names who calls.
  if (mission.state === "terminee") return refused(caller === fleetId ? t().fleet.finishedAddTasks : t().fleet.finishedForManager);
  const { args, defaulted } = withDefaultLevels(fleetId, mission, asked);
  const added = enqueueTasks(fleetId, mission, args);
  if (typeof added === "string") return refused(added);
  const { tasks, queue, latest } = added;
  if (latest.state === "en_cours" && latest.manager && latest.board) {
    if (caller === fleetId) {
      talk(fleetId, latest.board);
      talk(latest.board, latest.manager);
      notify(latest.manager, t().lines.cardsAdded(fleetNameOf(fleetId), tasks.map((task) => task.title)));
    } else talk(caller, latest.board);
  }
  void pumpQueue(fleetId);
  const medium = levelModel(teamAgent(fleetId), "moyen", modelRouterStore.getState().levels);
  return said(t().fleet.queued(tasks.length, queue.length) + (defaulted ? t().fleet.defaultedLevels(defaulted, medium && modelLabel(medium)) : ""));
}

/**
 * `prioritize` (the Fleet): a waiting task moves in the queue, its card in the to-do column with it, and/or its
 * card's priority changes. The Manager hears the new order.
 */
function prioritize(fleetId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  const f = t().fleet;
  const title = typeof args.task === "string" ? args.task.trim() : "";
  const queue = [...(mission.queue ?? [])];
  const at = queue.findIndex((task) => sameName(task.title, title));
  if (at < 0) return refused(f.notQueued(title));
  const position = args.position;
  const priority = args.priority;
  if (position === undefined && priority === undefined) return refused(f.prioritizeWhat);
  if (position !== undefined && (typeof position !== "number" || !Number.isInteger(position) || position < 1)) return refused(f.prioritizeWhat);
  if (priority !== undefined && !(KANBAN_PRIORITIES as readonly unknown[]).includes(priority)) return refused(f.priorityUnknown(String(priority)));
  const task = queue[at];
  const said_: string[] = [];
  if (typeof position === "number") {
    queue.splice(at, 1);
    const to = Math.min(position - 1, queue.length);
    queue.splice(to, 0, task);
    setMission(fleetId, { queue });
    said_.push(f.prioritized(task.title, to + 1, queue.length));
    // Its card stands where its task now waits: before the next waiting task's card, else after the last one's.
    const found = missionBoard(fleetId);
    const column = found ? todoColumnOf(found.board, fleetId) : undefined;
    if (found && column && task.card && column.cardIds.includes(task.card)) {
      const others = column.cardIds.filter((id) => id !== task.card);
      const after = queue.slice(to + 1).find((q) => q.card && others.includes(q.card))?.card;
      const before = [...queue.slice(0, to)].reverse().find((q) => q.card && others.includes(q.card))?.card;
      const index = after ? others.indexOf(after) : before ? others.indexOf(before) + 1 : 0;
      const moved = movedCard(found.board, task.card, column.id, index);
      nodesStore.getState().update(found.nodeId, { columns: moved.columns });
    }
  }
  if (typeof priority === "string") {
    const found = missionBoard(fleetId) ?? linkedBoards(fleetId).find(({ board }) => task.card && board.cards[task.card]) ?? null;
    if (found && task.card && found.board.cards[task.card]) {
      const card = found.board.cards[task.card];
      nodesStore.getState().update(found.nodeId, { cards: { ...found.board.cards, [task.card]: { ...card, priority: priority as KanbanPriority } } });
    }
    said_.push(f.prioritySet(task.title, priority));
  }
  if (typeof position === "number" && mission.state === "en_cours" && mission.manager && mission.board) {
    talk(fleetId, mission.board);
    talk(mission.board, mission.manager);
    notify(mission.manager, t().lines.reordered(fleetNameOf(fleetId), queue.map((q) => q.title)));
  }
  return said(said_.join(" "));
}

/** `stop_mission` (the Fleet): the user wants it stopped. It ends as the panel's "Stop the mission" ends it (`stopMission`). */
function stopMissionTool(fleetId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  if (mission.state !== "en_cours") return refused(t().fleet.noMission);
  const reason = typeof args.reason === "string" ? oneLine(args.reason) : "";
  if (!reason) return refused(t().fleet.stopReasonMissing);
  return stopMission(fleetId, { by: "fleet", reason }) ? said(t().fleet.missionStopped) : refused(t().fleet.noMission);
}

/** `move_card` (the Manager): a card of the mission's board to a column, by its id or its title. */
async function moveCardTool(fleetId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const f = t().fleet;
  const found = missionBoard(fleetId);
  if (!found) return refused(f.noMissionBoard);
  const cardId = typeof args.card === "string" ? args.card.trim() : "";
  const card = found.board.cards[cardId];
  if (!card) return refused(f.cardUnknown(cardId));
  const wanted = typeof args.column === "string" ? args.column.trim() : "";
  const column = found.board.columns.find((c) => c.id === wanted) ?? found.board.columns.find((c) => sameName(c.title, wanted));
  if (!column) return refused(f.columnUnknown(wanted, found.board.columns.map((c) => c.title).join(", ")));
  // Moved at once; its issue follows in the board's GitHub queue, never in the 30 s Rust gives a tool (`move_board_card`).
  void moveMissionCard(fleetId, cardId, column.id).catch(() => undefined);
  return said(f.cardMoved(card.title, column.title));
}

/** `need_user` (the Manager): stuck on the user, it says so in one line to the Fleet, which tells them. */
function needUser(fleetId: string, managerId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  const reason = typeof args.reason === "string" ? oneLine(args.reason) : "";
  if (!reason) return refused(t().fleet.needUserMissing);
  if (mission.board) {
    talk(managerId, mission.board);
    talk(mission.board, fleetId);
  }
  notify(fleetId, t().lines.needsUser(nodeNameOf(nodesStore.getState().nodes[managerId]) || managerNameOf(fleetId), reason));
  return said(t().fleet.needUserSent(fleetNameOf(fleetId)));
}

/** Whether a line typed now reaches the session: its terminal runs, and its CLI has not gone back to its shell, where the line would run as a command. */
const takesLine = (nodeId: string) => isRunning(nodeId) && !agentActivityStore.getState().activities[nodeId]?.left;
/** A dialog waits for the user in that terminal: `notify` holds the line until it is answered, and the sender hears so. */
const heldByDialog = (nodeId: string) => agentActivityStore.getState().activities[nodeId]?.activity === "waiting";

/** The light runs along the wires the go-ahead drew, Fleet → board → Manager, as the Fleet's cards and the Manager's need_user do. */
function throughBoard(fromId: string, toId: string, board: string | undefined) {
  if (!board) return talk(fromId, toId);
  talk(fromId, board);
  talk(board, toId);
}

/**
 * `message_manager` (the Fleet): one line typed into the terminal of the Manager running its mission, through the line
 * queue the board's news takes (`notify`): what the user tells the Fleet for the team reaches it through the Manager,
 * who answers with message_fleet. Listed to every Fleet (`FLEET_TOOLS`), so refused, saying why, whenever no Manager
 * takes it. A Manager never reports, so dummyPlane never stops it to free memory: there is no session to wake up.
 */
function messageManager(fleetId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  const f = t().fleet;
  if (mission.state === "terminee") return refused(f.noManagerFinished);
  if (mission.state === "redaction" || mission.state === "plan") return refused(f.noManagerYet);
  // The go-ahead types the Manager its orders first: a line ahead of them would reach a Manager that knows nothing yet.
  if (mission.state === "lancement") return refused(f.managerStarting);
  const managerId = mission.manager;
  if (!managerId) return refused(f.noManagerOldWay);
  const manager = managerNameOf(fleetId);
  if (!isManagerNode(managerId)) return refused(f.managerClosed(manager));
  // Closing a terminal stops it, as relaunch reads it: only a stopped Manager may be gone, the refusal says which.
  if (!takesLine(managerId)) return refused(closedByUser(managerId) ? f.managerClosed(manager) : f.managerStopped(manager));
  const text = typeof args.text === "string" ? oneLine(args.text) : "";
  if (!text) return refused(f.nothingToSend);
  notify(managerId, t().lines.fromFleet(fleetNameOf(fleetId), text));
  throughBoard(fleetId, managerId, mission.board);
  return said(heldByDialog(managerId) ? f.managerHeld(manager) : f.managerMessaged(manager));
}

/**
 * `message_fleet` (the Manager): one line typed into its Fleet's terminal, to answer what the Fleet sent or to tell it
 * what it must know. The team's news is not for it (the Fleet hears the board's end), nor is the user (need_user).
 */
function messageFleetTool(fleetId: string, managerId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  const f = t().fleet;
  const fleet = fleetNameOf(fleetId);
  // Deleted from the canvas, it waits for an undo: nobody would read the line.
  if (isFleetClosed(fleetId)) return refused(f.fleetClosed(fleet));
  if (!sessionOf(nodesStore.getState().nodes[fleetId]) || !takesLine(fleetId)) return refused(f.fleetStopped(fleet));
  const text = typeof args.text === "string" ? oneLine(args.text) : "";
  if (!text) return refused(f.nothingToSend);
  notify(fleetId, t().lines.fromManager(nodeNameOf(nodesStore.getState().nodes[managerId]) || managerNameOf(fleetId), text));
  throughBoard(managerId, fleetId, mission.board);
  return said(heldByDialog(fleetId) ? f.fleetHeld(fleet) : f.fleetMessaged(fleet));
}

/**
 * `merge`: the branches of the agents done, after recording as done the one it names (`agent`): an agent that finished
 * without reporting, or whose "blocked" report left good work. Its work is recorded as its own report would be
 * (`recordMemberReport`): its seat is free, its card follows. Not while it is at work: it reports itself, or is
 * interrupted first.
 */
async function mergeTool(fleetId: string, caller: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const f = t().fleet;
  if (mission.state !== "en_cours") return refused(f.noMission);
  let recorded = "";
  let named: string | undefined;
  if (typeof args.agent === "string" && args.agent.trim()) {
    const member = memberNamed(mission, args.agent);
    if (typeof member === "string") return refused(member);
    if (member.handedTo) return refused(f.recordHanded(member.name, member.handedTo));
    if (member.abandoned) return refused(f.recordAbandoned(member.name));
    if (member.cleanedUp) return refused(f.recordGone(member.name));
    // At work, waiting on a dialog or an answer: recorded now, or merged while it resolves its conflict, its work would be cut.
    const busy = busyNow(member.nodeId);
    named = member.nodeId;
    if (member.report?.status === "termine") {
      if (busy && conflictPending(member)) return refused(f.recordWorking(member.name));
      recorded = `${f.recordDone(member.name)}
`;
    } else if (busy) return refused(f.recordWorking(member.name));
    else {
      const said_ = typeof args.summary === "string" ? oneLine(args.summary) : "";
      recordMemberReport(fleetId, member, { summary: said_ || f.recordedSummary(nodeNameOf(nodesStore.getState().nodes[caller]) || "the Manager"), status: "termine", at: Date.now() });
      recorded = `${f.recorded(member.name)}
`;
    }
  }
  const merged = await mergeMission(fleetId, named);
  // A branch a conflict held back is in now: new agents for the queue start from it.
  void pumpQueue(fleetId);
  return said(recorded + merged);
}

/**
 * `close_agent` (the Manager): closes the terminal of an agent of its team that has reported or stopped, with its own
 * sub-agents that are done: they share its folder. Never one at work, waiting, held by a dialog, starting, moved on by
 * the queue, whose sub-agents work or that the user is at (`keptOpen`), nor one whose sub-task is still to be typed.
 * Its report, branch and worktree stay: the mission's cleanup saves what is uncommitted there, and reassign still
 * hands its sub-task over. Never a linked agent: it is the user's, and goes back to their project at the mission's end.
 */
async function closeAgent(fleetId: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const f = t().fleet;
  if (mission.state !== "en_cours") return refused(f.noMission);
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  if (member.linked) return refused(f.closeLinked(member.name));
  // Closed by the user already: its record only waits for an undo.
  if (!member.nodeId || !terminalOf(nodesStore.getState().nodes[member.nodeId]) || isClosedNode(member.nodeId)) return refused(f.closeGone(member.name));
  const stopped = agentState(member.nodeId) === "arrêté";
  if (!member.report && !stopped) return refused(f.closeNotDone(member.name));
  if (member.brief !== undefined || deliveryPending(member.nodeId)) return refused(f.closeOpen(member.name, f.closeDelivering));
  const why = keptOpen(member.nodeId);
  if (why) return refused(f.closeOpen(member.name, messages(missionMessages).openWhy[why]));
  const family = [member.nodeId, ...spawnedUnder(member.nodeId).filter((id) => !isClosedNode(id) && keptOpen(id) === null)];
  await closeTerminals(fleetId, family);
  return said(f.closed(member.name, family.length - 1));
}

function describeQueue(fleetId: string, args: Record<string, unknown> = {}): ToolResult {
  const f = t().answers;
  // What was done outside the queue is no longer waiting in it (`settleQueue`).
  settleQueue(fleetId);
  const mission = missionOf(nodesStore.getState().nodes[fleetId])!;
  const entry = (s: QueuedTask, brief: string) => ({
    title: s.title,
    brief,
    budget_min: s.budgetMin,
    level: s.level ? outLevel(s.level) : null,
    group: s.group?.name ?? null,
    card: s.card ?? null,
    ...(s.handedBy ? { handed_by: s.handedBy } : {}),
    // What it waits for, and where each stands: it starts once each is done and merged.
    ...(s.waitsFor?.length ? { waits_for: s.waitsFor.map((title) => ({ task: title, state: waitState(mission, title) })) } : {}),
  });
  const queue = mission.queue ?? [];
  const asked = typeof args.task === "string" ? args.task.trim() : "";
  if (asked) {
    const found = namedTask(queue, asked);
    return found ? said(lined(entry(found, shortenedKeepingLines(found.brief, DETAIL_CHARS, f.rest)))) : refused(f.noTask(asked, queue.map((s) => s.title)));
  }
  const waiting = queue.map((s) => entry(s, shortened(s.brief, LISTED_CHARS, f.how.queue(s.title))));
  return said(
    fitted(waiting.length, (shown) =>
      lined({
        waiting: waiting.slice(0, shown),
        ...(shown < waiting.length ? { waiting_left_out: f.left.tasks(waiting.length - shown) } : {}),
        active_agents: activeCount(fleetId, mission),
        max_agents: mission.maxAgents,
      }),
    ),
  );
}

async function nextTask(fleetId: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  if (mission.state !== "en_cours") return refused(t().fleet.noMission);
  if (member.handedTo) return refused(t().fleet.handedAway(member.name));
  const result = await giveNext(fleetId, member);
  return "given" in result ? said(result.given) : refused(result.refused);
}

const timeText = (spent: number | undefined, budget: number) => (spent === undefined ? `? / ${budget} min` : `${Math.floor(spent)} / ${budget} min`);

/** `board` for the Manager: the mission's board. */
function describeMissionBoard(fleetId: string, args: Record<string, unknown> = {}): ToolResult {
  const found = missionBoard(fleetId);
  if (!found) return describeBoards(fleetId, false, args);
  return boardsAnswer([found], { tool: "board", note: t().fleet.boardNote, card: args.card });
}

/** `board`: the Kanban boards handed to this fleet. */
function describeBoards(fleetId: string, pointToWired = false, args: Record<string, unknown> = {}): ToolResult {
  const boards = linkedBoards(fleetId);
  // The Fleet is told where the boards wired to it are read; its Manager has no such tool.
  if (boards.length === 0) return said(t().fleet.noBoard + (pointToWired ? t().fleet.noBoardWired : ""));
  return boardsAnswer(boards, { tool: "board", note: t().fleet.boardNote, card: args.card });
}

function describeTeam(fleetId: string, mission: Mission, args: Record<string, unknown> = {}): ToolResult {
  if (!formed(mission)) return refused(t().fleet.notFormed(mission.state));
  const nodes = nodesStore.getState().nodes;
  const now = Date.now();
  // Groups live on the scene: never read, they are unknown, which null would not say.
  const shown = canvasKnown(fleetId);
  // Every agent as the answer about one alone gives it: everything, its report whole.
  const everyone = mission.members.map((m) => ({
      name: m.name,
      ...(shown ? agentGroup(m.nodeId) : {}),
      subtask: m.task,
      // The canvas pill's own reading; restarting from its menu, its resume card or relaunch is not stopped, though its old process has gone.
      state: stateWord(m.nodeId),
      state_min: stateMinutes(m.nodeId, now),
      steps: terminalOf(nodes[m.nodeId])?.steps?.map((s) => `${s.title}: ${outStep(s.state)}`) ?? [],
      time: timeText(memberTime(mission, m, now), budgetOf(m)),
      overdue: m.overdue ?? 0,
      handed_to: m.handedTo ?? null,
      abandoned: m.abandoned === true,
      finished: m.done ?? [],
      model: m.model ? modelLabel(m.model) : null,
      branch: m.branch,
      report: m.report ? { status: outReport(m.report.status), summary: m.report.summary } : null,
      merged: m.merged === true,
  }));
  const whole = (m: Member) => everyone[mission.members.indexOf(m)];
  const f = t().answers;
  const asked = typeof args.agent === "string" ? args.agent.trim() : "";
  if (asked) {
    const member = memberNamed(mission, asked);
    if (typeof member === "string") return refused(member);
    const all = whole(member);
    return said(lined({ ...all, report: all.report && { ...all.report, summary: shortenedKeepingLines(all.report.summary, DETAIL_CHARS, f.rest) } }));
  }
  // The list: the same entries, a line each, the steps as how far they got and the report cut short.
  const listed = mission.members.map((m) => {
    const { steps: _steps, finished: _finished, branch: _branch, overdue, handed_to, abandoned, model, report, ...rest } = whole(m);
    return {
      ...rest,
      ...stepProgress(terminalOf(nodes[m.nodeId])?.steps),
      ...(overdue ? { overdue } : {}),
      ...(handed_to ? { handed_to } : {}),
      ...(abandoned ? { abandoned } : {}),
      ...(model ? { model } : {}),
      report: report && { ...report, summary: shortened(report.summary, LISTED_CHARS, f.how.team(m.name)) },
    };
  });
  return said(fitted(listed.length, (count) => lined([...listed.slice(0, count), ...(count < listed.length ? [{ left_out: f.left.agents(listed.length - count) }] : [])])));
}

/** How far an agent got through the steps it declared, in a word or two: "2/5, now: Tests"; nothing when it declared none. */
function stepProgress(steps: readonly { title: string; state: StepState }[] | undefined) {
  if (!steps || steps.length === 0) return {};
  const done = steps.filter((s) => s.state === "fait").length;
  const failed = steps.filter((s) => s.state === "echec").length;
  const current = steps.find((s) => s.state === "en_cours");
  return { progress: `${done}/${steps.length}${current ? `, now: ${current.title}` : ""}${failed ? `, ${failed} failed` : ""}` };
}

function readOutput(mission: Mission, args: Record<string, unknown>): ToolResult {
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  const lines = typeof args.lignes === "number" ? Math.min(200, Math.max(1, Math.floor(args.lignes))) : 50;
  const text = terminalText(member.nodeId, lines);
  if (text) return said(text);
  // Not shown since dummyPlane started, its screen is blank: it is stopped, not dead (13 Nov, four such agents were replaced).
  return said(agentState(member.nodeId) === "arrêté" && !isRestarting(member.nodeId) ? t().fleet.stoppedUnread(member.name) : t().fleet.emptyTerminal);
}

async function write(fleetId: string, caller: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  const text = typeof args.texte === "string" ? oneLine(args.texte) : "";
  // Said with the arguments the call had: the text may be there under another name (internally `texte`, the French one).
  if (!text) return refused(t().fleet.nothingToWrite(member.name, Object.keys(args).filter((key) => key !== "agent" && key !== "texte")));
  // Its worktree is its successor's now (reassign to "new" once it stopped): woken, it would work there beside it.
  const successor = member.handedTo ? mission.members.find((m) => sameName(m.name, member.handedTo ?? "") && m.worktree === member.worktree) : undefined;
  if (successor) return refused(t().fleet.handedInPlace(member.name, successor.name));
  // A finished member dummyPlane stopped to free its memory, or starting again already: the text waits for its
  // session, typed earlier it would land in its shell (`@/agents/finishedStop`). Answered now: its session may take
  // longer to open than the call may last.
  const woken = wakingUp(member.nodeId) ?? (wakeable(member.nodeId) ? wakeFinished(member.nodeId) : undefined);
  if (woken) {
    void woken
      .then((ready) => (ready ? typeTo(fleetId, caller, member, text) : notify(caller, t().fleet.notWokenWrite(member.name))))
      .catch(() => notify(caller, t().fleet.notWokenWrite(member.name)));
    return said(t().fleet.wakingWrite(member.name));
  }
  const activity = agentActivityStore.getState().activities[member.nodeId];
  // An agent that exited leaves its shell: the text would run there as a command.
  if (!isRunning(member.nodeId) || activity?.left) return refused(t().fleet.stopped(member.name));
  if (activity?.activity === "waiting") return refused(t().fleet.waiting(member.name));
  // Typed now, the text would be spliced into the user's own, unsent, and sent with it (a notice waits as long as it takes: this answers now).
  if (hasUnsentInput(member.nodeId)) return refused(t().fleet.typing(member.name));
  // dummyPlane still waits for its Claude to type its sub-task: a line now would cross it, or answer a question meant for the user.
  if (deliveryPending(member.nodeId)) return refused(t().fleet.notYetSent(member.name));
  await typeTo(fleetId, caller, member, text);
  return said(t().fleet.written(member.name));
}

/** Types `text` into a member's terminal, for `write`. */
async function typeTo(fleetId: string, caller: string, member: Member, text: string) {
  await ptySendText(member.nodeId, text);
  // The message draws its wire if none joins them (a linked agent, a group joiner).
  talk(caller, member.nodeId);
  // Nobody types its sub-task any more (dummyPlane gave up, or restarted since): what is written is it, and its report
  // is the mission's. dummyPlane's own text of it is dropped: a restart would type it on top.
  const now = missionOf(nodesStore.getState().nodes[fleetId]);
  const held = now?.members.find((m) => m.nodeId === member.nodeId);
  if (now?.state === "en_cours" && held && held.sentAt === undefined && !held.handedTo) updateMember(fleetId, member.nodeId, { sentAt: Date.now(), brief: undefined });
}

function prolong(fleetId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  if (mission.state !== "en_cours") return refused(t().fleet.noMission);
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  if (member.handedTo) return refused(t().fleet.handedAway(member.name));
  if (member.report) return refused(t().fleet.alreadyReported(member.name));
  const minutes = args.minutes;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1) return refused(t().fleet.wholeMinutes);
  const extraMin = (member.extraMin ?? 0) + minutes;
  const budget = member.budgetMin + extraMin;
  const spent = spentMin(member, Date.now());
  // Real time: overnight, its new target must end before the night does.
  const left = remainingGlobal(mission, Date.now());
  if (left !== undefined && budget - spent > left) return refused(t().fleet.globalLeft(left));
  // Below its new budget it may be told again later; still past it, it is not told twice.
  const overdue = spent >= 2 * budget ? 2 : spent >= budget ? 1 : undefined;
  // The warning at 80 % comes again below it, as the overruns do.
  updateMember(fleetId, member.nodeId, { extraMin, overdue, nearTold: spent >= BUDGET_WARN_AT * budget ? member.nearTold : undefined });
  return said(t().fleet.extended(member.name, minutes, budget));
}

async function interrupt(mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  // The same as "Pause": "Resume all" knows it.
  if ((await pauseAgents([member.nodeId])) === 0) return refused(t().fleet.notWorking(member.name));
  return said(t().fleet.interrupted(member.name));
}

/** What the caller passed, said back on one line and cut short: it may be a whole brief. */
const ECHO_MAX = 80;
const echoed = (text: string) => {
  const line = oneLine(text);
  return line.length > ECHO_MAX ? `${cutWhole(line, ECHO_MAX - 1)}…` : line;
};

/** Whether a member's terminal is gone from the canvas: a closed one keeps its record, its element deleted, for Ctrl+Z. */
function closedByUser(nodeId: string): boolean {
  const record = nodesStore.getState().nodes[nodeId];
  if (!record || !terminalOf(record)) return true;
  const scene = sceneAccess(record.workspaceId);
  // Its scene never read: nothing says it was closed, and a mission starts a terminal not shown yet.
  if (!scene) return false;
  const element = scene.elements().find((e) => e.id === nodeId);
  return element === undefined || element.isDeleted;
}

/**
 * `relaunch`: a member whose terminal stopped, or whose agent went back to its shell, starts again on its own
 * conversation (a session that never opened starts anew under its id). A sub-task it never got, `@/mission/redeliver`
 * types once it runs; otherwise the caller tells it what is left.
 */
async function relaunch(fleetId: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const f = t().fleet;
  if (mission.state !== "en_cours") return refused(f.noMission);
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  if (member.handedTo) return refused(f.relaunchHanded(member.name, member.handedTo));
  // Already starting again (this tool, its menu, its resume card): a second start would race the first one's spawn.
  if (isRestarting(member.nodeId)) return refused(f.relaunchUnderWay(member.name));
  // As write reads it: an agent back at its shell is stopped, though its terminal runs.
  if (agentState(member.nodeId) !== "arrêté") return refused(f.relaunchRunning(member.name));
  // Closing a terminal stops it: only a stopped one may be gone.
  if (closedByUser(member.nodeId)) return refused(f.relaunchClosed(member.name));
  const payload = terminalOf(nodesStore.getState().nodes[member.nodeId]);
  if (!payload) return refused(f.relaunchClosed(member.name));
  // Stopped once its sub-task was typed, it holds no seat (`@/mission/active`): the queue may have taken it, and Max agents caps the agents at work.
  if (relaunchTakesSeat(mission, member) && activeCount(fleetId, mission) >= mission.maxAgents) return refused(f.relaunchTeamFull(member.name, seatsOf(fleetId, mission)));
  // Counted at work, once, from here until its new process runs (`relaunchSession` marks it restarting at once).
  let failure: string | undefined;
  try {
    await relaunchTerminal(member.nodeId, payload, relaunchMode(payload));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  // A refused spawn leaves its error on the terminal, it does not throw.
  const status = statusOf(member.nodeId);
  if (failure === undefined && status.state === "error") failure = status.message;
  // The seat it held while starting is free again: the queue moves on (`@/mission/restartWatch`).
  if (failure !== undefined) return refused(f.relaunchFailed(member.name, failure));
  const now = missionOf(nodesStore.getState().nodes[fleetId])?.members.find((m) => m.nodeId === member.nodeId);
  return said(now?.sentAt === undefined && now?.brief ? f.relaunchedBrief(member.name) : f.relaunched(member.name));
}

/**
 * `relaunch` from the Fleet of a mission its Manager runs: the Manager, closed (its node re-opened, even after a
 * restart: `reopenManager`) or stopped, starts again on its own conversation while the mission runs; its team
 * stopped meanwhile follows, and the Manager hears where things stand (`restoreReopened`), after the answer: a
 * team's starts take longer than a tool call may last. The Fleet tells the user, who may have closed it on purpose.
 */
async function relaunchManager(fleetId: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const f = t().fleet;
  const managerId = mission.manager;
  const name = managerNameOf(fleetId);
  if (!managerId || mission.state !== "en_cours") return refused(f.reopenNoMission(name));
  // Its team is the Manager's to relaunch: the Fleet brings back the Manager only.
  if (typeof args.agent === "string" && args.agent.trim() !== "" && !sameName(args.agent, name)) return refused(f.reopenOnlyManager(name));
  if (isRestarting(managerId)) return refused(f.reopenUnderWay(name));
  const gone = !isManagerNode(managerId) || closedByUser(managerId);
  if (!gone && agentState(managerId) !== "arrêté") return refused(f.reopenRunning(name));
  let failure: string | null = null;
  if (gone) failure = await reopenManager(fleetId);
  else {
    const payload = terminalOf(nodesStore.getState().nodes[managerId]);
    try {
      if (payload) await relaunchTerminal(managerId, payload, relaunchMode(payload));
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const status = statusOf(managerId);
    if (failure === null && status.state === "error") failure = status.message;
  }
  if (failure !== null) return refused(f.reopenFailed(name, failure));
  restoreReopened(fleetId, fleetNameOf(fleetId));
  return said(gone ? f.managerReopened(name) : f.managerRelaunched(name));
}

async function reassign(fleetId: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  if (mission.state !== "en_cours") return refused(t().fleet.noMission);
  const title = typeof args.sous_tache === "string" ? args.sous_tache : "";
  // The holder reassign takes first: a title an abandoned task shares is not that one.
  let from = reassignable(mission).find((m) => sameName(m.task, title)) ?? mission.members.find((m) => !m.handedTo && sameName(m.task, title));
  if (!from) {
    // Not its title as team gives it, but what an agent naturally passes: the holder's name, its card's id, the start of its title.
    const near = subTasksNamedBy(mission, title);
    if (near.length > 1) return refused(t().fleet.ambiguousSubtask(echoed(title), near.map((m) => ({ title: m.task, holder: m.name }))));
    from = near[0];
  }
  // The titles reassign takes, with who holds each, so that a call that passed something else (a whole brief) can be made again right.
  if (!from) return refused(t().fleet.noSubtask(echoed(title), reassignable(mission).map((m) => ({ title: m.task, holder: m.name }))));
  const result = await reassignTask(fleetId, from.nodeId, typeof args.agent === "string" ? args.agent : "");
  return typeof result === "string" ? refused(result) : said(t().fleet.handedTo(from.task, result.name));
}

async function finish(fleetId: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  if (mission.state !== "en_cours") return refused(t().fleet.noMission);
  const summary = typeof args.bilan === "string" ? args.bilan.trim() : "";
  if (!summary) return refused(t().fleet.summaryMissing);
  // In OpenUI Lang, the panel draws it; its text is what the rest reads. A broken one is refused before anything changes.
  const { text, ui, errors } = await splitGenerated(summary);
  if (errors) return refused(t().output.summaryInvalid(errors));
  const handChecks = Array.isArray(args.check) ? args.check.filter((line): line is string => typeof line === "string" && line.trim() !== "").map(oneLine) : [];
  if (handChecks.length > 0) setMission(fleetId, { handChecks });
  if (ui) endMission(fleetId, text, ui);
  else endMission(fleetId, text);
  return said(t().fleet.ended);
}

/** Its team as `remote_control` names it: the linked Claude agents and the mission's members. */
function teamOf(fleetId: string, mission: Mission): { nodeId: string; name: string }[] {
  const team = canvasKnown(fleetId) ? linkedTeamAgents(fleetId) : [];
  if (mission.manager && nodesStore.getState().nodes[mission.manager]) team.push({ nodeId: mission.manager, name: managerNameOf(fleetId) });
  for (const member of mission.members) {
    if (!member.handedTo && !team.some((t) => t.nodeId === member.nodeId)) team.push({ nodeId: member.nodeId, name: member.name });
  }
  return team;
}

async function remote(fleetId: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const o = t().fleet;
  if (typeof args.actif !== "boolean") return refused(o.remoteOnMissing);
  const on = args.actif;
  const names = Array.isArray(args.agents) ? args.agents.filter((name): name is string => typeof name === "string") : [];
  if (names.length === 0) return refused(o.remoteAgentsMissing);
  const team = teamOf(fleetId, mission);
  const chosen: { nodeId: string; name: string }[] = [];
  const unknown: string[] = [];
  const ambiguous: string[] = [];
  for (const name of names) {
    if (sameName(name, "moi")) chosen.push({ nodeId: fleetId, name: o.you });
    else if (sameName(name, "tous")) chosen.push(...team);
    else {
      const found = team.filter((t) => sameName(t.name, name));
      // Two agents of the same name: the first would be picked silently.
      if (found.length > 1) ambiguous.push(name);
      else if (found.length === 1) chosen.push(found[0]);
      else unknown.push(name);
    }
  }
  if (unknown.length > 0) return refused(o.remoteUnknown(unknown.join(", ")));
  if (ambiguous.length > 0) return refused(o.remoteAmbiguous(ambiguous.join(", ")));
  const targets = chosen.filter((t, i) => chosen.findIndex((other) => other.nodeId === t.nodeId) === i);
  if (targets.length === 0) return refused(o.remoteNone);
  const results = await Promise.all(targets.map(async (t) => ({ ...t, running: isRunning(t.nodeId), result: await setRemoteControl(t.nodeId, on) })));
  const r = o.remote;
  return said(
    results
      .map(({ nodeId, name, running, result }) => {
        if (!result) return r.notClaude(name);
        if ("error" in result) return r.failed(name, result.error);
        // Its own session is in the turn of this very call.
        if ("later" in result) return nodeId === fleetId ? r.laterSelf(name) : r.later(name);
        if (!result.on) return r.off(name);
        if (!running) return r.nextStart(name);
        return r.on(name, result.url ?? r.noLink);
      })
      .join("\n"),
  );
}

/**
 * One call of the fleet, by internal name; it acts on its own mission only. Once a
 * Manager runs its mission, the team's tools are the Manager's: the Fleet babysits the board.
 */
export async function fleetTool(fleetId: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!mission) return refused(t().fleet.gone);
  // relaunch is the Fleet's too: it brings back its Manager (`relaunchManager`).
  if (LEGACY_INTERNAL.has(name) && name !== "relaunch" && mission.manager) return refused(t().router.managerRuns(managerNameOf(fleetId)));
  if (MANAGER_ONLY.has(name)) return refused(t().router.managerOnly);
  switch (name) {
    case "mission":
      return describeMission(fleetId, mission, args);
    case "proposer_plan":
      return proposePlan(fleetId, mission, args);
    case "add_tasks":
      return addTasks(fleetId, mission, args);
    case "queue":
      return describeQueue(fleetId, args);
    case "next_task":
      return nextTask(fleetId, mission, args);
    case "tickets":
      return tickets(fleetId, mission);
    case "equipe":
      return describeTeam(fleetId, mission, args);
    case "lire_sortie":
      return readOutput(mission, args);
    case "ecrire":
      return write(fleetId, fleetId, mission, args);
    case "prolonger":
      return prolong(fleetId, mission, args);
    case "interrompre":
      return mission.state === "en_cours" ? interrupt(mission, args) : refused(t().fleet.noMission);
    case "relaunch":
      // Only a mission under way without a Manager is the Fleet's to run: any other, its Manager's relaunch, or plan again.
      return runsTheOldWay(mission) ? relaunch(fleetId, mission, args) : relaunchManager(fleetId, mission, args);
    case "reattribuer":
      return reassign(fleetId, mission, args);
    case "fusionner":
      return mergeTool(fleetId, fleetId, mission, args);
    case "terminer":
      return finish(fleetId, mission, args);
    case "land":
      return land(fleetId, fleetId);
    case "remote_control":
      return remote(fleetId, mission, args);
    case "board":
      return describeBoards(fleetId, true, args);
    case "prioritize":
      return prioritize(fleetId, mission, args);
    case "stop_mission":
      return stopMissionTool(fleetId, mission, args);
    case "clean_up_mission":
      return cleanUpMission(fleetId);
    case "clean_up_leftovers":
      return cleanUpLeftovers(fleetId);
    case "message_manager":
      return messageManager(fleetId, mission, args);
    default:
      return refused(t().router.unknown(name));
  }
}

/**
 * One call of a mission's Manager, by internal name: it runs its Fleet's mission with the team. The same mission tools as the Fleet's of old, plus its board's.
 */
export async function managerTool(managerId: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const fleetId = managedFleet(managerId);
  const mission = fleetId ? missionOf(nodesStore.getState().nodes[fleetId]) : undefined;
  if (!fleetId || !mission) return refused(t().fleet.managerGone);
  if (!MANAGER_INTERNAL.has(name)) return refused(FLEET_ONLY.has(name) ? t().router.fleetOnly : t().router.notForManager);
  switch (name) {
    case "mission":
      return describeMission(fleetId, mission, args);
    case "add_tasks":
      return addTasks(fleetId, mission, args, managerId);
    case "queue":
      return describeQueue(fleetId, args);
    case "next_task":
      return nextTask(fleetId, mission, args);
    case "board":
      return describeMissionBoard(fleetId, args);
    case "move_card":
      return moveCardTool(fleetId, args);
    case "equipe":
      return describeTeam(fleetId, mission, args);
    case "lire_sortie":
      return readOutput(mission, args);
    case "ecrire":
      return write(fleetId, managerId, mission, args);
    case "prolonger":
      return prolong(fleetId, mission, args);
    case "interrompre":
      return mission.state === "en_cours" ? interrupt(mission, args) : refused(t().fleet.noMission);
    case "relaunch":
      return relaunch(fleetId, mission, args);
    case "reattribuer":
      return reassign(fleetId, mission, args);
    case "fusionner":
      return mergeTool(fleetId, managerId, mission, args);
    case "land":
      return land(fleetId, managerId);
    case "close_agent":
      return closeAgent(fleetId, mission, args);
    case "terminer":
      return managerFinish(fleetId, managerId, mission, args);
    case "need_user":
      return needUser(fleetId, managerId, mission, args);
    case "message_fleet":
      return messageFleetTool(fleetId, managerId, mission, args);
    default:
      return refused(t().router.unknown(name));
  }
}

/** The Manager's `finish`: the mission ends as the Fleet's did, and the Fleet hears, in one line, that the board is finished. */
async function managerFinish(fleetId: string, managerId: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const result = await finish(fleetId, mission, args);
  if (result.isError) return result;
  const ended = missionOf(nodesStore.getState().nodes[fleetId]);
  if (mission.board) {
    talk(managerId, mission.board);
    talk(mission.board, fleetId);
  }
  notify(fleetId, t().lines.boardFinished(oneLine(ended?.summary ?? "")));
  return said(t().fleet.managerEnded(fleetNameOf(fleetId)));
}
