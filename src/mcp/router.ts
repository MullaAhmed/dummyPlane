import { messages } from "@/i18n";
import { mcpReply, onMcpCall, type McpCall } from "@/ipc/mcp";
import { notesTool, notesToolSpec } from "@/notes/agentTool";
import { missionOf } from "@/mission/store";
import { isManagerRecord, nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { AGENT_ONLY, agentTools, declareSteps, markStep, refused, reportTool, spawnAgentSpec, spawnAgentTool } from "./agentTools";
import { BOARD_TOOLS, boardTool, boardTools } from "./boardTools";
import { linkTool, linkTools } from "./linkTools";
import { outputGuideSpec, outputGuideTool, outputTools, readNodeSpec, readNodeTool, showOutputTool } from "./nodeTools";
import { agentMessages } from "./messages";
import { FLEET_ONLY, fleetTool, fleetTools, MANAGER_ONLY, managerTool, managerTools, runsTheOldWay } from "./fleetTools";
import { internalCall, RENAMED } from "./protocol";

const t = () => messages(agentMessages).router;

/**
 * The interface's answer to one MCP call of a node, by its kind and role (spec orchestrateur §4.1, §4.3):
 * a Fleet plans and babysits its board, a mission's Manager runs the board with the team, an agent works.
 */
export async function answer(call: McpCall): Promise<unknown> {
  const record = nodesStore.getState().nodes[call.nodeId];
  const fleet = record?.kind === "fleet";
  const manager = isManagerRecord(record);
  if (call.method === "tools/list") {
    // Remote Control is Claude's: a fleet on another CLI is not offered it. spawn_agent is every session's but the
    // Manager's (its team starts from the queue), as listed once per session. The team's tools are a Fleet's only
    // while it runs a mission launched before Managers existed.
    const claude = sessionOf(record)?.agent !== "codex";
    const own = fleet
      ? [...fleetTools({ legacy: runsTheOldWay(missionOf(record)), claude }), spawnAgentSpec(true), ...boardTools(), outputGuideSpec()]
      : manager
        ? [...managerTools(), outputGuideSpec()]
        : [...agentTools(), ...linkTools(), ...boardTools(), ...outputTools()];
    return { tools: [...own, readNodeSpec(), notesToolSpec()] };
  }
  const asked = String(call.params.name ?? "");
  const { name, args } = internalCall(asked, (call.params.arguments ?? {}) as Record<string, unknown>);
  // A conversation resumed from before the English names may still call a former one.
  if (!name) return refused(Object.prototype.hasOwnProperty.call(RENAMED, asked) ? t().renamed(RENAMED[asked]) : t().unknown(asked));
  // Read-only and for all: the caller's project comes from the base, it may not be the one on screen.
  if (name === "notes") return notesTool(call.nodeId, fleet, args);
  // A link the user pasted is theirs to hand over: any agent, any fleet reads it, with no wire.
  if (name === "read_node") return readNodeTool(args);
  // A fleet writes its summary in OpenUI Lang too (finish): the guide is for all.
  if (name === "output_guide") return outputGuideTool();
  // A Fleet's sub-agent is a regular agent in its own terminal, for work beside its mission's queue.
  if (fleet && name === "spawn_agent") return spawnAgentTool(call.nodeId, args);
  // The boards the user wired to an agent or a Fleet: theirs to read, and to add cards to or move them on (refused on a mission's own).
  if (fleet && BOARD_TOOLS.has(name)) return boardTool(call.nodeId, name, args) ?? refused(t().unknown(asked));
  if (fleet) return AGENT_ONLY.has(name) ? refused(t().agentsOnly) : fleetTool(call.nodeId, name, args);
  // Before any agent's tool: a Manager neither reports nor spawns, its team's agents start from the queue.
  if (manager) return managerTool(call.nodeId, name, args);
  if (!terminalOf(record)) return refused(t().gone);
  if (MANAGER_ONLY.has(name)) return refused(t().managerOnly);
  if (FLEET_ONLY.has(name)) return refused(t().fleetOnly);
  switch (name) {
    case "declarer_etapes":
      return declareSteps(call.nodeId, args);
    case "etape":
      return markStep(call.nodeId, args);
    case "rendre_compte":
      return reportTool(call.nodeId, args);
    case "spawn_agent":
      return spawnAgentTool(call.nodeId, args);
    case "show_output":
      return showOutputTool(call.nodeId, args);
    default:
      return linkTool(call.nodeId, name, args) ?? boardTool(call.nodeId, name, args) ?? refused(t().unknown(asked));
  }
}

/** A handler slower than this is logged: Rust gives up on a call after 30 s ("dummyPlane is not responding"). */
const SLOW_MS = 2000;

/** What Rust can take as a reply: JSON. `undefined` or a cycle would make `mcp_reply` itself fail, and the call time out. */
export function replyable(result: unknown): unknown {
  try {
    if (result !== undefined && JSON.stringify(result) !== undefined) return result;
  } catch (error) {
    return refused(t().failed(String(error)));
  }
  return refused(t().failed("empty answer"));
}

/** One call, always answered: a failure of the tool, of its answer's shape, or of the reply itself included. */
export async function handleCall(call: McpCall, reply: (callId: number, result: unknown) => Promise<void> = mcpReply) {
  const started = Date.now();
  let result: unknown;
  try {
    result = await answer(call);
  } catch (error) {
    result = refused(t().failed(String(error)));
  }
  const took = Date.now() - started;
  if (took > SLOW_MS) console.warn(`mcp ${call.method} ${String(call.params.name ?? "")} for ${call.nodeId} took ${took} ms`);
  try {
    await reply(call.callId, replyable(result));
  } catch (error) {
    // A reply that failed is tried once more, in a form that cannot fail on its content.
    console.error(`mcp reply ${call.callId} failed`, error);
    await reply(call.callId, refused(t().failed(String(error)))).catch((again: unknown) => console.error(`mcp reply ${call.callId} lost`, again));
  }
}

/** For the app's whole life: every call gets an answer, a failure included. */
export async function installMcp() {
  await onMcpCall((call) => void handleCall(call));
}
