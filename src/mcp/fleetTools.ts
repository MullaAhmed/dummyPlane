import { signalWire } from "@/canvas/wireActivity";
import { pauseAgents } from "@/agents/broadcast";
import { setRemoteControl } from "@/agents/remoteControl";
import { messages } from "@/i18n";
import { ptySendText } from "@/ipc/pty";
import { missionFolder } from "@/mission/folder";
import { endMission, launchMission, mergeMission, reassignTask } from "@/mission/launch";
import { budgetOf, memberTime, NEW_AGENT, nightMin, oneLine, proposedPlan, proposedTasks, remainingGlobal, sameName, spentMin, type Member, type Mission } from "@/mission/mission";
import { activeCount } from "@/mission/active";
import { giveNext, pumpQueue } from "@/mission/queue";
import { boardView } from "@/kanban/missionLink";
import { LEVELS, modelLabel } from "@/mission/router";
import { readTickets } from "@/mission/tickets";
import { linkedBoards } from "@/kanban/fleetBoards";
import { agentGroup, agentState, linkedTeamAgents, linkedGroups, missionOf, canvasKnown, setMission, updateMember } from "@/mission/store";
import { terminalText } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { refused, said, type ToolResult } from "./agentTools";
import { agentMessages } from "./messages";
import { outAgent, outAgentState, outLevel, outMission, outReport, outStep } from "./protocol";

const NO_ARGS = { type: "object", properties: {} } as const;
const t = () => messages(agentMessages);

/** The fleet's tools (spec orchestrateur §7.2), named in English, described in the interface's language. */
export function fleetTools() {
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
    { name: "next_task", description: d.nextTask, inputSchema: { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] } },
    { name: "tickets", description: d.tickets, inputSchema: NO_ARGS },
    { name: "board", description: d.board, inputSchema: NO_ARGS },
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
      description: d.finish,
      inputSchema: { type: "object", properties: { summary: { type: "string" }, check: { type: "array", items: { type: "string" }, description: d.finishCheck } }, required: ["summary"] },
    },
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

/** Internal names of the fleet's tools (`./protocol.ts`). */
export const FLEET_ONLY = new Set(["mission", "proposer_plan", "add_tasks", "queue", "next_task", "tickets", "board", "equipe", "lire_sortie", "ecrire", "prolonger", "interrompre", "reattribuer", "fusionner", "terminer", "remote_control"]);

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

function addTasks(fleetId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  if (mission.state === "terminee") return refused(t().fleet.finished);
  const grouped = Array.isArray(args.tasks) && args.tasks.some((s) => Boolean((s as Record<string, unknown> | null)?.groupe));
  if (grouped && !canvasKnown(fleetId)) return refused(t().fleet.hiddenWorkspace);
  const cards = linkedBoards(fleetId).flatMap(({ board }) => Object.keys(board.cards));
  const tasks = proposedTasks(args, mission, linkedGroups(fleetId), cards);
  if (typeof tasks === "string") return refused(tasks);
  const queue = [...(mission.queue ?? []), ...tasks];
  setMission(fleetId, { queue });
  void pumpQueue(fleetId);
  return said(t().fleet.queued(tasks.length, queue.length));
}

function describeQueue(fleetId: string, mission: Mission): ToolResult {
  return json({
    waiting: (mission.queue ?? []).map((s) => ({ title: s.title, brief: s.brief, budget_min: s.budgetMin, level: s.level ? outLevel(s.level) : null, group: s.group?.name ?? null, card: s.card ?? null })),
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

async function write(fleetId: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  const text = typeof args.texte === "string" ? oneLine(args.texte) : "";
  if (!text) return refused(t().fleet.nothingToWrite);
  if (!isRunning(member.nodeId)) return refused(t().fleet.stopped(member.name));
  if (agentActivityStore.getState().activities[member.nodeId]?.activity === "waiting") return refused(t().fleet.waiting(member.name));
  await ptySendText(member.nodeId, text);
  signalWire(member.nodeId, "toAgent", fleetId);
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

function finish(fleetId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  if (mission.state !== "en_cours") return refused(t().fleet.noMission);
  const summary = typeof args.bilan === "string" ? args.bilan.trim() : "";
  if (!summary) return refused(t().fleet.summaryMissing);
  const handChecks = Array.isArray(args.check) ? args.check.filter((line): line is string => typeof line === "string" && line.trim() !== "").map(oneLine) : [];
  if (handChecks.length > 0) setMission(fleetId, { handChecks });
  endMission(fleetId, summary);
  return said(t().fleet.ended);
}

/** Its team as `remote_control` names it: the linked Claude agents and the mission's members. */
function teamOf(fleetId: string, mission: Mission): { nodeId: string; name: string }[] {
  const team = canvasKnown(fleetId) ? linkedTeamAgents(fleetId) : [];
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

/** One call of the fleet, by internal name; it acts on its own mission only (spec orchestrateur §4.3). */
export async function fleetTool(fleetId: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!mission) return refused(t().fleet.gone);
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
    default:
      return refused(t().router.unknown(name));
  }
}
