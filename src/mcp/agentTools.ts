import { signalWire } from "@/canvas/wireActivity";
import { messages } from "@/i18n";
import { declaredSteps, markedSteps, MAX_STEPS } from "@/nodes/steps";
import { notify } from "@/mission/events";
import { oneLine, type ReportStatus } from "@/mission/mission";
import { finishMissionCard, flagMissionCard } from "@/kanban/orchestrate";
import { afterReport } from "@/mission/queue";
import { isOrchestratorClosed, memberOf, missionOf, updateMember } from "@/mission/store";
import { spawnAgent } from "@/fleet/spawn";
import { markReported, MAX_SPAWN_DEPTH, spawnedByOf } from "@/fleet/spawnFamily";
import { onAgentReported } from "@/nodes/terminal/minimize";
import { nodeNameOf, nodesStore, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
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

/** The tools of any Claude session (spec orchestrator §4.4), described in the interface's language. */
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
        properties: { summary: { type: "string" }, status: { type: "string", enum: ["done", "blocked", "failed"] }, check: { type: "string", description: d.reportCheck } },
        required: ["summary", "status"],
      },
    },
    {
      name: "spawn_agent",
      description: d.spawnAgent(MAX_SPAWN_DEPTH),
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: d.spawnTask },
          title: { type: "string", maxLength: 60, description: d.spawnTitle },
          model: { type: "string", description: d.spawnModel },
        },
        required: ["task"],
      },
    },
  ];
}

/** Internal names of the agents' tools (`./protocol.ts`). */
export const AGENT_ONLY = new Set(["declarer_etapes", "etape", "rendre_compte", "spawn_agent"]);

/** Who hears an agent's news over a wire: its mission's orchestrator, else the agent that spawned it. */
const listenerOf = (nodeId: string) => memberOf(nodeId)?.orchestratorId ?? spawnedByOf(nodeId);

export function declareSteps(nodeId: string, args: Record<string, unknown>): ToolResult {
  const steps = declaredSteps(args.etapes);
  if (typeof steps === "string") return refused(steps);
  nodesStore.getState().update(nodeId, { steps });
  signalWire(nodeId, "toOrchestrator", listenerOf(nodeId));
  return said(t().agent.declared(steps.length));
}

export function markStep(nodeId: string, args: Record<string, unknown>): ToolResult {
  const current = terminalOf(nodesStore.getState().nodes[nodeId])?.steps ?? [];
  const steps = markedSteps(current, args.titre, args.etat);
  if (typeof steps === "string") return refused(steps);
  nodesStore.getState().update(nodeId, { steps });
  // Its orchestrator's wire (or its parent's) shows the news coming up, whether or not a mission runs.
  signalWire(nodeId, "toOrchestrator", listenerOf(nodeId));
  const step = steps.find((s) => s.title.toLowerCase() === String(args.titre).trim().toLowerCase())!;
  const state = outStep(step.state);
  return said(t().agent.marked(step.title, state));
}

/** spawn_agent: a sub-agent opens as a terminal beside the caller (`@/fleet/spawn`). */
export async function spawnAgentTool(nodeId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const result = await spawnAgent(nodeId, args);
  return result.error ? refused(result.text) : said(result.text);
}

/**
 * A spawned agent's report, typed into the agent that spawned it as a mission
 * report is into its orchestrator: queued while that one is busy. Null when
 * nobody spawned it.
 */
function reportToParent(nodeId: string, summary: string, status: ReportStatus): ToolResult | null {
  const parentId = spawnedByOf(nodeId);
  if (!parentId) return null;
  const nodes = nodesStore.getState().nodes;
  const name = nodeNameOf(nodes[nodeId]) || "A sub-agent";
  // Its task is done: it no longer counts against the sub-agents at work.
  markReported(nodeId);
  signalWire(nodeId, "toOrchestrator", parentId);
  if (!terminalOf(nodes[parentId]) || !isRunning(parentId)) return said(t().agent.unheardParent);
  notify(parentId, t().agent.reported(name, outReport(status), oneLine(summary)));
  return said(t().agent.sentToParent(nodeNameOf(nodes[parentId]) || "your parent agent"));
}

/**
 * `report`: inside a mission its orchestrator hears it (spec §7.5); an agent
 * opened with spawn_agent reports to its parent too; otherwise nobody listens.
 */
export function report(nodeId: string, args: Record<string, unknown>): ToolResult {
  onAgentReported(nodeId, args.statut, args.resume);
  const found = memberOf(nodeId, { evenClosed: true });
  const spawned = spawnedByOf(nodeId) !== undefined;
  if (!found && !spawned) return said(t().agent.noMission);
  const summary = typeof args.resume === "string" ? args.resume.trim() : "";
  const status = args.statut;
  if (!summary) return refused(t().agent.summarize);
  if (status !== "termine" && status !== "bloque" && status !== "echec") return refused(t().agent.unknownStatus(String(status)));
  const toParent = reportToParent(nodeId, summary, status);
  if (!found) return toParent!;
  // `merge` merges every "done" branch again: a merged one stays so until then (final review H2).
  const check = typeof args.check === "string" ? oneLine(args.check) : "";
  updateMember(found.orchestratorId, nodeId, { report: { summary, status, at: Date.now(), ...(check ? { check } : {}) } });
  signalWire(nodeId, "toOrchestrator", found.orchestratorId);
  // Its Kanban card follows: done, or on alert in "In progress".
  const plan = missionOf(nodesStore.getState().nodes[found.orchestratorId])?.plan;
  if (status === "termine") void finishMissionCard(found.orchestratorId, plan, found.member.task).catch(() => undefined);
  else flagMissionCard(found.orchestratorId, plan, found.member.task, status === "bloque" ? "blocked" : "failed");
  // Queued even when nobody listens: a relaunched or restored orchestrator hears it then (final review R3).
  notify(found.orchestratorId, t().agent.reported(found.member.name, outReport(status), oneLine(summary)));
  // The queue moves on without it: a stopped orchestrator must not stall the night.
  void afterReport(found.orchestratorId, nodeId);
  const toOrchestrator = isOrchestratorClosed(found.orchestratorId) || !isRunning(found.orchestratorId) ? t().agent.unheard : t().agent.sent;
  return said(toParent ? `${toOrchestrator} ${toParent.content[0].text}` : toOrchestrator);
}
