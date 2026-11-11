import { messages } from "@/i18n";
import { mcpReply, onMcpCall, type McpCall } from "@/ipc/mcp";
import { notesTool, notesToolSpec } from "@/notes/agentTool";
import { nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { AGENT_ONLY, agentTools, declareSteps, markStep, refused, report, spawnAgentTool } from "./agentTools";
import { linkTool, linkTools } from "./linkTools";
import { outputGuideTool, outputTools, readNodeSpec, readNodeTool, showOutputTool } from "./nodeTools";
import { agentMessages } from "./messages";
import { FLEET_ONLY, fleetTool, fleetTools } from "./fleetTools";
import { internalCall, RENAMED } from "./protocol";

const t = () => messages(agentMessages).router;

/** The interface's answer to one MCP call of a node, by its kind (spec orchestrateur §4.1, §4.3). */
export async function answer(call: McpCall): Promise<unknown> {
  const record = nodesStore.getState().nodes[call.nodeId];
  const fleet = record?.kind === "fleet";
  if (call.method === "tools/list") {
    // Remote Control is Claude's: a fleet on another CLI is not offered it.
    const claude = sessionOf(record)?.agent !== "codex";
    const own = fleet ? fleetTools().filter((tool) => claude || tool.name !== "remote_control") : [...agentTools(), ...linkTools(), ...outputTools()];
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
  if (fleet) return AGENT_ONLY.has(name) ? refused(t().agentsOnly) : fleetTool(call.nodeId, name, args);
  if (!terminalOf(record)) return refused(t().gone);
  if (FLEET_ONLY.has(name)) return refused(t().fleetOnly);
  switch (name) {
    case "declarer_etapes":
      return declareSteps(call.nodeId, args);
    case "etape":
      return markStep(call.nodeId, args);
    case "rendre_compte":
      return report(call.nodeId, args);
    case "spawn_agent":
      return spawnAgentTool(call.nodeId, args);
    case "show_output":
      return showOutputTool(call.nodeId, args);
    case "output_guide":
      return outputGuideTool();
    default:
      return linkTool(call.nodeId, name, args) ?? refused(t().unknown(asked));
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
