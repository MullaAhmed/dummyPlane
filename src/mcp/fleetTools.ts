import { talk } from "@/agents/talkWires";
import { pauseAgents } from "@/agents/broadcast";
import { setRemoteControl } from "@/agents/remoteControl";
import { messages } from "@/i18n";
import { ptySendText } from "@/ipc/pty";
import { missionFolder } from "@/mission/folder";
import { endMission, launchMission, mergeMission, reassignTask } from "@/mission/launch";
import { budgetOf, memberTime, NEW_AGENT, nightMin, oneLine, proposedPlan, proposedTasks, remainingGlobal, sameName, spentMin, type Member, type Mission, type QueuedTask } from "@/mission/mission";
import { activeCount } from "@/mission/active";
import { giveNext, pumpQueue } from "@/mission/queue";
import { boardView, todoColumnOf } from "@/kanban/missionLink";
import { moveCard as movedCard } from "@/kanban/board";
import { fleetNameOf, managerNameOf } from "@/mission/manager";
import { LEVELS, modelLabel } from "@/mission/router";
import { readTickets } from "@/mission/tickets";
import { addTaskCards, linkedBoards, missionBoard, moveMissionCard } from "@/kanban/fleetBoards";
import { agentGroup, agentState, linkedTeamAgents, linkedGroups, managedFleet, missionOf, canvasKnown, setMission, updateMember } from "@/mission/store";
import { notify } from "@/mission/events";
import { KANBAN_PRIORITIES, type KanbanPriority } from "@/nodes/types";
import { terminalText } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodeNameOf, nodesStore, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { splitGenerated } from "@/openui/detect";
import { refused, said, type ToolResult } from "./agentTools";
import { agentMessages } from "./messages";
import { outAgent, outAgentState, outLevel, outMission, outReport, outStep } from "./protocol";

const NO_ARGS = { type: "object", properties: {} } as const;
const t = () => messages(agentMessages);

/** Every mission tool, in the order tools/list gives them; each role takes its own (`fleetTools`, `managerTools`). */
function missionToolSpecs(manager: boolean) {
  const d = t().tools;
  return [
    { name: "mission", description: d.mission, inputSchema: NO_ARGS },
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
            minItems: 1,
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
              },
              required: ["title", "brief", "agent", "budget_min"],
            },
          },
        },
        required: ["name", "task", "subtasks"],
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
                level: { type: "string", enum: ["low", "medium", "high", "extreme"], description: d.planLevel },
                group: { type: "string", description: d.taskGroup },
                card: { type: "string", description: d.taskCard },
              },
              required: ["title", "brief", "budget_min"],
            },
          },
        },
        required: ["tasks"],
      },
    },
    { name: "queue", description: d.queue, inputSchema: NO_ARGS },
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
    { name: "board", description: manager ? d.managerBoard : d.board, inputSchema: NO_ARGS },
    {
      name: "move_card",
      description: d.moveCard,
      inputSchema: {
        type: "object",
        properties: { card: { type: "string", description: d.moveCardCard }, column: { type: "string", description: d.moveCardColumn } },
        required: ["card", "column"],
      },
    },
    { name: "team", description: d.team, inputSchema: NO_ARGS },
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
    {
      name: "reassign",
      description: d.reassign,
      inputSchema: { type: "object", properties: { subtask: { type: "string" }, agent: { type: "string" } }, required: ["subtask", "agent"] },
    },
    { name: "merge", description: d.merge, inputSchema: NO_ARGS },
    {
      name: "finish",
      description: manager ? d.managerFinish : d.finish,
      inputSchema: { type: "object", properties: { summary: { type: "string", description: d.finishSummary }, check: { type: "array", items: { type: "string" }, description: d.finishCheck } }, required: ["summary"] },
    },
    { name: "need_user", description: d.needUser, inputSchema: { type: "object", properties: { reason: { type: "string", description: d.needUserReason } }, required: ["reason"] } },
    { name: "stop_mission", description: d.stopMission, inputSchema: { type: "object", properties: { reason: { type: "string", description: d.stopReason } }, required: ["reason"] } },
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

/** The Fleet's tools while it plans and babysits its board (spec babysitter Fleet), by English name. */
export const FLEET_TOOLS: readonly string[] = ["mission", "propose_plan", "add_tasks", "queue", "prioritize", "tickets", "board", "team", "stop_mission", "remote_control"];
/** The team's tools, the Fleet's only for a mission launched before Managers existed: it runs it to its end the old way. */
export const LEGACY_TOOLS: readonly string[] = ["next_task", "read_output", "write", "extend", "interrupt", "reassign", "merge", "finish"];
/** A mission's Manager's tools: it runs the board's cards with the team. */
export const MANAGER_TOOLS: readonly string[] = ["mission", "add_tasks", "queue", "next_task", "board", "move_card", "team", "read_output", "write", "extend", "interrupt", "reassign", "merge", "finish", "need_user"];

/** Whether a Fleet's mission runs the old way: under way, with no Manager. Only then does the Fleet list the team's tools. */
export const runsTheOldWay = (mission: Mission | undefined) => (mission?.state === "en_cours" || mission?.state === "lancement") && !mission.manager;

/**
 * The Fleet's tools (spec orchestrateur §7.2), named in English, described in the interface's language:
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
  "reattribuer",
  "fusionner",
  "terminer",
  "remote_control",
  "prioritize",
  "stop_mission",
  "move_card",
  "need_user",
]);

/** Internal names of the Manager's own tools. */
export const MANAGER_ONLY = new Set(["move_card", "need_user"]);
/** Internal names of the team's tools the Fleet keeps for a mission run the old way. */
const LEGACY_INTERNAL = new Set(["next_task", "lire_sortie", "ecrire", "prolonger", "interrompre", "reattribuer", "fusionner", "terminer"]);
/** Internal names of the Manager's tools. */
const MANAGER_INTERNAL = new Set(["mission", "add_tasks", "queue", "next_task", "board", "move_card", "equipe", "lire_sortie", "ecrire", "prolonger", "interrompre", "reattribuer", "fusionner", "terminer", "need_user"]);

const json = (value: unknown) => said(JSON.stringify(value, null, 2));
const formed = (mission: Mission) => mission.state === "en_cours" || mission.state === "terminee";

function memberNamed(mission: Mission, raw: unknown): Member | string {
  if (!formed(mission)) return t().fleet.notFormed;
  const name = typeof raw === "string" ? raw : "";
  return mission.members.find((m) => sameName(m.name, name)) ?? t().fleet.notMember(name);
}

function modelOfSubTask(mission: Mission, subtask: { title: string; level?: keyof typeof LEVELS }): string | null {
  const holder = mission.members.find((m) => !m.handedTo && m.task === subtask.title);
  if (holder) return holder.model ? modelLabel(holder.model) : null;
  return mission.router && subtask.level ? LEVELS[subtask.level].modelLabel : null;
}

function describeMission(fleetId: string, mission: Mission): ToolResult {
  const team = new Set(mission.members.map((m) => m.nodeId));
  return json({
    state: outMission(mission.state),
    name: mission.name ?? null,
    task: mission.task ?? null,
    runs: mission.manager ? "manager" : "fleet",
    manager: mission.manager ? managerNameOf(fleetId) : null,
    board: mission.board ?? null,
    away_min: nightMin(mission) ?? null,
    max_agents: mission.maxAgents,
    active_agents: mission.state === "en_cours" ? activeCount(fleetId, mission) : null,
    router: mission.router === true,
    branch: mission.branch ?? null,
    plan:
      mission.plan?.map((s) => ({
        title: s.title,
        brief: s.brief,
        agent: outAgent(s.agent),
        group: s.group?.name ?? null,
        budget_min: s.budgetMin,
        level: s.level ? outLevel(s.level) : null,
        // Once an agent holds the sub-task, its own model counts: reassign may have given it to one that keeps its own.
        model: modelOfSubTask(mission, s),
        card: s.card ?? null,
      })) ?? null,
    linked_agents: canvasKnown(fleetId)
      ? linkedTeamAgents(fleetId)
          .filter((a) => !team.has(a.nodeId))
          .map((a) => ({ name: a.name, state: outAgentState(agentState(a.nodeId)), ...agentGroup(a.nodeId) }))
      : null,
    linked_groups: canvasKnown(fleetId) ? linkedGroups(fleetId).map(({ name, speciality }) => ({ name, speciality })) : null,
    linked_agents_note: canvasKnown(fleetId) ? null : t().fleet.hiddenAgents,
    queue_waiting: mission.queue?.length ?? 0,
    left_min: remainingGlobal(mission, Date.now()) ?? null,
    overnight: mission.overnight === true,
    auto_launch: mission.autoLaunch === true,
    elapsed_min: mission.state === "en_cours" && mission.startedAt !== undefined ? Math.floor((Date.now() - mission.startedAt) / 60_000) : null,
    error: mission.error ?? null,
  });
}

function proposePlan(fleetId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  if (mission.state === "lancement" || mission.state === "en_cours") return refused(t().fleet.running);
  if (mission.state === "terminee") return refused(t().fleet.finished);
  const onCanvas = (s: Record<string, unknown> | null) => !sameName(String(s?.agent ?? ""), NEW_AGENT) || Boolean(s?.groupe);
  const named = Array.isArray(args.sous_taches) && args.sous_taches.some((s) => onCanvas(s as Record<string, unknown> | null));
  if (named && !canvasKnown(fleetId)) return refused(t().fleet.hiddenWorkspace);
  const cards = linkedBoards(fleetId).flatMap(({ board }) => Object.keys(board.cards));
  const result = proposedPlan(args, mission, linkedTeamAgents(fleetId).map((a) => a.name), linkedGroups(fleetId), cards);
  if (typeof result === "string") return refused(result);
  setMission(fleetId, { state: "plan", ...result, error: undefined });
  // The dialog was the go-ahead: the user has left (spec overnight mission §5.1).
  if (mission.overnight && mission.autoLaunch) {
    void launchMission(fleetId);
    return said(t().fleet.launchingNight);
  }
  return said(t().fleet.proposed(result.plan.length, mission.maxAgents));
}

/**
 * `tickets`: dummyPlane reads the source, the fleet may not run commands (spec overnight mission §5.1).
 * It reads in the folder recorded when the team was formed: only before the launch is the live one used.
 */
async function tickets(fleetId: string, mission: Mission): Promise<ToolResult> {
  const project = mission.project || missionFolder(fleetId);
  if (!mission.tickets || !project) return refused(t().fleet.noTickets);
  // Linear's tickets are the fleet's to read, with Linear's own read-only tools.
  if (mission.tickets.kind === "linear") return json({ note: t().fleet.ticketsNote, linear: t().fleet.linearTickets(mission.tickets.team, mission.tickets.label) });
  try {
    return json({ note: t().fleet.ticketsNote, tickets: await readTickets(project, mission.tickets) });
  } catch (error) {
    return refused(t().fleet.ticketsFailed(error instanceof Error ? error.message : String(error)));
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
  const proposed = proposedTasks(args, mission, linkedGroups(fleetId), cards);
  if (typeof proposed === "string") return proposed;
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
function addTasks(fleetId: string, mission: Mission, args: Record<string, unknown>, caller: string = fleetId): ToolResult {
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
  return said(t().fleet.queued(tasks.length, queue.length));
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

/** `stop_mission` (the Fleet): the user wants it stopped. It ends as finish ends it; its Manager is told. */
function stopMission(fleetId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  if (mission.state !== "en_cours") return refused(t().fleet.noMission);
  const reason = typeof args.reason === "string" ? oneLine(args.reason) : "";
  if (!reason) return refused(t().fleet.stopReasonMissing);
  const fleet = fleetNameOf(fleetId);
  endMission(fleetId, t().lines.stopSummary(fleet, reason));
  if (mission.manager) {
    if (mission.board) {
      talk(fleetId, mission.board);
      talk(mission.board, mission.manager);
    }
    notify(mission.manager, t().lines.stoppedBy(fleet, reason));
  }
  return said(t().fleet.missionStopped);
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
  await moveMissionCard(fleetId, cardId, column.id);
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

function describeQueue(fleetId: string, mission: Mission): ToolResult {
  return json({
    waiting: (mission.queue ?? []).map((s) => ({ title: s.title, brief: s.brief, budget_min: s.budgetMin, level: s.level ? outLevel(s.level) : null, group: s.group?.name ?? null, card: s.card ?? null, ...(s.handedBy ? { handed_by: s.handedBy } : {}) })),
    active_agents: activeCount(fleetId, mission),
    max_agents: mission.maxAgents,
  });
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
function describeMissionBoard(fleetId: string): ToolResult {
  const found = missionBoard(fleetId);
  if (!found) return describeBoards(fleetId);
  return json({ note: t().fleet.boardNote, boards: [boardView(found.nodeId, found.board)] });
}

/** `board`: the Kanban boards handed to this fleet. */
function describeBoards(fleetId: string): ToolResult {
  const boards = linkedBoards(fleetId);
  if (boards.length === 0) return said(t().fleet.noBoard);
  return json({ note: t().fleet.boardNote, boards: boards.map(({ nodeId, board }) => boardView(nodeId, board)) });
}

function describeTeam(fleetId: string, mission: Mission): ToolResult {
  if (!formed(mission)) return refused(t().fleet.notFormed);
  const nodes = nodesStore.getState().nodes;
  const now = Date.now();
  // Groups live on the scene: never read, they are unknown, which null would not say.
  const shown = canvasKnown(fleetId);
  return json(
    mission.members.map((m) => ({
      name: m.name,
      ...(shown ? agentGroup(m.nodeId) : {}),
      subtask: m.task,
      state: outAgentState(agentState(m.nodeId)),
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
    })),
  );
}

function readOutput(mission: Mission, args: Record<string, unknown>): ToolResult {
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  const lines = typeof args.lignes === "number" ? Math.min(200, Math.max(1, Math.floor(args.lignes))) : 50;
  return said(terminalText(member.nodeId, lines) || t().fleet.emptyTerminal);
}

async function write(caller: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  const text = typeof args.texte === "string" ? oneLine(args.texte) : "";
  if (!text) return refused(t().fleet.nothingToWrite);
  const activity = agentActivityStore.getState().activities[member.nodeId];
  // An agent that exited leaves its shell: the text would run there as a command.
  if (!isRunning(member.nodeId) || activity?.left) return refused(t().fleet.stopped(member.name));
  if (activity?.activity === "waiting") return refused(t().fleet.waiting(member.name));
  await ptySendText(member.nodeId, text);
  // The message draws its wire if none joins them (a linked agent, a group joiner).
  talk(caller, member.nodeId);
  return said(t().fleet.written(member.name));
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
  // Real time: overnight, its new target must end before the night does (spec overnight mission §3).
  const left = remainingGlobal(mission, Date.now());
  if (left !== undefined && budget - spent > left) return refused(t().fleet.globalLeft(left));
  // Below its new budget it may be told again later; still past it, it is not told twice (spec §8.2).
  const overdue = spent >= 2 * budget ? 2 : spent >= budget ? 1 : undefined;
  updateMember(fleetId, member.nodeId, { extraMin, overdue });
  return said(t().fleet.extended(member.name, minutes, budget));
}

async function interrupt(mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  // The same as "Pause": "Resume all" knows it.
  if ((await pauseAgents([member.nodeId])) === 0) return refused(t().fleet.notWorking(member.name));
  return said(t().fleet.interrupted(member.name));
}

async function reassign(fleetId: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  if (mission.state !== "en_cours") return refused(t().fleet.noMission);
  const title = typeof args.sous_tache === "string" ? args.sous_tache : "";
  const from = mission.members.find((m) => !m.handedTo && sameName(m.task, title));
  if (!from) return refused(t().fleet.noSubtask(title));
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
 * One call of the fleet, by internal name; it acts on its own mission only (spec orchestrateur §4.3). Once a
 * Manager runs its mission, the team's tools are the Manager's: the Fleet babysits the board.
 */
export async function fleetTool(fleetId: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!mission) return refused(t().fleet.gone);
  if (LEGACY_INTERNAL.has(name) && mission.manager) return refused(t().router.managerRuns(managerNameOf(fleetId)));
  if (MANAGER_ONLY.has(name)) return refused(t().router.managerOnly);
  switch (name) {
    case "mission":
      return describeMission(fleetId, mission);
    case "proposer_plan":
      return proposePlan(fleetId, mission, args);
    case "add_tasks":
      return addTasks(fleetId, mission, args);
    case "queue":
      return describeQueue(fleetId, mission);
    case "next_task":
      return nextTask(fleetId, mission, args);
    case "tickets":
      return tickets(fleetId, mission);
    case "equipe":
      return describeTeam(fleetId, mission);
    case "lire_sortie":
      return readOutput(mission, args);
    case "ecrire":
      return write(fleetId, mission, args);
    case "prolonger":
      return prolong(fleetId, mission, args);
    case "interrompre":
      return mission.state === "en_cours" ? interrupt(mission, args) : refused(t().fleet.noMission);
    case "reattribuer":
      return reassign(fleetId, mission, args);
    case "fusionner": {
      if (mission.state !== "en_cours") return refused(t().fleet.noMission);
      const merged = await mergeMission(fleetId);
      // A branch a conflict held back is in now: new agents for the queue start from it.
      void pumpQueue(fleetId);
      return said(merged);
    }
    case "terminer":
      return finish(fleetId, mission, args);
    case "remote_control":
      return remote(fleetId, mission, args);
    case "board":
      return describeBoards(fleetId);
    case "prioritize":
      return prioritize(fleetId, mission, args);
    case "stop_mission":
      return stopMission(fleetId, mission, args);
    default:
      return refused(t().router.unknown(name));
  }
}

/**
 * One call of a mission's Manager, by internal name: it runs its Fleet's mission with the team (spec
 * babysitter Fleet). The same mission tools as the Fleet's of old, plus its board's.
 */
export async function managerTool(managerId: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const fleetId = managedFleet(managerId);
  const mission = fleetId ? missionOf(nodesStore.getState().nodes[fleetId]) : undefined;
  if (!fleetId || !mission) return refused(t().fleet.managerGone);
  if (!MANAGER_INTERNAL.has(name)) return refused(FLEET_ONLY.has(name) ? t().router.fleetOnly : t().router.notForManager);
  switch (name) {
    case "mission":
      return describeMission(fleetId, mission);
    case "add_tasks":
      return addTasks(fleetId, mission, args, managerId);
    case "queue":
      return describeQueue(fleetId, mission);
    case "next_task":
      return nextTask(fleetId, mission, args);
    case "board":
      return describeMissionBoard(fleetId);
    case "move_card":
      return moveCardTool(fleetId, args);
    case "equipe":
      return describeTeam(fleetId, mission);
    case "lire_sortie":
      return readOutput(mission, args);
    case "ecrire":
      return write(managerId, mission, args);
    case "prolonger":
      return prolong(fleetId, mission, args);
    case "interrompre":
      return mission.state === "en_cours" ? interrupt(mission, args) : refused(t().fleet.noMission);
    case "reattribuer":
      return reassign(fleetId, mission, args);
    case "fusionner": {
      if (mission.state !== "en_cours") return refused(t().fleet.noMission);
      const merged = await mergeMission(fleetId);
      void pumpQueue(fleetId);
      return said(merged);
    }
    case "terminer":
      return managerFinish(fleetId, managerId, mission, args);
    case "need_user":
      return needUser(fleetId, managerId, mission, args);
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
