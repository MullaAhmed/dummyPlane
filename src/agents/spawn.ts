import { FLEET_CAPABLE } from "@/fleet/capable";
import { framesFromScene, groupOf } from "@/canvas/groups";
import { signalWire } from "@/canvas/wireActivity";
import { messages } from "@/i18n";
import { profileNamed } from "@/accounts/store";
import { cardAdHocAgent } from "@/kanban/adHocCards";
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
import { carriedStep, markParentStep } from "./carriedSteps";
import { holdFor } from "./dialogs";
import { NODE_GAP, overlap } from "./groupLayout";
import { agentsMessages } from "./messages";
import { nameForNewAgent, pantheonForNewGroup } from "./naming";
import { sceneAccess } from "./sceneAccess";
import { adHocLimit, costlyModel, fullCap, whoWaits } from "./seats";
import { fullRect } from "./selectionGroup";
import { COSTLY_LEVELS, readWorkKind, routineLevel, spawnModel, unroutedText, type SpawnModel } from "./spawnModel";
import { MAX_SPAWN_DEPTH, markLaunching, spawnDepth } from "./spawnFamily";
import { withFamilyGroup, type FamilyOptions } from "./spawnGroup";
import { reflowSpawnTree, spawnedBy, spawnLayoutOf } from "./spawnTree";
import { clip, taskSummary } from "./taskSummary";
import { addTerminal, placeTerminal, type PlaceTerminal } from "./terminals";
import { laneCovers } from "./laneCover";
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
  /**
   * The skills, MCP servers and plugins the sub-agent gets (`@/ipc/subagentExtras`): each a list of names, `[]` for none.
   * The tool's handler refuses a call that leaves one out (`REQUIRED_EXTRA_KINDS`); `spawnAgent` itself still reads a
   * kind left out as its CLI's defaults.
   */
  skills?: unknown;
  mcp_servers?: unknown;
  plugins?: unknown;
  /** `manager`: the sub-agent runs its task with sub-agents of its own (`coordinator`); left out, it does the work. */
  role?: unknown;
  /** What the work is (`./spawnModel` WorkKind): `write` and `verify`, routine, open at medium at most; `plan`, or none, at the level given. */
  kind?: unknown;
  /** The title of one of the spawner's own steps that this sub-agent carries: it follows the sub-agent's report (`./carriedSteps`). */
  step?: unknown;
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
/**
 * Whether the sub-agent `childId` must stay where its placement put it: the tree's flowchart sets a first child right
 * of its parent, and with the Agents panel or the Edit panel in the lane that may be under it (sub-agents-and-outputs
 * 09-11: Flash beside Batman, under the panel), while its placement kept it clear (laneCovers, freeCellClear). It is
 * then pinned there, as a node moved by hand: later layouts leave it, and lay out its own children from it. Not when
 * the lane is free, nor when its placement could not keep it clear either: the layout decides then, as before.
 */
function keptOffLane(workspaceId: string, childId: string): boolean {
  const covers = laneCovers(workspaceId);
  const elements = sceneAccess(workspaceId)?.elements();
  const placed = elements?.find((e) => e.id === childId && !e.isDeleted);
  if (covers.length === 0 || !elements || !placed) return false;
  const underLane = (e: { x: number; y: number; width: number; height: number }) => covers.some((cover) => overlap(e, cover) > 0);
  if (underLane(placed)) return false;
  const laid = spawnLayoutOf(elements, childId)?.find((e) => e.id === childId);
  return laid !== undefined && underLane(laid);
}

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
 * The sub-agent's terminal: its parent's folder, shell, account, skills and plugins (its Edit panel's choice, and the
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
export const EXTRA_ARGS: Record<ExtraKind, keyof SpawnArgs> = { skills: "skills", mcpServers: "mcp_servers", plugins: "plugins" };

/**
 * The kinds a spawn_agent call must pick (`[]` for none): a kind left out would be its CLI's defaults, i.e. every skill,
 * plugin and server it loads. All three, so the spawner chooses what each sub-agent needs. The tool's schema lists them
 * as required (`@/mcp/agentTools`) and its handler refuses a call without them (`missingExtras`); nothing else that
 * starts an agent goes through that call (a mission's team, hand_off, the interface's own spawns).
 */
export const REQUIRED_EXTRA_KINDS: readonly ExtraKind[] = ["skills", "mcpServers", "plugins"];

/**
 * The refusal of a spawn_agent call that leaves out a kind it must pick (a missing or null argument), or undefined when
 * every required kind is there. Nothing is read or opened: it is the call's own shape, checked first.
 */
export function missingExtras(args: SpawnArgs): string | undefined {
  const names = REQUIRED_EXTRA_KINDS.map((kind) => EXTRA_ARGS[kind]).filter((arg) => args[arg] === undefined || args[arg] === null);
  return names.length ? t().extrasRequired(names) : undefined;
}

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

/** The Edit panel's switches of each kind (`ExtensionChoice`), which a pick of that kind replaces for the sub-agent. */
const CHOICE_OF: Record<ExtraKind, keyof ExtensionChoice> = { skills: "skillsOff", mcpServers: "mcpOff", plugins: "plugins" };

/** The profile folder a Claude sub-agent of `parent` starts with: its account's. */
const configDirOf = (parent: TerminalPayload, agent: AgentId) => (agent === "claude" ? profileNamed(parent.accountId)?.configDir : undefined);

/**
 * What restricts `parent` for a sub-agent on `agent`: its own pick (names in the same CLI's words) and the switches it set
 * off in its Edit panel (Claude). Nothing, for a spawner nothing restricts: its sub-agent may get whatever its CLI lists.
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

/** The sub-agent's payload with the kinds picked: each replaces what it inherited of that kind, its parent's pick and Edit panel's switches. */
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

/**
 * What a sub-agent the router opened on a costly model (a high or extreme level) reads before its task: the model it
 * runs on is kept for planning and the hard decisions, and its routine work goes to sub-agents of its own at low or
 * medium. Nothing for one the router did not route, one at medium or below, or one that can open no sub-agent of its
 * own (the depth limit): it would be sent to delegate into a refusal. A manager's own brief already hands everything down.
 */
function costlyBrief(parentId: string, routed: SpawnModel): string {
  if (!routed.model || !routed.level || !COSTLY_LEVELS.includes(routed.level)) return "";
  if (spawnDepth(parentId) + 2 > MAX_SPAWN_DEPTH) return "";
  return t().costlyBrief(modelLabel(routed.model), outLevel(routed.level));
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
  const rated = asked === undefined ? undefined : readLevel(asked);
  if (asked !== undefined && !rated) return refuse(t().level(String(asked)));
  // No kind, or an empty one, is none: the level as given, as before kinds.
  const kindAsked = args.kind == null || args.kind === "" ? undefined : args.kind;
  const kind = kindAsked === undefined ? undefined : readWorkKind(kindAsked);
  if (kindAsked !== undefined && !kind) return refuse(t().kind(String(kindAsked)));
  // Routine work (write, verify) rated high or extreme opens at medium: the ad-hoc gate and the router both read the
  // level it opens at, so routine work is never refused for a level it does not run at (`./spawnModel` routineLevel).
  const { level, lowered } = routineLevel(rated, kind);
  // No role, or an empty one, is none: a sub-agent that does the work, as before roles.
  const role = args.role == null || args.role === "" ? undefined : args.role;
  if (role !== undefined && role !== "manager") return refuse(t().role(String(role)));
  const manager = role === "manager";
  const extras = askedExtras(args);
  if ("bad" in extras) return refuse(t().extrasShape(extras.bad, REQUIRED_EXTRA_KINDS.some((kind) => EXTRA_ARGS[kind] === extras.bad)));
  const record = nodesStore.getState().nodes[parentId];
  const parent = spawnerOf(record, parentId);
  if (!record || !parent) return refuse(t().gone);
  // A Fleet's ad-hoc agents run beside its mission, outside its plan and its queue, and spend the user's usage there, and
  // so do the agents opened under them: the costly levels go into the mission (add_tasks), or the user decides. A
  // mission's own members, and what they open, are not affected.
  const limit = adHocLimit(parentId);
  if (limit) {
    if (level === "eleve" || level === "extreme") return refuse(t().adHocLevel(outLevel(level), limit));
    // With the router off, a model named by hand spends as the level that picks it: the gate is not read around.
    if (costlyModel(model)) return refuse(t().adHocModel(model, limit));
  }
  // Another agent already works on this task: it is theirs to message or read, not to start again (`@/mission/duplicateTask`).
  const given = typeof args.title === "string" ? oneLine(args.title) : "";
  const holder = duplicateWork({ title: given, brief: task }, record.workspaceId, [parentId]);
  if (holder) return refuse(t().duplicate(holder));
  if (spawnDepth(parentId) + 1 > MAX_SPAWN_DEPTH) return refuse(t().tooDeep(MAX_SPAWN_DEPTH));
  // A manager hands its work to sub-agents of its own: it needs a level below it, and none runs another manager.
  if (manager && parent.coordinator) return refuse(t().managerOfManager);
  if (manager && spawnDepth(parentId) + 2 > MAX_SPAWN_DEPTH) return refuse(t().managerTooDeep(MAX_SPAWN_DEPTH));
  const full = fullCap();
  if (full) return refuse(t().tooMany(full, whoWaits(parentId)));
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
  const carried = carriedStep(parentId, args.step);
  if (carried) payload.forStep = carried;
  // Named but declared by nobody: the call goes through and says the link was not made.
  const stepNote = !carried && typeof args.step === "string" && args.step.trim() ? t().stepUnknown(args.step.trim()) : "";
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
    // Out from under an occupied lane: it arrives without moving the view (agents/laneCover.ts).
    const placed = placeTerminal(family?.elements ?? elements, child, group?.id ?? family?.frameId ?? null, laneCovers(workspaceId));
    return withWire(placed, parentId, child.id, undefined, true);
  };
  // It arrives on its own: the user may be typing, so it neither scrolls the view nor takes the keyboard.
  const childId = await addTerminal(workspaceId, payload, center, group?.id ?? null, quietly("spawn"), place);
  if (!childId) return refuse(t().failed);
  if (carried) markParentStep(parentId, carried, "en_cours");
  markLaunching(childId, true);
  // Beside a running mission, outside its plan: its board shows it too, its card moving with its reports.
  cardAdHocAgent(parentId, { nodeId: childId, name, title: payload.title, task });
  // Element, spawnedBy and wire all there: the tree takes its flowchart layout, the wire rerouted. Unless that layout
  // would take it under the occupied lane, where its placement kept it from: it then stays there, pinned.
  if (keptOffLane(workspaceId, childId)) reflowSpawnTree(workspaceId, childId, [childId]);
  else reflowSpawnTree(workspaceId, childId);
  // A manager's brief goes before its task, in the text typed only: its terminal keeps the task (`payload.task`).
  // So does what a sub-agent the router put on a costly model is told of it (`costlyBrief`).
  const spawner = parent.name || "your parent agent";
  const lead = manager ? t().managerBrief(spawner) : costlyBrief(parentId, routed);
  void deliver(parentId, childId, name, t().brief(spawner, `${lead}${task}`));
  const note = modelNote(parentId, payload.agent, routed);
  const loweredNote = lowered && kind ? t().levelLowered(outLevel(lowered), outLevel(level!), kind) : undefined;
  const after = [loweredNote, note.after, extrasNote(payload.extras)].filter(Boolean).join(" ") || undefined;
  return { text: [t().spawned(name, routed.model && modelLabel(routed.model), { ...note, after }), stepNote].filter(Boolean).join(" ") };
}

/**
 * Types the task into the sub-agent once its Claude is up, as a mission's `assign` does; its parent hears of a
 * failure. A question only the user answers may hold its Claude past the minute: the parent hears what it is as soon
 * as it shows (`holdFor`: its agent waits for the user, `@/mission/events` tells the parent), or at the minute that a
 * question may be waiting; the task still goes when the session opens, once, and the parent hears it went (its
 * parent cannot message it meanwhile: it is launching).
 */
async function deliver(parentId: string, childId: string, name: string, text: string) {
  try {
    const agent = terminalOf(nodesStore.getState().nodes[childId])?.agent;
    // Its parent was told it is held, or slow: it hears when the task goes.
    let late = false;
    const ready = await whenReady({
      running: () => isRunning(childId),
      quietMs: () => quietFor(childId),
      screen: () => freshText(childId, 50),
      press: (keys) => ptyWrite(childId, keys),
      agent,
      waitLonger: () => isRunning(childId),
      slow: () => {
        // A dialog shown: its parent already heard what it is.
        if (!late) notify(parentId, t().slow(name));
        late = true;
      },
      held: holdFor(childId, (dialog) => {
        if (dialog) late = true;
      }),
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
    if (late) notify(parentId, t().sentLate(name));
  } catch (error) {
    notify(parentId, t().notSent(name, error instanceof Error ? error.message : String(error)));
  } finally {
    markLaunching(childId, false);
  }
}
