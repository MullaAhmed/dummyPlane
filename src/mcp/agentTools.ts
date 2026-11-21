import { signalWire } from "@/canvas/wireActivity";
import { missionRunsBoard, wiredBoardsOf } from "@/agents/boardLinks";
import { talk } from "@/agents/talkWires";
import { messages } from "@/i18n";
import { declaredSteps, markedSteps, MAX_STEPS } from "@/nodes/steps";
import { notify } from "@/mission/events";
import { oneLine, type Member, type Report, type ReportStatus } from "@/mission/mission";
import { adHocReported } from "@/kanban/adHocCards";
import { flagMissionCard, reportedMissionCard } from "@/kanban/fleetBoards";
import { deliveryPending } from "@/mission/launch";
import { afterReport } from "@/mission/queue";
import { LEVELS } from "@/mission/router";
import { trackChildReport } from "@/mission/stalls";
import { isFleetClosed, memberOf, missionOf, missionRunner, unsentMemberOf, updateMember } from "@/mission/store";
import { EXTRA_ARGS, listExtras, missingExtras, REQUIRED_EXTRA_KINDS, spawnAgent } from "@/agents/spawn";
import { followChildReport } from "@/agents/carriedSteps";
import { markReported, MAX_SPAWN_DEPTH, spawnedByOf } from "@/agents/spawnFamily";
import { WORK_KINDS } from "@/agents/spawnModel";
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

/** The tools of any Claude session, described in the interface's language. */
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
    installedExtrasSpec(),
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
        level: { type: "string", enum: Object.values(LEVELS).map((l) => l.label), description: d.spawnLevel },
        skills: { type: "array", items: { type: "string" }, description: d.spawnSkills },
        mcp_servers: { type: "array", items: { type: "string" }, description: d.spawnMcpServers },
        plugins: { type: "array", items: { type: "string" }, description: d.spawnPlugins },
        // An agent's only: a Fleet splits its work through its mission, and its sub-agent does the work. kind too: a
        // Fleet's ad-hoc sub-agents are lookups and checks, held to low or medium while its mission runs.
        ...(fleet
          ? {}
          : {
              role: { type: "string", enum: ["manager"], description: d.spawnRole },
              step: { type: "string", maxLength: 40, description: d.spawnStep },
              kind: { type: "string", enum: [...WORK_KINDS], description: d.spawnKind },
            }),
      },
      // Every kind of a pick, the spawner's choice for this task (`[]` for none): none is left to the CLI's defaults.
      required: ["task", ...REQUIRED_EXTRA_KINDS.map((kind) => EXTRA_ARGS[kind])],
    },
  };
}

/** installed_extras: what spawn_agent's skills, mcp_servers and plugins can name, for the CLI a sub-agent of the caller runs. */
export function installedExtrasSpec() {
  return { name: "installed_extras", description: t().tools.installedExtras, inputSchema: { type: "object", properties: {}, required: [] as string[] } };
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

/** installed_extras: the skills, MCP servers and plugins a sub-agent of the caller could be given (`@/agents/spawn`). */
export async function installedExtrasTool(nodeId: string): Promise<ToolResult> {
  const result = await listExtras(nodeId);
  return result.error ? refused(result.text) : said(result.text);
}

/**
 * spawn_agent: a sub-agent opens as a terminal beside the caller (`@/agents/spawn`). The call must pick every kind
 * (`REQUIRED_EXTRA_KINDS`) even though the schema says so: a session keeps the tool list it read at its start, and a
 * model may ignore it. Refused first, naming what is missing: nothing is read or opened.
 */
export async function spawnAgentTool(nodeId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const missing = missingExtras(args);
  if (missing) return refused(missing);
  const result = await spawnAgent(nodeId, args);
  return result.error ? refused(result.text) : said(result.text);
}

/**
 * What a manager hears besides a sub-agent's report when a Kanban board is wired to it (one a mission does not run:
 * its Manager's cards follow the reports by themselves): the card is its to move, and where. Nothing for a parent
 * with no board, or whose scene was never read.
 */
function boardNote(parentId: string, status: ReportStatus): string {
  const boards = wiredBoardsOf(parentId);
  if (!boards?.some(({ nodeId }) => !missionRunsBoard(nodeId))) return "";
  return ` — ${t().agent.boardNote(outReport(status))}`;
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
  // The step of its parent's frieze it carried follows its report.
  followChildReport(nodeId, status);
  talk(nodeId, parentId);
  if (!sessionOf(nodes[parentId]) || !isRunning(parentId)) return said(t().agent.unheardParent);
  // Typed, it is watched: a parent that compacted while idle may never take it up (`@/mission/stalls`).
  notify(parentId, `${t().agent.reported(name, outReport(status), oneLine(summary))}${boardNote(parentId, status)}`, () =>
    trackChildReport(parentId, name, outReport(status), oneLine(summary)),
  );
  return said(t().agent.sentToParent(nodeNameOf(nodes[parentId]) || "your parent agent"));
}

/**
 * A member's report as the mission's record, its Kanban card following: "Reported, not merged" on "done" (Done is the
 * merge's), on alert on "blocked" or "failed" (in "Blocked" on a board a Manager runs). The agent's own `report`, and a
 * Manager recording the work of an agent that finished without reporting (`merge` with agent) both come here: the same
 * seat freed, the same card, the same queue (`afterReport`, the caller's).
 */
export function recordMemberReport(fleetId: string, member: Pick<Member, "nodeId" | "task">, report: Report, patch: Partial<Member> = {}) {
  updateMember(fleetId, member.nodeId, { report, ...patch });
  const plan = missionOf(nodesStore.getState().nodes[fleetId])?.plan;
  if (report.status === "termine") void reportedMissionCard(fleetId, plan, member.task).catch(() => undefined);
  else void flagMissionCard(fleetId, plan, member.task, report.status === "bloque" ? "blocked" : "failed").catch(() => undefined);
}

/**
 * `report`: inside a mission its fleet hears it; an agent
 * opened with spawn_agent reports to its parent too; otherwise nobody listens.
 * `ui`: the summary as the agent wrote it in OpenUI Lang, when it did
 * (`reportTool`); `resume` is then its text.
 */
export function report(nodeId: string, args: Record<string, unknown>, ui?: string): ToolResult {
  onAgentReported(nodeId, args.statut, args.resume, ui);
  // A sub-task dummyPlane gave up typing and another hand gave (its Manager's `write`, the user's paste, a
  // `message_agent`) is the agent's all the same: its report is the mission's, or `merge` finds nobody done, its seat
  // stays held and the queue stalls (12 Nov, wt-be-upload-land: 4 agents, the report "passed on" to a Manager that
  // never recorded it). Not while dummyPlane still means to type it: a word of the agent's last sub-task, then.
  const sent = memberOf(nodeId, { evenClosed: true });
  const unsent = sent || deliveryPending(nodeId) ? null : unsentMemberOf(nodeId);
  const found = sent ?? unsent;
  const spawned = spawnedByOf(nodeId) !== undefined;
  if (!found && !spawned) return said(t().agent.noMission);
  const summary = typeof args.resume === "string" ? args.resume.trim() : "";
  const status = args.statut;
  if (!summary) return refused(t().agent.summarize);
  if (status !== "termine" && status !== "bloque" && status !== "echec") return refused(t().agent.unknownStatus(String(status)));
  // An agent its Fleet opened beside the plan has a card on the mission's board: it follows (none for any other agent).
  void adHocReported(nodeId, status).catch(() => undefined);
  // A team agent under its Manager reports once, to its mission: its parent is the one that runs it.
  const runner = found ? missionRunner(found.fleetId) : undefined;
  const toParent = runner !== undefined && spawnedByOf(nodeId) === runner ? null : reportToParent(nodeId, summary, status);
  if (!found) return toParent!;
  // `merge` merges every "done" branch again: a merged one stays so until then (final review H2).
  const check = typeof args.check === "string" ? oneLine(args.check) : "";
  // Its text is dropped with its delivery: a restart of its terminal would type it on top of what it did since.
  const at = Date.now();
  recordMemberReport(found.fleetId, found.member, { summary, status, at, ...(check ? { check } : {}) }, unsent ? { sentAt: at, brief: undefined } : {});
  const listener = runner ?? found.fleetId;
  talk(nodeId, listener);
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
