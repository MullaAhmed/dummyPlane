import { FLEET_CAPABLE } from "@/fleet/capable";
import { readExtensionChoice, type ExtensionChoice } from "@/ipc/claudeExtensions";
import type { IssueState } from "@/ipc/github";
import { AGENT_IDS, MANAGER_ROLE, STORED_FLEET_ROLE, type AgentId, type OllamaLaunch, type Permission, type ShellKind } from "@/ipc/pty";
import { readMission, type Mission } from "@/mission/mission";
import { readEffort, type EffortLevel } from "@/mission/router";
import { readSteps, settledSteps, type Step } from "./steps";

/** Content of a terminal node (spec habillage §15.2). */
export interface TerminalPayload {
  /** Full title: tooltip of the header, and the session name given to Claude. */
  title: string;
  /** Mythological first name shown in the header ("" until one is given). */
  name: string;
  agent: AgentId;
  cwd: string;
  shell: ShellKind;
  /** Used by the "custom" agent only. */
  command: string;
  /** The Claude Code conversation of this node, for `--session-id` / `--resume`. */
  claudeSessionId?: string;
  /** The thread a Codex terminal is in, once Codex saved it: `codex resume <id>`. */
  codexSessionId?: string;
  ollama?: OllamaLaunch;
  /** The steps its agent declared (spec orchestrateur §5). */
  steps?: Step[];
  /**
   * A fleet's session (spec orchestrateur §4.2), or a mission's Manager; absent for an agent. Stored data: see
   * `STORED_FLEET_ROLE` and `MANAGER_ROLE`.
   */
  role?: typeof STORED_FLEET_ROLE | typeof MANAGER_ROLE;
  /** A Manager's Fleet: the node whose mission it runs (`@/mission/manager`). */
  fleet?: string;
  /** Claude starts with Remote Control (spec maj §2). */
  remoteControl?: boolean;
  /** Claude's model, chosen by a mission's router (spec maj §3) or in the edit panel. */
  model?: string;
  /** Claude's effort level (`--effort`), chosen in the edit panel; absent: Claude's own (its settings, the model's default). */
  effort?: EffortLevel;
  /** What its mission lets it do unasked (spec mission de nuit §5.3); on a fleet's session, its night. */
  permission?: Permission;
  /** A fleet's session that reads its night's tickets in Linear, through Linear's own server. */
  linear?: true;
  /** The Claude profile this terminal started with (spec comptes §3); absent: the default account. */
  accountId?: string;
  /** A command to run once, an install: only an explicit gesture runs it again (spec installation §7). */
  oneShot?: boolean;
  /** Node id of the terminal whose agent spawned this one (spawn_agent). */ spawnedBy?: string;
  /** The task its spawner gave it (spawn_agent), its start only: said in a line under its name (`@/agents/taskSummary`). */
  task?: string;
  /** Shrunk to a card: its process and screen go on (`./terminal/minimize.ts`). */
  minimized?: boolean;
  /** Its height before it was minimized, given back when it expands. */
  expandedHeight?: number;
  /** Its width before it was minimized, given back when it expands. */
  expandedWidth?: number;
  /** What its agent last said with `report`, shown on its card. */
  lastReport?: TerminalReport;
  /** Its message bar, folded unless the user opened it (an agent's foot). */
  inputOpen?: boolean;
  /** Claude only: the skills, plugins, MCP servers and subagents it turns off or on, read at its next launch. */
  extensions?: ExtensionChoice;
}

export type TerminalReportStatus = "done" | "blocked" | "failed";

export interface TerminalReport {
  status: TerminalReportStatus;
  /** Its words: plain text or Markdown, what lines and cards show. */
  summary: string;
  /** The summary as the agent wrote it in OpenUI Lang, when it did: what the edit panel draws. */
  ui?: string;
}

const REPORT_STATUSES = new Set<string>(["done", "blocked", "failed"]);

/**
 * The most of a spawned agent's task its payload keeps: enough for its line
 * and its tooltip, while a brief can run to pages and the payload sits in
 * every node selector and the saved scene. The whole task is in its terminal.
 */
export const MAX_STORED_TASK = 2000;

function readTerminalReport(raw: unknown): TerminalReport | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.status !== "string" || !REPORT_STATUSES.has(r.status) || typeof r.summary !== "string") return undefined;
  return { status: r.status as TerminalReportStatus, summary: r.summary, ...(typeof r.ui === "string" && r.ui ? { ui: r.ui } : {}) };
}

/** Content of a fleet node (spec habillage §13, spec orchestrateur §6). */
export interface FleetPayload {
  name: string;
  /** Its Claude session, created when it is first shown. */
  session?: TerminalPayload;
  /** Its mission (spec orchestrateur §7). */
  mission?: Mission;
  /** Its message field, folded unless the user opened it. */
  inputOpen?: boolean;
}

export const FLEET_DEFAULT_NAME = "Fleet";

/** The names a fleet got by default before it was called "Fleet": read as "Fleet", a name the user chose is kept. Stored data: they are the old names, in English and in French. */
const FORMER_DEFAULT_NAMES = new Set(["Orchestrator", "Orchestrateur"]);
const renamed = (name: string) => (FORMER_DEFAULT_NAMES.has(name.trim()) ? FLEET_DEFAULT_NAME : name);

/** Content of a file node (issue #49): a file of the project, shown read-only. */
export interface FilePayload {
  /** Relative to the project's folder. */
  path: string;
}

/** Content of an output node: what an agent showed with show_output (`@/mcp/nodeTools`), in OpenUI Lang. */
export interface OutputPayload {
  title: string;
  /** Node id of the agent's terminal that showed it: its wire's start, and where its Buttons send. */
  source: string;
  /** Its OpenUI Lang program (or Markdown), as the agent wrote it. */
  ui: string;
  /** When the agent last showed it (ms). */
  updatedAt: number;
}

export type NodePayload = TerminalPayload | FleetPayload | KanbanPayload | FilePayload | OutputPayload | NotePayload;

/** Reads a stored output payload; null without content. */
export function readOutputPayload(raw: unknown): OutputPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ui !== "string") return null;
  return {
    title: typeof r.title === "string" ? r.title : "",
    source: typeof r.source === "string" ? r.source : "",
    ui: r.ui,
    updatedAt: typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  };
}

/**
 * Content of a quick note (src/nodes/note): plain text kept beside a terminal or a Fleet. Which node it stands
 * beside, and where, is scene data: its element's `customData.note` (`@/nodes/note/link`).
 */
export interface NotePayload {
  text: string;
}

/** The most of a note's text kept: a note is a few lines, and its payload is saved on every pause in typing. */
export const MAX_NOTE_TEXT = 20_000;

/** Reads a stored note payload; never fails: what is not text reads as an empty note. */
export function readNotePayload(raw: unknown): NotePayload {
  const text = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).text : undefined;
  return { text: typeof text === "string" ? text.slice(0, MAX_NOTE_TEXT) : "" };
}

/** Reads a stored file payload; null without a usable path. */
export function readFilePayload(raw: unknown): FilePayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const path = (raw as Record<string, unknown>).path;
  return typeof path === "string" && path.trim() ? { path } : null;
}
export type KanbanPriority = "none" | "low" | "medium" | "high";

export const KANBAN_PRIORITIES: readonly KanbanPriority[] = ["none", "low", "medium", "high"];

/** The GitHub issue a card mirrors; written by the GitHub sync. */
export interface KanbanGithubLink {
  repo: string;
  number: number;
  url: string;
  state: IssueState;
}

export interface KanbanCard {
  id: string;
  title: string;
  notes: string;
  /** ISO date (YYYY-MM-DD). */
  due?: string;
  priority: KanbanPriority;
  github?: KanbanGithubLink;
  /** The mission agent working on it: shown as a chip. */
  agent?: string;
  /** Its agent reported it blocked or failed: the chip turns to an alert. */
  agentStatus?: KanbanAgentStatus;
}

export type KanbanAgentStatus = "blocked" | "failed";

export interface KanbanColumn {
  id: string;
  title: string;
  cardIds: string[];
}

/** The GitHub repository a board syncs with, and optionally one of its owner's Projects (v2). */
export interface KanbanBoardLink {
  /** "owner/name". */
  repo: string;
  project?: { owner: string; number: number };
}

/** Content of a Kanban node (issue #29). */
export interface KanbanPayload {
  columns: KanbanColumn[];
  cards: Record<string, KanbanCard>;
  /** Set by "Link to GitHub". */
  github?: KanbanBoardLink;
  /**
   * Set by "Plan with the fleet": the fleet node planning one of its columns. Stored data: saved boards
   * keep this key under the name it had when the fleet was called the orchestrator, so it never changes.
   */
  orchestrator?: KanbanFleetLink;
}

/** A board's column handed to a fleet node. */
export interface KanbanFleetLink {
  nodeId: string;
  columnId: string;
}



/** Reads a stored fleet payload; a missing or blank name, or a former default one, becomes "Fleet". */
export function readFleetPayload(raw: unknown): FleetPayload {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const payload: FleetPayload = { name: typeof r.name === "string" && r.name.trim() ? renamed(r.name) : FLEET_DEFAULT_NAME };
  const session = readTerminalPayload(r.session);
  // Its session carries the same default as its name and title (`fleetSession`): Claude shows the title.
  if (session && FLEET_CAPABLE.includes(session.agent)) payload.session = { ...session, name: renamed(session.name), title: renamed(session.title), role: STORED_FLEET_ROLE };
  const mission = readMission(r.mission);
  if (mission) payload.mission = mission;
  if (r.inputOpen === true) payload.inputOpen = true;
  return payload;
}

const SHELLS = new Set<string>(["default", "powershell", "pwsh", "cmd", "gitbash"]);

/**
 * Reads a stored terminal payload, including those saved before agents and names
 * existed (`preset` instead of `agent`, no `name`). Null when it cannot be launched.
 */
export function readTerminalPayload(raw: unknown): TerminalPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const agent = typeof r.agent === "string" ? r.agent : r.preset;
  if (typeof agent !== "string" || !(AGENT_IDS as readonly string[]).includes(agent) || typeof r.cwd !== "string") {
    return null;
  }
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const payload: TerminalPayload = {
    title: text(r.title),
    name: text(r.name),
    agent: agent as AgentId,
    cwd: r.cwd,
    shell: (typeof r.shell === "string" && SHELLS.has(r.shell) ? r.shell : "default") as ShellKind,
    command: text(r.command),
  };
  if (typeof r.claudeSessionId === "string") payload.claudeSessionId = r.claudeSessionId;
  if (typeof r.codexSessionId === "string") payload.codexSessionId = r.codexSessionId;
  const ollama = r.ollama as Record<string, unknown> | undefined;
  if (ollama && typeof ollama.model === "string" && (ollama.mode === "chat" || ollama.mode === "code")) {
    payload.ollama = { model: ollama.model, mode: ollama.mode };
  }
  // A payload saved with a report and its steps not settled (before they were) reads as finished.
  const lastReport = readTerminalReport(r.lastReport);
  const steps = readSteps(r.steps);
  if (steps) payload.steps = settledSteps(steps, lastReport?.status);
  if (r.role === STORED_FLEET_ROLE) payload.role = STORED_FLEET_ROLE;
  // A Manager without its Fleet is no Manager: it would run no mission.
  if (r.role === MANAGER_ROLE && typeof r.fleet === "string" && r.fleet) {
    payload.role = MANAGER_ROLE;
    payload.fleet = r.fleet;
  }
  if (r.remoteControl === true) payload.remoteControl = true;
  if (typeof r.model === "string" && r.model) payload.model = r.model;
  const effort = readEffort(r.effort);
  if (effort) payload.effort = effort;
  if (r.permission === "ask" || r.permission === "edits" || r.permission === "work") payload.permission = r.permission;
  if (r.linear === true) payload.linear = true;
  if (r.oneShot === true) payload.oneShot = true;
  if (typeof r.accountId === "string" && r.accountId) payload.accountId = r.accountId;
  if (typeof r.spawnedBy === "string" && r.spawnedBy) payload.spawnedBy = r.spawnedBy;
  if (typeof r.task === "string" && r.task.trim()) payload.task = r.task.slice(0, MAX_STORED_TASK);
  if (r.minimized === true) payload.minimized = true;
  if (r.inputOpen === true) payload.inputOpen = true;
  if (typeof r.expandedHeight === "number" && Number.isFinite(r.expandedHeight) && r.expandedHeight > 0) payload.expandedHeight = r.expandedHeight;
  if (typeof r.expandedWidth === "number" && Number.isFinite(r.expandedWidth) && r.expandedWidth > 0) payload.expandedWidth = r.expandedWidth;
  if (lastReport) payload.lastReport = lastReport;
  const extensions = readExtensionChoice(r.extensions);
  if (extensions) payload.extensions = extensions;
  return payload;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readGithubLink(raw: unknown): KanbanGithubLink | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.repo !== "string" || typeof r.number !== "number" || !Number.isInteger(r.number) || typeof r.url !== "string") return undefined;
  if (r.state !== "open" && r.state !== "closed") return undefined;
  return { repo: r.repo, number: r.number, url: r.url, state: r.state };
}

function readKanbanCard(id: string, raw: unknown): KanbanCard | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const card: KanbanCard = {
    id,
    title: typeof r.title === "string" ? r.title : "",
    notes: typeof r.notes === "string" ? r.notes : "",
    priority: (KANBAN_PRIORITIES as readonly unknown[]).includes(r.priority) ? (r.priority as KanbanPriority) : "none",
  };
  if (typeof r.due === "string" && ISO_DATE.test(r.due)) card.due = r.due;
  const github = readGithubLink(r.github);
  if (github) card.github = github;
  if (typeof r.agent === "string" && r.agent.trim()) {
    card.agent = r.agent;
    if (r.agentStatus === "blocked" || r.agentStatus === "failed") card.agentStatus = r.agentStatus;
  }
  return card;
}

/**
 * Reads a stored Kanban payload. Never fails: unreadable cards and columns are
 * dropped, a card listed twice keeps its first place, and a card no column
 * lists is dropped with it.
 */
export function readKanbanPayload(raw: unknown): KanbanPayload {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const rawCards = typeof r.cards === "object" && r.cards !== null ? (r.cards as Record<string, unknown>) : {};
  const cards: Record<string, KanbanCard> = {};
  const columns: KanbanColumn[] = [];
  const placed = new Set<string>();
  const columnIds = new Set<string>();
  for (const column of Array.isArray(r.columns) ? r.columns : []) {
    if (typeof column !== "object" || column === null) continue;
    const c = column as Record<string, unknown>;
    if (typeof c.id !== "string" || !c.id || columnIds.has(c.id)) continue;
    columnIds.add(c.id);
    const cardIds: string[] = [];
    for (const cardId of Array.isArray(c.cardIds) ? c.cardIds : []) {
      if (typeof cardId !== "string" || placed.has(cardId)) continue;
      const card = readKanbanCard(cardId, rawCards[cardId]);
      if (!card) continue;
      placed.add(cardId);
      cards[cardId] = card;
      cardIds.push(cardId);
    }
    columns.push({ id: c.id, title: typeof c.title === "string" ? c.title : "", cardIds });
  }
  const payload: KanbanPayload = { columns, cards };
  const github = readBoardLink(r.github);
  if (github) payload.github = github;
  const fleet = r.orchestrator as Record<string, unknown> | undefined; // The stored key, see `KanbanPayload.orchestrator`.
  if (fleet && typeof fleet.nodeId === "string" && fleet.nodeId && typeof fleet.columnId === "string") {
    payload.orchestrator = { nodeId: fleet.nodeId, columnId: fleet.columnId };
  }
  return payload;
}

const REPO = /^[\w.-]+\/[\w.-]+$/;

function readBoardLink(raw: unknown): KanbanBoardLink | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.repo !== "string" || !REPO.test(r.repo)) return undefined;
  const link: KanbanBoardLink = { repo: r.repo };
  const project = r.project as Record<string, unknown> | undefined;
  if (project && typeof project.owner === "string" && project.owner && typeof project.number === "number" && Number.isInteger(project.number) && project.number > 0) {
    link.project = { owner: project.owner, number: project.number };
  }
  return link;
}
