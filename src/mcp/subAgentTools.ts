import { toast } from "sonner";
import { logInfo } from "@/app/log";
import { AGENTS } from "@/agents/catalog";
import { dialogOf } from "@/agents/dialogScreen";
import { heldByDialog, pendingDialog } from "@/agents/dialogs";
import { agentsMessages } from "@/agents/messages";
import { optionIndex, parentCommand, parentMayPick, pickOption, readDialog, type DialogContext, type ReadDialog } from "@/agents/parentControl";
import { remoteBusy } from "@/agents/remoteControl";
import { isLaunching } from "@/agents/spawnFamily";
import { talk } from "@/agents/talkWires";
import { messages } from "@/i18n";
import { ptySendText, ptyWrite, type AgentId } from "@/ipc/pty";
import { pendingEvents, TYPING_PAUSE_MS } from "@/mission/events";
import { deliveryPending } from "@/mission/launch";
import { sameName } from "@/mission/mission";
import { claudeUp } from "@/mission/ready";
import { managedFleet, missionOf } from "@/mission/store";
import { hasUnsentInput } from "@/nodes/terminal/draft";
import { freshText, touchedAgo, typedAgo } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { isManagerRecord, nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { refused, said, type ToolResult } from "./agentTools";
import { agentMessages } from "./messages";

/**
 * A parent's hold on its own sub-agents' terminals (`@/agents/parentControl`), so a team is not stuck waiting for the
 * user on what its parent can handle: run_command types /compact or /clear, answer_dialog
 * reads the dialog a sub-agent waits on and picks one of its options. A parent is the agent that opened it with
 * spawn_agent, a Manager for its team, a Fleet also for the Manager that runs its mission; a deeper one is its own
 * parent's. Every command that changes a conversation and every answer is shown to the user, and logged.
 */

const t = () => messages(agentMessages);

export const SUB_AGENT_TOOLS = new Set(["run_command", "answer_dialog"]);

/** Their specs: every role has them (an agent, a Manager, a Fleet). */
export function subAgentTools() {
  const d = t().tools;
  return [
    {
      name: "run_command",
      description: d.runCommand,
      inputSchema: {
        type: "object",
        properties: { agent: { type: "string", description: d.subAgent }, command: { type: "string", description: d.subAgentCommand } },
        required: ["agent", "command"],
      },
    },
    {
      name: "answer_dialog",
      description: d.answerDialog,
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: d.subAgent },
          dialog: { type: "string", description: d.dialogId },
          option: { type: "string", description: d.dialogOption },
        },
        required: ["agent"],
      },
    },
  ];
}

/** Within this of the user's last key, paste or click in a terminal, they may be answering its dialog themselves. */
export const USER_AT_IT_MS = 10_000;

interface SubAgent {
  nodeId: string;
  name: string;
  /** A linked agent the user lent to the mission: its conversation was theirs before it. */
  linked?: boolean;
}

const nameOf = (nodeId: string) => {
  const record = nodesStore.getState().nodes[nodeId];
  const payload = terminalOf(record);
  return (record?.kind === "fleet" ? record.payload.name : payload && (payload.name || AGENTS[payload.agent].label)) || "An agent";
};

/**
 * The agents `callerId` acts on: those it opened with spawn_agent; for a Manager, its mission's team; for a Fleet,
 * also the Manager that runs its mission.
 */
export function subAgentsOf(callerId: string): SubAgent[] {
  const nodes = nodesStore.getState().nodes;
  const record = nodes[callerId];
  if (isManagerRecord(record)) {
    const fleetId = managedFleet(callerId);
    const members = (fleetId ? missionOf(nodes[fleetId])?.members : undefined) ?? [];
    // A terminal that took a second sub-task is listed once.
    return members.filter((m, i) => members.findIndex((other) => other.nodeId === m.nodeId) === i).map((m) => ({ nodeId: m.nodeId, name: m.name, linked: m.linked }));
  }
  const spawned = Object.keys(nodes)
    .filter((id) => terminalOf(nodes[id])?.spawnedBy === callerId)
    .map((id) => ({ nodeId: id, name: nameOf(id) }));
  const manager = record?.kind === "fleet" ? missionOf(record)?.manager : undefined;
  return manager && nodes[manager] ? [...spawned, { nodeId: manager, name: nameOf(manager) }] : spawned;
}

/** The sub-agent of `callerId` that `raw` names, by id or by name; else why none. */
function subAgentNamed(callerId: string, raw: unknown): SubAgent | string {
  const p = t().parent;
  const mine = subAgentsOf(callerId);
  const names = mine.map((a) => a.name).join(", ");
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return p.whom(names);
  const byId = mine.find((a) => a.nodeId === name);
  if (byId) return byId;
  const found = mine.filter((a) => sameName(a.name, name));
  if (found.length > 1) return p.ambiguous(name, found.map((a) => a.nodeId).join(", "));
  return found[0] ?? p.notYours(name, names);
}

/**
 * The mission whose Fleet or Manager `callerId` is, as a dialog's answer sees it (`parentMayPick`): its agents'
 * permission mode. Undefined for an ordinary parent: an agent and the sub-agents it opened.
 */
function missionRole(callerId: string): DialogContext["mission"] {
  const nodes = nodesStore.getState().nodes;
  const record = nodes[callerId];
  if (record?.kind === "fleet") return { mode: missionOf(record)?.permission };
  if (!isManagerRecord(record)) return undefined;
  const fleetId = managedFleet(callerId);
  // A Manager whose mission is gone: no mode, the user's usual Ask.
  return { mode: fleetId ? missionOf(nodes[fleetId])?.permission : undefined };
}

/** The CLI in a sub-agent's terminal. */
const cliOf = (nodeId: string): AgentId | undefined => sessionOf(nodesStore.getState().nodes[nodeId])?.agent;

/**
 * Why a command typed now would not land on Claude's empty prompt, or null when it would: it is stopped or still
 * starting, a dialog waits, it works (a command typed then waits in its queue and runs later, into other work), its
 * prompt is not up, the user writes in it, or lines dummyPlane holds for it would go first.
 */
function notAtPrompt(agent: SubAgent): string | null {
  const p = t().parent;
  const id = agent.nodeId;
  const activity = agentActivityStore.getState().activities[id];
  if (!isRunning(id) || activity?.left) return p.stopped(agent.name);
  if (isLaunching(id) || deliveryPending(id)) return p.starting(agent.name);
  const screen = freshText(id, 50);
  if (dialogOf(screen, "claude") || (pendingDialog(id)?.options.length ?? 0) > 0) return p.dialogFirst(agent.name);
  if (activity?.activity === "working") return p.working(agent.name);
  if (!claudeUp(screen)) return p.notAtPrompt(agent.name);
  if (hasUnsentInput(id) || typedAgo(id) < TYPING_PAUSE_MS) return p.userTyping(agent.name);
  if (remoteBusy(id) || pendingEvents(id).length > 0) return p.linesFirst(agent.name);
  return null;
}

/** The user sees what a parent did in its sub-agent's terminal, and the log keeps it. */
function shown(line: string, toUser: boolean) {
  logInfo(`sub-agent control: ${line}`);
  if (toUser) toast(line);
}

async function runCommand(callerId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const p = t().parent;
  const agent = subAgentNamed(callerId, args.agent);
  if (typeof agent === "string") return refused(agent);
  const command = parentCommand(args.command);
  if (typeof command === "string") return refused(command);
  // Codex and the others name their commands otherwise, and their prompts are not read here.
  if (cliOf(agent.nodeId) !== "claude") return refused(p.claudeOnly(agent.name));
  if (command.name === "clear" && agent.linked) return refused(p.clearLinked(agent.name));
  const busy = notAtPrompt(agent);
  if (busy) return refused(busy);
  // Typed now, not queued: held back, it could run later into work given meanwhile (`sendCommand`'s queue).
  await ptySendText(agent.nodeId, command.line);
  talk(callerId, agent.nodeId);
  shown(messages(agentsMessages).parentControl.ran(nameOf(callerId), agent.name, command.line), command.changes);
  return said(p.ran(agent.name, command.line, command.name === "clear"));
}

/** A dialog as the parent reads it: its lines, its options and which it may pick, and its id to answer it with. */
function described(agent: SubAgent, read: ReadDialog, context: DialogContext): ToolResult {
  const options = read.dialog.options.map((option) => {
    const why = parentMayPick(read.dialog, option, context);
    return why ? { option, may_pick: false, why } : { option, may_pick: true };
  });
  const any = options.some((o) => o.may_pick);
  return said(
    JSON.stringify(
      {
        agent: agent.name,
        kind: read.dialog.kind,
        dialog: read.id,
        ...(read.guard ? { guard: true } : {}),
        lines: read.lines,
        options,
        next: any ? t().parent.howToAnswer(agent.name, read.id) : t().parent.usersOnly(agent.name),
      },
      null,
      2,
    ),
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function answerDialog(callerId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const p = t().parent;
  const agent = subAgentNamed(callerId, args.agent);
  if (typeof agent === "string") return refused(agent);
  const id = agent.nodeId;
  const cli = cliOf(id);
  // Only Claude's and Codex's dialogs are read on their screens (`@/agents/dialogScreen`).
  if (cli !== "claude" && cli !== "codex") return refused(p.unreadable(agent.name));
  if (!isRunning(id)) return refused(p.stopped(agent.name));
  // Two signs it waits: its CLI's (or a hold's, `@/agents/dialogs`), and a dialog drawn at the bottom of its screen.
  const pending = pendingDialog(id);
  const read = readDialog(freshText(id, 50), cli);
  if (!pending) return refused(p.noDialog(agent.name));
  if (!read) return refused(p.unread(agent.name));
  const option = typeof args.option === "number" ? String(args.option) : typeof args.option === "string" ? args.option.trim() : "";
  // Held from opening, it asks about its CLI's own setup, no task's request (`parentMayPick`).
  const context: DialogContext = { guard: read.guard, held: heldByDialog(id), mission: missionRole(callerId) };
  if (!option) return described(agent, read, context);
  if (args.dialog !== read.id) return refused(typeof args.dialog === "string" && args.dialog ? p.changed : p.readFirst(agent.name));
  const index = optionIndex(read.dialog.options, option);
  if (index === null) return refused(p.noSuchOption(option, read.dialog.options));
  const choice = read.dialog.options[index];
  const why = parentMayPick(read.dialog, choice, context);
  if (why) return refused(why);
  // The user may be answering it themselves: they pressed a key, pasted or clicked in it a moment ago.
  if (hasUnsentInput(id) || touchedAgo(id) < USER_AT_IT_MS) return refused(p.userAtIt(agent.name));
  if (remoteBusy(id)) return refused(p.linesFirst(agent.name));
  // Read again right before each key: the same dialog, its cursor where it should be, or nothing is sent.
  const failed = await pickOption({ read: () => readDialog(freshText(id, 50), cli), press: (keys) => ptyWrite(id, keys), wait: sleep }, read.id, index);
  if (failed) return refused(failed);
  talk(callerId, agent.nodeId);
  shown(messages(agentsMessages).parentControl.answered(nameOf(callerId), agent.name, read.dialog.question ?? read.dialog.title, choice), true);
  return said(p.answered(agent.name, choice));
}

/** One call of these tools, by name; null when `name` is none of them. */
export function subAgentTool(callerId: string, name: string, args: Record<string, unknown>): Promise<ToolResult> | null {
  if (name === "run_command") return runCommand(callerId, args);
  if (name === "answer_dialog") return answerDialog(callerId, args);
  return null;
}
