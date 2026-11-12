import { subagentSettingsStore } from "@/app/subagentSettings";
import { FLEET_CAPABLE } from "@/fleet/capable";
import { groupOf } from "@/canvas/groups";
import { signalWire } from "@/canvas/wireActivity";
import { messages } from "@/i18n";
import { readExtensionChoice } from "@/ipc/claudeExtensions";
import { ptySendText, ptyWrite, type AgentId } from "@/ipc/pty";
import { agentMessages } from "@/mcp/messages";
import { outLevel } from "@/mcp/protocol";
import { duplicateWork } from "@/mission/activeWork";
import { notify } from "@/mission/events";
import { oneLine } from "@/mission/mission";
import { missionFolder } from "@/mission/folder";
import { whenReady } from "@/mission/ready";
import { modelLabel, readLevel } from "@/mission/router";
import { workspaceCanvas } from "@/mission/store";
import { newTerminalPayload } from "@/nodes/terminal/launch";
import { freshText, quietFor } from "@/nodes/terminal/registry";
import { MAX_STORED_TASK, type TerminalPayload } from "@/nodes/types";
import { nodeNameOf, nodesStore, terminalOf, type NodeRecord } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { quietly } from "./arrivals";
import { AGENTS } from "./catalog";
import { NODE_GAP } from "./groupLayout";
import { nameForNewAgent } from "./naming";
import { sceneAccess } from "./sceneAccess";
import { spawnModel, unroutedText, type SpawnModel } from "./spawnModel";
import { MAX_SPAWN_DEPTH, markLaunching, spawnDepth, spawnedAtWork } from "./spawnFamily";
import { reflowSpawnTree } from "./spawnTree";
import { clip, taskSummary } from "./taskSummary";
import { addTerminal } from "./terminals";
import { withWire } from "./wires";

/**
 * spawn_agent: an agent, or a Fleet, delegates a task to a sub-agent that
 * opens as a real terminal beside it, in its folder, the user free to type into
 * it like into any other (Claude's built-in sub-agents run inside their parent
 * and cannot be). The sub-agent's report is typed back into its parent.
 */

/** A title longer than this is cut: spawn_agent's, and message_agent's for new work (`@/mcp/linkTools`). */
export const MAX_TITLE = 60;
/** A model alias (opus, sonnet…) or id: nothing a command line could misread. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;

const t = () => messages(agentMessages).spawn;

export interface SpawnArgs {
  task?: unknown;
  title?: unknown;
  model?: unknown;
  /** The task's difficulty, as `@/mcp/protocol` hands it (`faible`…): under a model router, it picks the model. */
  niveau?: unknown;
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

/**
 * What a sub-agent takes after: an agent's own terminal; for a Fleet, its
 * session on the Fleet's workspace folder, with what a team agent of its
 * mission gets unasked: the night's permission while one is set (none by day,
 * nor once the mission is finished: the user's usual prompts). Never the
 * manager's rails: the child gets no role, no Linear and the user's servers,
 * so it edits and runs commands like any agent.
 */
export function spawnerOf(record: NodeRecord | undefined, nodeId: string): TerminalPayload | undefined {
  if (record?.kind === "terminal") return record.payload;
  if (record?.kind !== "fleet" || !record.payload.session) return undefined;
  const { session, mission, name } = record.payload;
  const permission = mission && mission.state !== "terminee" ? mission.permission : undefined;
  return { ...session, name, cwd: missionFolder(nodeId) || session.cwd, permission };
}

/** The sub-agent's terminal: its parent's folder, shell, account, skills and plugins (its Edit tab's choice) and mission permissions, its own conversation. */
export function childPayload(parent: TerminalPayload, parentId: string, name: string, title: string, model?: string, task?: string): TerminalPayload {
  // On its parent's CLI when that one has dummyPlane's tools (Claude, Codex), else on Claude.
  const agent = FLEET_CAPABLE.includes(parent.agent) ? parent.agent : "claude";
  const payload = newTerminalPayload({ title, cwd: parent.cwd, agent, command: "", shell: parent.shell, accountId: parent.accountId }, name);
  if (model) payload.model = model;
  // What the parent turned off (skills, plugins, MCP servers, subagents) stays off for what it delegates, as at its own launch.
  const extensions = agent === "claude" ? readExtensionChoice(parent.extensions) : undefined;
  if (extensions) payload.extensions = extensions;
  // An unattended mission agent's rules (no git push…) bind what it delegates too.
  if (parent.permission) payload.permission = parent.permission;
  payload.spawnedBy = parentId;
  if (task) payload.task = task.slice(0, MAX_STORED_TASK);
  return payload;
}

/**
 * What the spawner hears about its sub-agent's model: the level that chose it, a model set aside, or a level that
 * chose nothing, why (the router off at its switch, above it or in Settings; no model for that level on the
 * sub-agent's CLI) and what it runs instead.
 */
function modelNote(parentId: string, child: AgentId, routed: SpawnModel): { why?: string; after?: string } {
  const why = routed.level && (routed.defaulted ? t().byDefault : t().byLevel(outLevel(routed.level)));
  if (routed.dropped) return { why, after: t().modelDropped(routed.dropped) };
  if (!routed.unused) return { why };
  const { level, why: reason } = routed.unused;
  const runs = routed.model ? t().runsNamed : t().runsDefault(AGENTS[child].label);
  return { after: t().levelUnused(outLevel(level), unroutedText(reason, level, parentId), runs) };
}

async function spawnNow(parentId: string, args: SpawnArgs): Promise<SpawnResult> {
  const task = typeof args.task === "string" ? args.task.trim() : "";
  if (!task) return refuse(t().task);
  const model = typeof args.model === "string" ? args.model.trim() : "";
  if (model && !MODEL.test(model)) return refuse(t().model(model));
  // No level, or an empty one, is none, as for the model.
  const asked = args.niveau == null || args.niveau === "" ? undefined : args.niveau;
  const level = asked === undefined ? undefined : readLevel(asked);
  if (asked !== undefined && !level) return refuse(t().level(String(asked)));
  const record = nodesStore.getState().nodes[parentId];
  const parent = spawnerOf(record, parentId);
  if (!record || !parent) return refuse(t().gone);
  // Another agent already works on this task: it is theirs to message or read, not to start again (`@/mission/duplicateTask`).
  const given = typeof args.title === "string" ? oneLine(args.title) : "";
  const holder = duplicateWork({ title: given, brief: task }, record.workspaceId, [parentId]);
  if (holder) return refuse(t().duplicate(holder));
  if (spawnDepth(parentId) + 1 > MAX_SPAWN_DEPTH) return refuse(t().tooDeep(MAX_SPAWN_DEPTH));
  const max = subagentSettingsStore.getState().maxSpawned;
  const running = spawnedAtWork();
  if (running.length >= max) return refuse(t().tooMany(running.length, max, seatHolders(running)));
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
  const payload = childPayload(parent, parentId, name, titleOf(args.title, task), undefined, task);
  // A model router over the spawner chooses the model from the task's level, and refuses a model with no level (`./spawnModel`).
  const routed = spawnModel(parentId, payload.agent, { model, level });
  if (routed.needsLevel) return refuse(t().levelNotModel(routed.needsLevel));
  if (routed.model) payload.model = routed.model;
  // It arrives on its own: the user may be typing, so it neither scrolls the view nor takes the keyboard.
  const childId = await addTerminal(workspaceId, payload, center, group?.id ?? null, quietly("spawn"));
  if (!childId) return refuse(t().failed);
  markLaunching(childId, true);
  const now = sceneAccess(workspaceId);
  if (now) now.write(withWire(now.elements(), parentId, childId, undefined, true));
  // Element, spawnedBy and wire all there: the tree takes its flowchart layout, the wire rerouted.
  reflowSpawnTree(workspaceId, childId);
  void deliver(parentId, childId, name, t().brief(parent.name || "your parent agent", task));
  return { text: t().spawned(name, routed.model && modelLabel(routed.model), modelNote(parentId, payload.agent, routed)) };
}

/**
 * Who holds the seats, by folder, every project's: `Superman, Aquaman (BOS-Mono); Shazam (upload-plans-hulk)`.
 * A cap held in another project is otherwise read as one's own closed terminals.
 */
function seatHolders(ids: readonly string[]): string {
  const nodes = nodesStore.getState().nodes;
  const byFolder = new Map<string, string[]>();
  for (const id of ids) {
    const folder = terminalOf(nodes[id])?.cwd.split(/[\\/]/).filter(Boolean).pop() ?? "?";
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), nodeNameOf(nodes[id]) || "a sub-agent"]);
  }
  return [...byFolder].map(([folder, names]) => `${names.join(", ")} (${folder})`).join("; ");
}

/**
 * Types the task into the sub-agent once its Claude is up, as a mission's `assign` does; its parent hears of a
 * failure. A question only the user answers may hold its Claude past the minute: the parent hears so, and the task
 * still goes when the session opens (its parent cannot message it meanwhile: it is launching).
 */
async function deliver(parentId: string, childId: string, name: string, text: string) {
  try {
    const agent = terminalOf(nodesStore.getState().nodes[childId])?.agent;
    const ready = await whenReady({
      running: () => isRunning(childId),
      quietMs: () => quietFor(childId),
      screen: () => freshText(childId, 50),
      press: (keys) => ptyWrite(childId, keys),
      agent,
      waitLonger: () => isRunning(childId),
      slow: () => notify(parentId, t().slow(name)),
    });
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
