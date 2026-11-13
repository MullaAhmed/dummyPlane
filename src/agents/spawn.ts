import { subagentSettingsStore } from "@/app/subagentSettings";
import { FLEET_CAPABLE } from "@/fleet/capable";
import { framesFromScene, groupOf } from "@/canvas/groups";
import { signalWire } from "@/canvas/wireActivity";
import { messages } from "@/i18n";
import { profileNamed } from "@/accounts/store";
import { readExtensionChoice, type ExtensionChoice } from "@/ipc/claudeExtensions";
import { AppError } from "@/ipc/invoke";
import { ptySendText, ptyWrite, type AgentId } from "@/ipc/pty";
import { checkSubagentExtras, EXTRA_KINDS, readSubagentExtras, subagentExtras, type ExtraItem, type ExtraKind, type Spawner, type SubagentExtras } from "@/ipc/subagentExtras";
import { agentMessages } from "@/mcp/messages";
import { outLevel } from "@/mcp/protocol";
import { duplicateWork } from "@/mission/activeWork";
import { notify } from "@/mission/events";
import { oneLine } from "@/mission/mission";
import { missionFolder } from "@/mission/folder";
import { whenReady } from "@/mission/ready";
import { MODEL_ID, modelLabel, readLevel } from "@/mission/router";
import { newTerminalPayload } from "@/nodes/terminal/launch";
import { freshText, quietFor } from "@/nodes/terminal/registry";
import { cutWhole } from "@/lib/cut";
import { MAX_STORED_TASK, type TerminalPayload } from "@/nodes/types";
import { isManagerNode, nodeNameOf, nodesStore, terminalOf, type NodeRecord } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { quietly } from "./arrivals";
import { AGENTS } from "./catalog";
import { NODE_GAP } from "./groupLayout";
import { agentsMessages } from "./messages";
import { nameForNewAgent, pantheonForNewGroup } from "./naming";
import { sceneAccess } from "./sceneAccess";
import { fullRect } from "./selectionGroup";
import { spawnModel, unroutedText, type SpawnModel } from "./spawnModel";
import { MAX_SPAWN_DEPTH, markLaunching, spawnDepth, spawnedAtWork } from "./spawnFamily";
import { withFamilyGroup, type FamilyOptions } from "./spawnGroup";
import { reflowSpawnTree, spawnedBy } from "./spawnTree";
import { clip, taskSummary } from "./taskSummary";
import { addTerminal, placeTerminal, type PlaceTerminal } from "./terminals";
import { withWire } from "./wires";

/**
 * spawn_agent: an agent, or a Fleet, delegates a task to a sub-agent that
 * opens as a real terminal beside it, in its folder, the user free to type into
 * it like into any other (Claude's built-in sub-agents run inside their parent
 * and cannot be). The sub-agent's report is typed back into its parent.
 */

/** A title longer than this is cut: spawn_agent's, and message_agent's for new work (`@/mcp/linkTools`). */
export const MAX_TITLE = 60;

const t = () => messages(agentMessages).spawn;

export interface SpawnArgs {
  task?: unknown;
  title?: unknown;
  model?: unknown;
  /** The task's difficulty, as `@/mcp/protocol` hands it (`faible`…): under a model router, it picks the model. */
  niveau?: unknown;
  /** The skills, MCP servers and plugins the sub-agent gets (`@/ipc/subagentExtras`): each a list of names, left out for its CLI's defaults. */
  skills?: unknown;
  mcp_servers?: unknown;
  plugins?: unknown;
  /** `manager`: the sub-agent runs its task with sub-agents of its own (`coordinator`); left out, it does the work. */
  role?: unknown;
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
  const arrived = Date.now();
  const run = chain.then(() => spawnNow(parentId, args, arrived));
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

/** The CLI a sub-agent of `parent` runs: its parent's when that one has dummyPlane's tools (Claude, Codex), else Claude. */
export const childAgentOf = (parent: TerminalPayload): AgentId => (FLEET_CAPABLE.includes(parent.agent) ? parent.agent : "claude");

/**
 * The sub-agent's terminal: its parent's folder, shell, account, skills and plugins (its Edit tab's choice, and the
 * kinds its own spawner picked for it) and mission permissions, its own conversation.
 */
export function childPayload(parent: TerminalPayload, parentId: string, name: string, title: string, model?: string, task?: string): TerminalPayload {
  const agent = childAgentOf(parent);
  const payload = newTerminalPayload({ title, cwd: parent.cwd, agent, command: "", shell: parent.shell, accountId: parent.accountId }, name);
  if (model) payload.model = model;
  // What the parent turned off (skills, plugins, MCP servers, subagents) stays off for what it delegates, as at its own launch.
  const extensions = agent === "claude" ? readExtensionChoice(parent.extensions) : undefined;
  if (extensions) payload.extensions = extensions;
  // So does what its own spawner picked for it, kind by kind, on the same CLI: a kind its spawn_agent names replaces it (`withExtras`).
  const extras = agent === parent.agent ? readSubagentExtras(parent.extras) : undefined;
  if (extras) payload.extras = extras;
  // An unattended mission agent's rules (no git push…) bind what it delegates too.
  if (parent.permission) payload.permission = parent.permission;
  payload.spawnedBy = parentId;
  if (task) payload.task = cutWhole(task, MAX_STORED_TASK);
  return payload;
}

/**
 * How long a call waits for Rust's listings of what a CLI has installed: the router gives up on a tool call after
 * 30 s, and a Codex that is cold takes about a minute. Past it the call is refused, nothing opened, while Rust goes
 * on reading and keeps what it reads (`extras::LISTING_WARM`): the same call made again is answered at once, and a
 * pick can never open a sub-agent after its caller was told it had not.
 */
export const EXTRAS_BUDGET_MS = 20_000;

/**
 * How long after it arrived a spawn_agent call may still open its sub-agent: the router answers "not responding" 30 s
 * after a call came in, and the calls are queued one at a time, so a call can wait behind slow checks. Past it, the call
 * opens nothing: its caller has been told it did not, and would ask again.
 */
export const CALL_DEADLINE_MS = 25_000;

const LATE = Symbol("late");

/** `work`'s answer, or LATE when it has not come within `ms`; a failure of it after that is nobody's. */
async function inTime<T>(work: Promise<T>, ms = EXTRAS_BUDGET_MS): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), Math.max(0, Math.min(ms, EXTRAS_BUDGET_MS)));
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** spawn_agent's argument for each kind of a pick. */
const EXTRA_ARGS: Record<ExtraKind, keyof SpawnArgs> = { skills: "skills", mcpServers: "mcp_servers", plugins: "plugins" };

/** The kinds spawn_agent picks, as named (null is left out, as for the model), or the argument that is no list of names. */
function askedExtras(args: SpawnArgs): SubagentExtras | { bad: string } {
  const asked: SubagentExtras = {};
  for (const kind of EXTRA_KINDS) {
    const raw = args[EXTRA_ARGS[kind]];
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw) || !raw.every((name) => typeof name === "string")) return { bad: EXTRA_ARGS[kind] };
    asked[kind] = raw as string[];
  }
  return asked;
}

/** The Edit tab's switches of each kind (`ExtensionChoice`), which a pick of that kind replaces for the sub-agent. */
const CHOICE_OF: Record<ExtraKind, keyof ExtensionChoice> = { skills: "skillsOff", mcpServers: "mcpOff", plugins: "plugins" };

/** The profile folder a Claude sub-agent of `parent` starts with: its account's. */
const configDirOf = (parent: TerminalPayload, agent: AgentId) => (agent === "claude" ? profileNamed(parent.accountId)?.configDir : undefined);

/**
 * What restricts `parent` for a sub-agent on `agent`: its own pick (names in the same CLI's words) and the switches it set
 * off in its Edit tab (Claude). Nothing, for a spawner nothing restricts: its sub-agent may get whatever its CLI lists.
 */
function limitsOf(parent: TerminalPayload, agent: AgentId): Spawner | undefined {
  const picked = agent === parent.agent ? readSubagentExtras(parent.extras) : undefined;
  const { ceiling: _ceiling, ...extras } = picked ?? {};
  const extensions = agent === "claude" ? readExtensionChoice(parent.extensions) : undefined;
  if (!picked && !extensions) return undefined;
  return { ...(picked ? { extras } : {}), ...(extensions ? { extensions } : {}) };
}

/**
 * The kinds its spawner picked, checked by Rust against what the sub-agent's CLI loads in its folder before its
 * terminal opens (`check_subagent_extras`), each name as the CLI writes it; the refusal's text when the pick is
 * refused or could not be checked. Nothing to check when no kind is picked.
 */
async function checkedExtras(parent: TerminalPayload, asked: SubagentExtras, budget: number): Promise<SubagentExtras | string> {
  const kinds = EXTRA_KINDS.filter((kind) => asked[kind] !== undefined);
  if (kinds.length === 0) return {};
  const agent = childAgentOf(parent);
  try {
    const checked = await inTime(checkSubagentExtras(agent, parent.cwd, configDirOf(parent, agent), asked, limitsOf(parent, agent)), budget);
    if (checked === LATE) return t().extrasSlow(AGENTS[agent].label);
    const picked: SubagentExtras = Object.fromEntries(kinds.map((kind) => [kind, checked[kind] ?? []]));
    if (checked.ceiling) picked.ceiling = checked.ceiling;
    return picked;
  } catch (error) {
    if (error instanceof AppError && error.kind === "invalidInput") return t().extrasRefused(error.message);
    return t().extrasUnchecked(error instanceof Error ? error.message : String(error));
  }
}

/** The sub-agent's payload with the kinds picked: each replaces what it inherited of that kind, its parent's pick and Edit tab's switches. */
export function withExtras(payload: TerminalPayload, picked: SubagentExtras): TerminalPayload {
  const kinds = EXTRA_KINDS.filter((kind) => picked[kind] !== undefined);
  if (kinds.length === 0) return payload;
  const extras: SubagentExtras = { ...payload.extras };
  const choice: ExtensionChoice = { ...payload.extensions };
  // Its ceiling, kind by kind: the one Rust set for a kind it picks, else what it inherited with the pick.
  const ceiling = { ...extras.ceiling };
  for (const kind of kinds) {
    extras[kind] = picked[kind];
    delete choice[CHOICE_OF[kind]];
    const bound = picked.ceiling?.[kind];
    if (bound) ceiling[kind] = bound;
    else delete ceiling[kind];
  }
  if (Object.keys(ceiling).length) extras.ceiling = ceiling;
  else delete extras.ceiling;
  const next: TerminalPayload = { ...payload, extras };
  const left = readExtensionChoice(choice);
  if (left) next.extensions = left;
  else delete next.extensions;
  return next;
}

/** What the answer says the sub-agent gets of each kind picked (inherited kinds included). */
function extrasNote(extras: SubagentExtras | undefined): string | undefined {
  if (!extras) return undefined;
  const label = { skills: "skills", mcpServers: "MCP servers", plugins: "plugins" } as const;
  const kinds = EXTRA_KINDS.filter((kind) => extras[kind] !== undefined).map((kind) => t().extrasKind(label[kind], extras[kind]!));
  return kinds.length ? t().extrasPicked(kinds) : undefined;
}

/**
 * installed_extras: what a sub-agent of `parentId` could be given, as its CLI lists it in the parent's folder, one
 * line per item: whether it is on by default, why it cannot be picked, its description.
 */
export async function listExtras(parentId: string): Promise<SpawnResult> {
  const x = messages(agentMessages).extras;
  const parent = spawnerOf(nodesStore.getState().nodes[parentId], parentId);
  if (!parent) return refuse(t().gone);
  const agent = childAgentOf(parent);
  let installed;
  try {
    const listed = await inTime(subagentExtras(agent, parent.cwd, configDirOf(parent, agent)));
    if (listed === LATE) return refuse(x.slow(AGENTS[agent].label));
    installed = listed;
  } catch (error) {
    return refuse(x.unlisted(error instanceof Error ? error.message : String(error)));
  }
  // Names and descriptions come from disk: one line each, whatever they hold.
  const flat = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  const line = (listedItem: ExtraItem) => {
    const item = { ...listedItem, name: flat(listedItem.name), description: listedItem.description && flat(listedItem.description), plugin: listedItem.plugin && flat(listedItem.plugin) };
    const marks = [
      !item.on && !item.locked && x.off,
      item.locked === "own" && x.own,
      item.locked === "plugin" && x.plugin(item.plugin),
      item.locked === "approval" && x.approval,
      item.locked === "name" && x.name,
    ].filter(Boolean);
    return `- ${item.name}${marks.length ? ` [${marks.join("; ")}]` : ""}${item.description ? `: ${item.description}` : ""}`;
  };
  const sections = EXTRA_KINDS.map((kind) => {
    const items = installed[kind] ?? [];
    return [`${x.kinds[kind]}:`, ...(items.length ? items.map(line) : [x.none])].join("\n");
  });
  return { text: [x.head(AGENTS[agent].label, parent.cwd), ...sections].join("\n\n") };
}

/** How a family's group is made (./spawnGroup.ts): named after the tree's root, its new agents named from `pantheon`. */
function familyOptions(pantheon: string): FamilyOptions {
  return {
    label: (rootId) => messages(agentsMessages).arrival.familyGroup(nodeNameOf(nodesStore.getState().nodes[rootId])),
    pantheon,
    isManager: isManagerNode,
    fullRect,
  };
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

async function spawnNow(parentId: string, args: SpawnArgs, arrived = Date.now()): Promise<SpawnResult> {
  /** What is left of the time this call may take, from when it arrived: it waited its turn in the queue too. */
  const left = () => CALL_DEADLINE_MS - (Date.now() - arrived);
  if (left() <= 0) return refuse(t().queuedTooLong);
  const task = typeof args.task === "string" ? args.task.trim() : "";
  if (!task) return refuse(t().task);
  const model = typeof args.model === "string" ? args.model.trim() : "";
  // The launch's own rule (`checked_model`): a model it would refuse is refused here, before a terminal opens.
  if (model && !MODEL_ID.test(model)) return refuse(t().model(model));
  // No level, or an empty one, is none, as for the model.
  const asked = args.niveau == null || args.niveau === "" ? undefined : args.niveau;
  const level = asked === undefined ? undefined : readLevel(asked);
  if (asked !== undefined && !level) return refuse(t().level(String(asked)));
  // No role, or an empty one, is none: a sub-agent that does the work, as before roles.
  const role = args.role == null || args.role === "" ? undefined : args.role;
  if (role !== undefined && role !== "manager") return refuse(t().role(String(role)));
  const manager = role === "manager";
  const extras = askedExtras(args);
  if ("bad" in extras) return refuse(t().extrasShape(extras.bad));
  const record = nodesStore.getState().nodes[parentId];
  const parent = spawnerOf(record, parentId);
  if (!record || !parent) return refuse(t().gone);
  // Another agent already works on this task: it is theirs to message or read, not to start again (`@/mission/duplicateTask`).
  const given = typeof args.title === "string" ? oneLine(args.title) : "";
  const holder = duplicateWork({ title: given, brief: task }, record.workspaceId, [parentId]);
  if (holder) return refuse(t().duplicate(holder));
  if (spawnDepth(parentId) + 1 > MAX_SPAWN_DEPTH) return refuse(t().tooDeep(MAX_SPAWN_DEPTH));
  // A manager hands its work to sub-agents of its own: it needs a level below it, and none runs another manager.
  if (manager && parent.coordinator) return refuse(t().managerOfManager);
  if (manager && spawnDepth(parentId) + 2 > MAX_SPAWN_DEPTH) return refuse(t().managerTooDeep(MAX_SPAWN_DEPTH));
  const max =subagentSettingsStore.getState().maxSpawned;
  const running = spawnedAtWork();
  if (running.length >= max) return refuse(t().tooMany(running.length, max, seatHolders(running)));
  // Its skills, MCP servers and plugins, as picked: checked before the scene is read, nothing opens on a refusal.
  const picked = await checkedExtras(parent, extras, left());
  if (typeof picked === "string") return refuse(picked);
  if (left() <= 0) return refuse(t().queuedTooLong);
  const workspaceId = record.workspaceId;
  const scene = sceneAccess(workspaceId);
  if (!scene) return refuse(t().noCanvas);
  const element = scene.elements().find((e) => e.id === parentId && !e.isDeleted);
  if (!element) return refuse(t().gone);
  // In its parent's group, from the group's pantheon. Read from the scene, not the store's frames: the spawns of
  // one turn follow one another faster than those are derived again, and a second sub-agent must find the first's group.
  const group = groupOf(framesFromScene(scene.elements()), parentId);
  // A parent in no group gathers its family in a group of its own (./spawnGroup.ts), whose pantheon names them; else beside it, from the workspace's.
  const familyPantheon = !group && withFamilyGroup(scene.elements(), parentId, spawnedBy, familyOptions("")) ? pantheonForNewGroup(workspaceId) : undefined;
  const name = await nameForNewAgent(workspaceId, group?.group.pantheon ?? familyPantheon);
  // The last moment to refuse: past it, its caller has been told it did not open.
  if (left() <= 0) return refuse(t().queuedTooLong);
  // Right of the parent, NODE_GAP apart; addTerminal then moves it clear of any neighbour.
  const center = { x: element.x + element.width * 1.5 + NODE_GAP, y: element.y + element.height / 2 };
  const payload = withExtras(childPayload(parent, parentId, name, titleOf(args.title, task), undefined, task), picked);
  // Its marker, not a mission Manager's role: an ordinary sub-agent, whose brief alone makes it a manager.
  if (manager) payload.coordinator = true;
  // A model router over the spawner chooses the model from the task's level, and refuses a model with no level (`./spawnModel`).
  const routed = spawnModel(parentId, payload.agent, { model, level });
  if (routed.needsLevel) return refuse(t().levelNotModel(routed.needsLevel));
  if (routed.model) payload.model = routed.model;
  // One write, one undo step: a Ctrl+Z takes the sub-agent, its spawn wire and the group made for its family back
  // together, its parent loose again. The family's group is made from the scene as it is once the sub-agent's node
  // exists (something may now stand in its way: the sub-agent then opens beside its parent). Nothing selected,
  // scrolled to nor named: the group arrives quietly, as its agent does.
  const place: PlaceTerminal = (elements, child) => {
    const family = familyPantheon ? withFamilyGroup(elements, parentId, spawnedBy, familyOptions(familyPantheon)) : null;
    const placed = placeTerminal(family?.elements ?? elements, child, group?.id ?? family?.frameId ?? null);
    return withWire(placed, parentId, child.id, undefined, true);
  };
  // It arrives on its own: the user may be typing, so it neither scrolls the view nor takes the keyboard.
  const childId = await addTerminal(workspaceId, payload, center, group?.id ?? null, quietly("spawn"), place);
  if (!childId) return refuse(t().failed);
  markLaunching(childId, true);
  // Element, spawnedBy and wire all there: the tree takes its flowchart layout, the wire rerouted.
  reflowSpawnTree(workspaceId, childId);
  // A manager's brief goes before its task, in the text typed only: its terminal keeps the task (`payload.task`).
  const spawner = parent.name || "your parent agent";
  void deliver(parentId, childId, name, t().brief(spawner, manager ? `${t().managerBrief(spawner)}${task}` : task));
  const note = modelNote(parentId, payload.agent, routed);
  const after = [note.after, extrasNote(payload.extras)].filter(Boolean).join(" ") || undefined;
  return { text: t().spawned(name, routed.model && modelLabel(routed.model), { ...note, after }) };
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
