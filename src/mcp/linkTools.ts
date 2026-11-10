import { signalWire } from "@/canvas/wireActivity";
import { AGENTS } from "@/agents/catalog";
import { linkedAgentsOf, type LinkedAgent } from "@/agents/agentLinks";
import { isLaunching, spawnedByOf } from "@/agents/spawnFamily";
import { messages } from "@/i18n";
import { notify } from "@/mission/events";
import { oneLine, sameName } from "@/mission/mission";
import { agentState } from "@/mission/store";
import { terminalText } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { refused, said, type ToolResult } from "./agentTools";
import { agentMessages } from "./messages";
import { outAgentState } from "./protocol";

/**
 * The tools of two agents linked by a wire (`@/agents/agentLinks`): list, message
 * and read each other, either way round, with no fleet. A message goes
 * through the same line queue as a sub-agent's report (`notify`): it waits while
 * a dialog is open in the receiving terminal, so it never answers one.
 */

const t = () => messages(agentMessages);

/** Their specs, after the agent's own tools (`./agentTools.ts`). */
export function linkTools() {
  const d = t().tools;
  return [
    { name: "linked_agents", description: d.linkedAgents, inputSchema: { type: "object", properties: {} } },
    {
      name: "message_agent",
      description: d.messageAgent,
      inputSchema: {
        type: "object",
        properties: { agent: { type: "string", description: d.linkedAgent }, text: { type: "string", description: d.messageText } },
        required: ["agent", "text"],
      },
    },
    {
      name: "read_agent",
      description: d.readAgent,
      inputSchema: {
        type: "object",
        properties: { agent: { type: "string", description: d.linkedAgent }, lines: { type: "integer", minimum: 1, maximum: 200, description: d.readLines } },
        required: ["agent"],
      },
    },
  ];
}

const nameOf = (nodeId: string) => {
  const payload = terminalOf(nodesStore.getState().nodes[nodeId]);
  return payload ? payload.name || AGENTS[payload.agent].label : "An agent";
};

/** How a linked agent stands to the caller: the one that spawned it, one it spawned, or a plain link. */
function relationOf(nodeId: string, peerId: string): string {
  if (spawnedByOf(nodeId) === peerId) return "parent";
  if (spawnedByOf(peerId) === nodeId) return "sub-agent";
  return "linked";
}

/** The linked agent `raw` names, by id or by name; else why none. */
function linkedNamed(nodeId: string, raw: unknown): LinkedAgent | string {
  const l = t().links;
  const linked = linkedAgentsOf(nodeId);
  if (linked === null) return l.noCanvas;
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return l.whom;
  if (linked.length === 0) return l.none;
  const byId = linked.find((a) => a.nodeId === name);
  if (byId) return byId;
  const found = linked.filter((a) => sameName(a.name, name));
  if (found.length > 1) return l.ambiguous(name, found.map((a) => a.nodeId).join(", "));
  return found[0] ?? l.notLinked(name, linked.map((a) => a.name).join(", "));
}

function listLinked(nodeId: string): ToolResult {
  const linked = linkedAgentsOf(nodeId);
  if (linked === null) return refused(t().links.noCanvas);
  if (linked.length === 0) return said(t().links.none);
  return said(
    JSON.stringify(
      linked.map((a) => ({ name: a.name, id: a.nodeId, state: outAgentState(agentState(a.nodeId)), relation: relationOf(nodeId, a.nodeId) })),
      null,
      2,
    ),
  );
}

function messageLinked(nodeId: string, args: Record<string, unknown>): ToolResult {
  const l = t().links;
  const peer = linkedNamed(nodeId, args.agent);
  if (typeof peer === "string") return refused(peer);
  const text = typeof args.text === "string" ? oneLine(args.text) : "";
  if (!text) return refused(l.nothingToSend);
  if (!isRunning(peer.nodeId)) return refused(l.stopped(peer.name));
  // A sub-agent just spawned runs its shell before its Claude: the line would run there as a command.
  if (isLaunching(peer.nodeId)) return refused(l.starting(peer.name));
  notify(peer.nodeId, l.message(nameOf(nodeId), text));
  // The light runs along the wire from the sender: a pulse on the wire's end, naming its start.
  if (peer.outgoing) signalWire(peer.nodeId, "toAgent", nodeId);
  else signalWire(nodeId, "toFleet", peer.nodeId);
  const waiting = agentActivityStore.getState().activities[peer.nodeId]?.activity === "waiting";
  return said(waiting ? l.held(peer.name) : l.sent(peer.name));
}

function readLinked(nodeId: string, args: Record<string, unknown>): ToolResult {
  const peer = linkedNamed(nodeId, args.agent);
  if (typeof peer === "string") return refused(peer);
  // As the fleet's read_output reads a mission agent.
  const lines = typeof args.lines === "number" ? Math.min(200, Math.max(1, Math.floor(args.lines))) : 50;
  return said(terminalText(peer.nodeId, lines) || t().links.emptyTerminal);
}

/** One call of a linked agent's tools, by name; null when `name` is none of them. */
export function linkTool(nodeId: string, name: string, args: Record<string, unknown>): ToolResult | null {
  switch (name) {
    case "linked_agents":
      return listLinked(nodeId);
    case "message_agent":
      return messageLinked(nodeId, args);
    case "read_agent":
      return readLinked(nodeId, args);
    default:
      return null;
  }
}
