import { subagentSettingsStore } from "@/app/subagentSettings";
import { groupOf } from "@/canvas/groups";
import { signalWire } from "@/canvas/wireActivity";
import { messages } from "@/i18n";
import { ptySendText, ptyWrite } from "@/ipc/pty";
import { agentMessages } from "@/mcp/messages";
import { notify } from "@/mission/events";
import { oneLine } from "@/mission/mission";
import { whenReady } from "@/mission/ready";
import { workspaceCanvas } from "@/mission/store";
import { newTerminalPayload } from "@/nodes/terminal/launch";
import { freshText, quietFor } from "@/nodes/terminal/registry";
import { MAX_STORED_TASK, type TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { quietly } from "./arrivals";
import { NODE_GAP } from "./groupLayout";
import { nameForNewAgent } from "./naming";
import { sceneAccess } from "./sceneAccess";
import { MAX_SPAWN_DEPTH, markLaunching, runningSpawned, spawnDepth } from "./spawnFamily";
import { reflowSpawnTree } from "./spawnTree";
import { clip, taskSummary } from "./taskSummary";
import { addTerminal } from "./terminals";
import { withWire } from "./wires";

/**
 * spawn_agent: an agent delegates a task to a sub-agent that opens as a real
 * Claude terminal beside it, in its folder, the user free to type into it like
 * into any other (Claude's built-in sub-agents run inside their parent and
 * cannot be). The sub-agent's report is typed back into its parent.
 */

/** A title longer than this is cut. */
const MAX_TITLE = 60;
/** A model alias (opus, sonnet…) or id: nothing a command line could misread. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;

const t = () => messages(agentMessages).spawn;

export interface SpawnArgs {
  task?: unknown;
  title?: unknown;
  model?: unknown;
}

/** What spawn_agent answers: a text for the agent, an error when it refused. */
export interface SpawnResult {
  text: string;
  error?: boolean;
}

/** Calls run one at a time: two spawns of one turn would read the same names, spots and count. */
let chain: Promise<unknown> = Promise.resolve();

/** spawn_agent of `parentId`'s agent. */
export function spawnAgent(parentId: string, args: SpawnArgs): Promise<SpawnResult> {
  const run = chain.then(() => spawnNow(parentId, args));
  chain = run.catch(() => undefined);
  return run;
}

const refuse = (text: string): SpawnResult => ({ text, error: true });

/**
 * The title of the sub-agent's terminal, the line under its name and its Claude
 * session's name: the one given, else its task said in a line (taskSummary),
 * not the raw start of a brief.
 */
function titleOf(title: unknown, task: string): string {
  const given = typeof title === "string" ? oneLine(title) : "";
  return clip(given || taskSummary(task) || oneLine(task), MAX_TITLE);
}

/** The sub-agent's terminal: its parent's folder, shell, account and mission permissions, its own conversation. */
export function childPayload(parent: TerminalPayload, parentId: string, name: string, title: string, model?: string, task?: string): TerminalPayload {
  const payload = newTerminalPayload({ title, cwd: parent.cwd, agent: "claude", command: "", shell: parent.shell, accountId: parent.accountId }, name);
  if (model) payload.model = model;
  // An unattended mission agent's rules (no git push…) bind what it delegates too.
  if (parent.permission) payload.permission = parent.permission;
  payload.spawnedBy = parentId;
  if (task) payload.task = task.slice(0, MAX_STORED_TASK);
  return payload;
}

async function spawnNow(parentId: string, args: SpawnArgs): Promise<SpawnResult> {
  const task = typeof args.task === "string" ? args.task.trim() : "";
  if (!task) return refuse(t().task);
  const model = typeof args.model === "string" ? args.model.trim() : "";
  if (model && !MODEL.test(model)) return refuse(t().model(model));
  const record = nodesStore.getState().nodes[parentId];
  const parent = terminalOf(record);
  if (!record || !parent) return refuse(t().gone);
  if (spawnDepth(parentId) + 1 > MAX_SPAWN_DEPTH) return refuse(t().tooDeep(MAX_SPAWN_DEPTH));
  const max = subagentSettingsStore.getState().maxSpawned;
  const running = runningSpawned();
  if (running >= max) return refuse(t().tooMany(running, max));
  const workspaceId = record.workspaceId;
  const scene = sceneAccess(workspaceId);
  if (!scene) return refuse(t().noCanvas);
  const element = scene.elements().find((e) => e.id === parentId && !e.isDeleted);
  if (!element) return refuse(t().gone);
  // In its parent's group, from the group's pantheon; else beside it, from the workspace's.
  const group = groupOf(workspaceCanvas(workspaceId).frames, parentId);
  const name = await nameForNewAgent(workspaceId, group?.group.pantheon);
  // Right of the parent, NODE_GAP apart; addTerminal then moves it clear of any neighbour.
  const center = { x: element.x + element.width * 1.5 + NODE_GAP, y: element.y + element.height / 2 };
  // It arrives on its own: the user may be typing, so it neither scrolls the view nor takes the keyboard.
  const childId = await addTerminal(workspaceId, childPayload(parent, parentId, name, titleOf(args.title, task), model || undefined, task), center, group?.id ?? null, quietly("spawn"));
  if (!childId) return refuse(t().failed);
  markLaunching(childId, true);
  const now = sceneAccess(workspaceId);
  if (now) now.write(withWire(now.elements(), parentId, childId, undefined, true));
  // Element, spawnedBy and wire all there: the tree takes its flowchart layout, the wire rerouted.
  reflowSpawnTree(workspaceId, childId);
  void deliver(parentId, childId, name, t().brief(parent.name || "your parent agent", task));
  return { text: t().spawned(name) };
}

/** Types the task into the sub-agent once its Claude is up, as a mission's `assign` does; its parent hears of a failure. */
async function deliver(parentId: string, childId: string, name: string, text: string) {
  try {
    const ready = await whenReady({ running: () => isRunning(childId), quietMs: () => quietFor(childId), screen: () => freshText(childId, 50), press: (keys) => ptyWrite(childId, keys) });
    if (!isRunning(childId)) {
      notify(parentId, t().notStarted(name));
      return;
    }
    // Its shell outlives a Claude that quit: the task would be typed as a command.
    if (!ready) {
      notify(parentId, t().notReady(name));
      return;
    }
    await ptySendText(childId, text);
    signalWire(childId, "toAgent", parentId);
  } catch (error) {
    notify(parentId, t().notSent(name, error instanceof Error ? error.message : String(error)));
  } finally {
    markLaunching(childId, false);
  }
}
