import { talk } from "@/agents/talkWires";
import { AGENTS } from "@/agents/catalog";
import { linkedAgentsOf, type LinkedAgent } from "@/agents/agentLinks";
import { wakeable, wakeFinished, wakingUp } from "@/agents/finishedStop";
import { MAX_TITLE } from "@/agents/spawn";
import { isLaunching, spawnedByOf, unmarkReported } from "@/agents/spawnFamily";
import { clip } from "@/agents/taskSummary";
import { messages } from "@/i18n";
import { notify, sendCommand } from "@/mission/events";
import { oneLine, sameName } from "@/mission/mission";
import { agentState, missionPeers } from "@/mission/store";
import { terminalText } from "@/nodes/terminal/registry";
import { MAX_STORED_TASK, type TerminalPayload } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { isManagerNode, nodesStore, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { refused, said, type ToolResult } from "./agentTools";
import { cutWhole } from "@/lib/cut";
import { fleetNamed, fleetPeers, messageFleet } from "./handOff";
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
        properties: {
          agent: { type: "string", description: d.linkedAgent },
          text: { type: "string", description: d.messageText },
          title: { type: "string", maxLength: MAX_TITLE, description: d.messageTitle },
        },
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

/**
 * The agents `nodeId` reaches: those wired to it, and, in a mission its Manager runs, its Manager and its
 * teammates with no wire yet (`missionPeers`): the first message draws one. Null when its canvas was never
 * read and it has no teammate.
 */
function reachable(nodeId: string): LinkedAgent[] | null {
  const linked = linkedAgentsOf(nodeId);
  const peers = missionPeers(nodeId).filter((id) => id !== nodeId && !linked?.some((a) => a.nodeId === id) && terminalOf(nodesStore.getState().nodes[id]));
  if (linked === null && peers.length === 0) return null;
  return [...(linked ?? []), ...peers.map((id) => ({ nodeId: id, name: nameOf(id), outgoing: false }))];
}

/** The linked agent `raw` names, by id or by name; else why none. */
function linkedNamed(nodeId: string, raw: unknown): LinkedAgent | string {
  const l = t().links;
  const linked = reachable(nodeId);
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
  const linked = reachable(nodeId);
  if (linked === null) return refused(t().links.noCanvas);
  // The Fleet the user wired it to is listed too, relation "fleet": message_agent reaches it, hand_off hands it a task.
  const fleets = fleetPeers(nodeId);
  if (linked.length === 0 && fleets.length === 0) return said(t().links.none);
  return said(
    JSON.stringify(
      [
        ...linked.map((a) => ({ name: a.name, id: a.nodeId, state: outAgentState(agentState(a.nodeId)), relation: relationOf(nodeId, a.nodeId) })),
        ...fleets.map(({ name, id, state, relation }) => ({ name, id, state, relation })),
      ],
      null,
      2,
    ),
  );
}

/**
 * A message to the caller's own sub-agent that reported is new work for it: its terminal, and the duplicate guard,
 * say that work, not the task it finished. Its task becomes the message, kept as spawn_agent keeps one; the title
 * given becomes its title, else its title stays but no longer says what it does (`staleTitle`). Null for any other
 * message: a peer's, or one to a sub-agent still on its task.
 */
function newWork(nodeId: string, peerId: string, text: string, rawTitle: unknown): Partial<TerminalPayload> | null {
  const peer = terminalOf(nodesStore.getState().nodes[peerId]);
  if (!peer || peer.spawnedBy !== nodeId || !peer.lastReport) return null;
  const title = typeof rawTitle === "string" ? clip(oneLine(rawTitle), MAX_TITLE) : "";
  return { task: cutWhole(text, MAX_STORED_TASK), ...(title ? { title, staleTitle: undefined } : { staleTitle: true }) };
}

function messageLinked(nodeId: string, args: Record<string, unknown>): ToolResult {
  const l = t().links;
  const peer = linkedNamed(nodeId, args.agent);
  if (typeof peer === "string") {
    // Not an agent: the Fleet that commands the caller, then; any other name is refused as before.
    const fleetId = fleetNamed(nodeId, args.agent);
    return fleetId ? messageFleet(nodeId, fleetId, args.text) : refused(peer);
  }
  const text = typeof args.text === "string" ? oneLine(args.text) : "";
  if (!text) return refused(l.nothingToSend);
  // A finished agent dummyPlane stopped to free its memory, or starting again already: the message waits for its
  // session, typed earlier it would land in its shell (`@/agents/finishedStop`).
  const asleep = wakingUp(peer.nodeId) !== undefined || wakeable(peer.nodeId, nodeId);
  if (!asleep && !isRunning(peer.nodeId)) return refused(l.stopped(peer.name));
  // A sub-agent just spawned runs its shell before its Claude: the line would run there as a command.
  if (!asleep && isLaunching(peer.nodeId)) return refused(l.starting(peer.name));
  // Before the message is typed: typing it clears the report that says its last task is done (`onNewWork`).
  const work = newWork(nodeId, peer.nodeId, text, args.title);
  if (work) {
    nodesStore.getState().update(peer.nodeId, work);
    // Its report freed its seat for the app's run; working again, it takes one.
    unmarkReported(peer.nodeId);
  }
  const send = () => {
    // A Manager answers its team with write: it has no message_agent.
    notify(peer.nodeId, isManagerNode(peer.nodeId) ? l.toManager(nameOf(nodeId), text) : l.message(nameOf(nodeId), text));
    // Its Claude session, named after its title at its launch (`-n`), takes the new one: the name other sessions see.
    // After the message, in line with it: whatever the command leaves on screen can never swallow the work itself,
    // and `/rename` runs at once even while Claude works on it.
    if (work?.title && terminalOf(nodesStore.getState().nodes[peer.nodeId])?.agent === "claude") sendCommand(peer.nodeId, `/rename ${work.title}`);
  };
  if (asleep) {
    // Answered now: its session may take longer to open than the call may last.
    const woken = wakingUp(peer.nodeId) ?? wakeFinished(peer.nodeId, () => notify(nodeId, l.wakeSlow(peer.name)));
    void woken.then((ready) => (ready ? send() : notify(nodeId, l.notWoken(peer.name))));
    talk(nodeId, peer.nodeId);
    return said(l.waking(peer.name));
  }
  send();
  // The message draws its wire when none joins them yet, and the light runs along it from the sender.
  talk(nodeId, peer.nodeId);
  const waiting = agentActivityStore.getState().activities[peer.nodeId]?.activity === "waiting";
  return said(waiting ? l.held(peer.name) : l.sent(peer.name));
}

function readLinked(nodeId: string, args: Record<string, unknown>): ToolResult {
  const peer = linkedNamed(nodeId, args.agent);
  // The Fleet that commands the caller is listed, but its screen is the user's: message_agent and hand_off reach it.
  if (typeof peer === "string") return refused(fleetNamed(nodeId, args.agent) ? t().handOff.fleetNotRead : peer);
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
