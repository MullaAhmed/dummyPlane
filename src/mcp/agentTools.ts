import { signalWire } from "@/canvas/wireActivity";
import { talk } from "@/agents/talkWires";
import { messages } from "@/i18n";
import { declaredSteps, markedSteps, MAX_STEPS } from "@/nodes/steps";
import { notify } from "@/mission/events";
import { oneLine, type ReportStatus } from "@/mission/mission";
import { finishMissionCard, flagMissionCard } from "@/kanban/fleetBoards";
import { afterReport } from "@/mission/queue";
import { isFleetClosed, memberOf, missionOf, missionRunner, updateMember } from "@/mission/store";
import { spawnAgent } from "@/agents/spawn";
import { markReported, MAX_SPAWN_DEPTH, spawnedByOf } from "@/agents/spawnFamily";
import { onAgentReported } from "@/nodes/terminal/minimize";
import { nodeNameOf, nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { splitGenerated } from "@/openui/detect";
import { agentMessages } from "./messages";
import { outReport, outStep } from "./protocol";

/** What a tool answers: MCP text content, an error the agent can read. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export const said = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
export const refused = (text: string): ToolResult => ({ ...said(text), isError: true });

const t = () => messages(agentMessages);

/** The tools of any Claude session (spec orchestrateur §4.4), described in the interface's language. */
export function agentTools() {
  const d = t().tools;
  return [
    {
      name: "declare_steps",
      description: d.declareSteps,
      inputSchema: {
        type: "object",
        properties: { steps: { type: "array", items: { type: "string", maxLength: 40 }, minItems: 1, maxItems: MAX_STEPS } },
        required: ["steps"],
      },
    },
    {
      name: "step",
      description: d.step,
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, state: { type: "string", enum: ["in_progress", "done", "failed"] } },
        required: ["title", "state"],
      },
    },
    {
      name: "report",
      description: d.report,
      inputSchema: {
        type: "object",
        properties: { summary: { type: "string", description: d.reportSummary }, status: { type: "string", enum: ["done", "blocked", "failed"] }, check: { type: "string", description: d.reportCheck } },
        required: ["summary", "status"],
      },
    },
    spawnAgentSpec(),
  ];
}

/** spawn_agent: an agent's, or a Fleet's (`fleet`), told it is for ad-hoc work beside its mission's queue. */
export function spawnAgentSpec(fleet = false) {
  const d = t().tools;
  return {
    name: "spawn_agent",
    description: (fleet ? d.fleetSpawnAgent : d.spawnAgent)(MAX_SPAWN_DEPTH),
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: d.spawnTask },
        title: { type: "string", maxLength: 60, description: d.spawnTitle },
        model: { type: "string", description: d.spawnModel },
      },
      required: ["task"],
    },
  };
}

/** Internal names of the agents' tools (`./protocol.ts`), linked agents' (`./linkTools.ts`) and outputs' (`./nodeTools.ts`) included; spawn_agent is a Fleet's too. */
export const AGENT_ONLY = new Set(["declarer_etapes", "etape", "rendre_compte", "linked_agents", "message_agent", "read_agent", "hand_off", "show_output"]);

/** Who hears an agent's news over a wire: whoever runs its mission (its Manager, or its Fleet run the old way), else the agent that spawned it. */
const listenerOf = (nodeId: string) => {
  const found = memberOf(nodeId);
  return found ? missionRunner(found.fleetId) : spawnedByOf(nodeId);
};

export function declareSteps(nodeId: string, args: Record<string, unknown>): ToolResult {
  const steps = declaredSteps(args.etapes);
  if (typeof steps === "string") return refused(steps);
  nodesStore.getState().update(nodeId, { steps });
  signalWire(nodeId, "toFleet", listenerOf(nodeId));
  return said(t().agent.declared(steps.length));
}

export function markStep(nodeId: string, args: Record<string, unknown>): ToolResult {
  const current = terminalOf(nodesStore.getState().nodes[nodeId])?.steps ?? [];
  const steps = markedSteps(current, args.titre, args.etat);
  if (typeof steps === "string") return refused(steps);
  nodesStore.getState().update(nodeId, { steps });
  // Its fleet's wire (or its parent's) shows the news coming up, whether or not a mission runs.
  signalWire(nodeId, "toFleet", listenerOf(nodeId));
  const step = steps.find((s) => s.title.toLowerCase() === String(args.titre).trim().toLowerCase())!;
  const state = outStep(step.state);
  return said(t().agent.marked(step.title, state));
}

/** spawn_agent: a sub-agent opens as a terminal beside the caller (`@/agents/spawn`). */
export async function spawnAgentTool(nodeId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const result = await spawnAgent(nodeId, args);
  return result.error ? refused(result.text) : said(result.text);
}

/**
 * A spawned agent's report, typed into the agent or the Fleet that spawned it
 * as a mission report is into its fleet: queued while that one is busy. Null
 * when nobody spawned it.
 */
function reportToParent(nodeId: string, summary: string, status: ReportStatus): ToolResult | null {
  const parentId = spawnedByOf(nodeId);
  if (!parentId) return null;
  const nodes = nodesStore.getState().nodes;
  const name = nodeNameOf(nodes[nodeId]) || "A sub-agent";
  // Its task is done: it no longer counts against the sub-agents at work.
  markReported(nodeId);
  talk(nodeId, parentId);
  if (!sessionOf(nodes[parentId]) || !isRunning(parentId)) return said(t().agent.unheardParent);
  notify(parentId, t().agent.reported(name, outReport(status), oneLine(summary)));
  return said(t().agent.sentToParent(nodeNameOf(nodes[parentId]) || "your parent agent"));
}

/**
 * `report`: inside a mission its fleet hears it (spec §7.5); an agent
 * opened with spawn_agent reports to its parent too; otherwise nobody listens.
 * `ui`: the summary as the agent wrote it in OpenUI Lang, when it did
 * (`reportTool`); `resume` is then its text.
 */
export function report(nodeId: string, args: Record<string, unknown>, ui?: string): ToolResult {
  onAgentReported(nodeId, args.statut, args.resume, ui);
  const found = memberOf(nodeId, { evenClosed: true });
  const spawned = spawnedByOf(nodeId) !== undefined;
  if (!found && !spawned) return said(t().agent.noMission);
  const summary = typeof args.resume === "string" ? args.resume.trim() : "";
  const status = args.statut;
  if (!summary) return refused(t().agent.summarize);
  if (status !== "termine" && status !== "bloque" && status !== "echec") return refused(t().agent.unknownStatus(String(status)));
  // A team agent under its Manager reports once, to its mission: its parent is the one that runs it.
  const runner = found ? missionRunner(found.fleetId) : undefined;
  const toParent = runner !== undefined && spawnedByOf(nodeId) === runner ? null : reportToParent(nodeId, summary, status);
  if (!found) return toParent!;
  // `merge` merges every "done" branch again: a merged one stays so until then (final review H2).
  const check = typeof args.check === "string" ? oneLine(args.check) : "";
  updateMember(found.fleetId, nodeId, { report: { summary, status, at: Date.now(), ...(check ? { check } : {}) } });
  const listener = runner ?? found.fleetId;
  talk(nodeId, listener);
  // Its Kanban card follows: done, or on alert (in "Blocked" on a board a Manager runs).
  const plan = missionOf(nodesStore.getState().nodes[found.fleetId])?.plan;
  if (status === "termine") void finishMissionCard(found.fleetId, plan, found.member.task).catch(() => undefined);
  else void flagMissionCard(found.fleetId, plan, found.member.task, status === "bloque" ? "blocked" : "failed").catch(() => undefined);
  // Queued even when nobody listens: a relaunched or restored Manager or fleet hears it then (final review R3).
  // Under a Manager, the Fleet never hears it: the team's news is the Manager's.
  notify(listener, t().agent.reported(found.member.name, outReport(status), oneLine(summary)));
  // The queue moves on without it: a stopped fleet must not stall the night.
  void afterReport(found.fleetId, nodeId);
  const heard = !isFleetClosed(found.fleetId) && isRunning(listener);
  const toFleet = !heard ? t().agent.unheard : listener === found.fleetId ? t().agent.sent : t().agent.sentToParent(nodeNameOf(nodesStore.getState().nodes[listener]) || "the Manager");
  return said(toParent ? `${toFleet} ${toParent.content[0].text}` : toFleet);
}

/**
 * `report` as an agent calls it: a summary written in OpenUI Lang is kept to
 * be drawn (the edit panel), and passed on as text everywhere a line or plain
 * words go (the fleet's and the parent's terminals, the fleet's tools, a card).
 */
export async function reportTool(nodeId: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (typeof args.resume !== "string") return report(nodeId, args);
  const { text, ui, errors } = await splitGenerated(args.resume.trim());
  // Before anything is recorded: the agent fixes it and reports again.
  if (errors) return refused(t().output.summaryInvalid(errors));
  return report(nodeId, { ...args, resume: text }, ui);
}
