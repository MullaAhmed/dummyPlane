import { messages } from "@/i18n";
import type { AgentBranch } from "@/ipc/mission";
import type { AgentId, Permission } from "@/ipc/pty";
import { cutWhole, HALF_CHARACTER } from "@/lib/cut";
import { agentMessages } from "@/mcp/messages";
import { readLevel, type Level } from "./router";
import type { TicketSource } from "./tickets";

/** The mission of a fleet, saved in its payload. */
export type MissionState = "redaction" | "plan" | "lancement" | "en_cours" | "terminee";
export type ReportStatus = "termine" | "bloque" | "echec";

/** A sub-task of the plan; `agent` is a linked agent's name, or `nouveau`. */
export interface SubTask {
  title: string;
  brief: string;
  agent: string;
  budgetMin: number;
  /** Its difficulty: with the router, its agent's model. */
  level?: Level;
  /** The linked group a new agent joins, else it goes in the mission's. */
  group?: PlanGroup;
  /** The Kanban card it handles (`board`): it follows the sub-task on its board. */
  card?: string;
  /** The agent that handed it to the Fleet (`hand_off`); absent for the Fleet's own. */
  handedBy?: string;
  /** Titles of the mission's tasks it waits for: it is handed to no agent before each is done and merged (`./waits`). */
  waitsFor?: string[];
}

/** A task waiting for a new agent. */
export type QueuedTask = Omit<SubTask, "agent">;

/** A sub-task of the plan beyond Max agents, as it waits in the queue. */
export function queuedTask(task: SubTask): QueuedTask {
  const queued: Partial<SubTask> = { ...task };
  delete queued.agent;
  return queued as QueuedTask;
}

/**
 * A change to a running mission's waiting tasks that its Fleet proposed and the user has yet to approve
 * (`./amendment`): nothing changes before. Only tasks no agent holds yet can be added, edited or dropped.
 */
export interface Amendment {
  /** What the user asked, as the Fleet restated it. */
  task: string;
  /** Tasks to add to the queue; under the title of a waiting task, one replaces it in its place. */
  tasks: QueuedTask[];
  /** Titles of the waiting tasks to drop. */
  drop: string[];
  /** Titles of the waiting tasks that `tasks` replace: one that waits no more by the time it is applied is no task to add again. */
  replaces?: string[];
}

/** A task an agent is through with, for the morning report. */
export interface PastTask {
  task: string;
  status: ReportStatus;
  summary: string;
  merged: boolean;
  spentMin: number;
  budgetMin: number;
  branch: string;
  check?: string;
}

/** A group by its id, which survives a renaming, and the name to show. */
export interface PlanGroup {
  id: string;
  name: string;
}

export interface Report {
  summary: string;
  status: ReportStatus;
  at: number;
  /** What the agent leaves to check by hand. */
  check?: string;
}

/** Why a merged agent stays open instead of closing with its merge (`cleanUpAfterMerge`). */
export type StaysOpen = "handed" | "subAgents" | "user" | "atWork";
const STAYS_OPEN: readonly string[] = ["handed", "subAgents", "user", "atWork"] satisfies readonly StaysOpen[];

/** An agent of the formed team, in its worktree. */
export interface Member {
  nodeId: string;
  name: string;
  /** The title of its sub-task. */
  task: string;
  budgetMin: number;
  /** Linked before the mission (back to the project at its end), else created for it (closed). */
  linked: boolean;
  branch: string;
  worktree: string;
  /**
   * The agent whose worktree and branch it works in, taken over by `reassign` to "new" from a holder that stopped
   * before finishing: git names them after that agent, so its merge's cleanup removes them under that name.
   */
  worktreeOf?: string;
  /** When its sub-task was typed: its events are watched from then on. */
  sentAt?: number;
  /**
   * The text of its sub-task while it is not typed yet: kept with the mission, so that a restart of dummyPlane, or
   * of its terminal, still types it once its terminal runs again (`./redeliver.ts`). Gone once `sentAt` is set.
   */
  brief?: string;
  report?: Report;
  merged?: boolean;
  /**
   * The head of its branch its last merge took in, squashed into one commit of the mission's: the next merge takes
   * only what came after it, and the cleanups know the branch is in (a squashed branch is no ancestor of the mission's).
   */
  squashed?: string;
  /** Closed once its work was merged, its worktree and branch removed (`cleanUpAfterMerge`): it takes no other sub-task. */
  cleanedUp?: true;
  /**
   * Its merge's cleanup left it open (`cleanUpAfterMerge`): the head that merge took in, and why. Its runner was told
   * once; a later merge tries again without a word, never "it closes now" again, and closes it once it is free.
   */
  leftOpen?: { head: string; why: StaysOpen };
  /**
   * The `at` of the report whose merge conflicted: while it is its latest, the agent is fixing that conflict in its
   * own worktree, and no merge of its branch starts by itself (the queue's, a `merge` of the others): only its next
   * report, or a `merge` that names it, merges it again (28 Oct, F2: a retry undid Daredevil's resolution mid-way).
   */
  conflictAt?: number;
  /** Minutes added by `prolonger`. */
  extraMin?: number;
  /** The overruns already told: 1 at 100 % of its budget, 2 at 200 %. */
  overdue?: 1 | 2;
  /** The warning at 80 % of its budget was told (`BUDGET_WARN_AT`). */
  nearTold?: true;
  /**
   * Milliseconds the whole mission only waited on the user (a dialog, an expired login) while this sub-task was open:
   * its budget does not count them (`spentMin`).
   */
  pausedMs?: number;
  /** Its sub-task went to this agent (`reattribuer`): its clock stops. */
  handedTo?: string;
  /** `next_task` started a new agent in its place: its task, blocked or failed, is dropped; `reassign` no longer finds it. */
  abandoned?: boolean;
  /** Sub-tasks it finished before taking another one (`reattribuer`). */
  done?: string[];
  /** The model the router started it on, or the one it kept. */
  model?: string;
  /** A linked agent the router did not route: it ran its own model, and keeps it after the mission (`endMission`). */
  keptModel?: true;
  /** The existing group it joined; it closes alone at the end. */
  group?: string;
  /** The tasks it went through before this one. */
  past?: PastTask[];
}

export interface Mission {
  state: MissionState;
  /**
   * An overnight run's length: the time the user is away, real time from the go-ahead. A regular mission has none: its old "global budget" setting is gone, and ignored if saved.
   */
  budgetMin?: number;
  maxAgents: number;
  name?: string;
  task?: string;
  plan?: SubTask[];
  /** Set by "Launch the mission". */
  project?: string;
  slug?: string;
  branch?: string;
  worktree?: string;
  /** The user's branch the mission was cut from: the one `land` brings its work onto. */
  base?: string;
  /** What the user is asked to land (`land`), until they answer in the Fleet's panel: only their click lands. */
  landing?: LandRequest;
  /** The group of the agents created for it. */
  frameId?: string;
  /**
   * Agents made for it that its end stopped before they joined (a reassign's or the queue's new agent): no members,
   * their names are kept so that the cleanup removes their worktrees as it does the members'.
   */
  strays?: string[];
  members: Member[];
  summary?: string;
  /** The summary as the fleet wrote it in OpenUI Lang (finish), when it did: what the panel draws. */
  summaryUi?: string;
  error?: string;
  /** The go-ahead: the night's time runs from then. */
  startedAt?: number;
  /** "finish": the members' times stop there. */
  endedAt?: number;
  /** The end of the night was told. */
  globalOverdue?: boolean;
  /**
   * The Fleet's model router switch, set: on, each agent gets the model of its sub-task's level, off vetoes the
   * router for the whole mission; unset, it follows the global setting (`@/mission/routerState`).
   */
  router?: boolean;
  /** Tasks beyond the team, in order; a new agent, in a new terminal, takes the next one. */
  queue?: QueuedTask[];
  /** Launched for the user's absence: `budgetMin` is the time away, agents' budgets are targets. */
  overnight?: boolean;
  /** The end of the night was told. */
  windDownTold?: boolean;
  /** Where an overnight mission takes its tasks. */
  tickets?: TicketSource;
  /** What its agents may do unasked; none outside a night. */
  permission?: Permission;
  /** What `finish` leaves to check by hand. */
  handChecks?: string[];
  /** The dialog was the go-ahead: the plan starts as soon as it is proposed. */
  autoLaunch?: boolean;
  /**
   * The Manager terminal that runs the mission since its go-ahead (`./manager`). A running mission without one
   * was launched before Managers existed: its Fleet runs it, the old way.
   */
  manager?: string;
  /**
   * What re-opens the Manager on its own conversation once its terminal was closed: a closed node's row goes with
   * the next scene save, its conversation's id with it. Kept from its node (`@/mission/restore`); only for the
   * Manager it names (`nodeId`).
   */
  managerSession?: ManagerSession;
  /**
   * The group its Manager and team stand in ("Mission <name>"), kept with the mission: after a restart nobody may stand
   * in it (the closed agents' elements are gone), and a re-open of the Manager or a new agent looks for it by this id,
   * never by who is in it, else it makes a second one (`@/mission/manager`).
   */
  teamFrame?: string;
  /**
   * The cards of the agents its Fleet opened with spawn_agent beside the plan, and theirs (`@/kanban/adHocCards`): each
   * agent's card on the mission's board, which its report moves. Not members: nothing of the plan follows them.
   */
  adHoc?: AdHocCard[];
  /** The Kanban board the mission runs on: its cards are its tasks. */
  board?: string;
  /** The Fleet's proposed change to the waiting tasks, while it runs; the user approves or declines it. */
  amendment?: Amendment;
  /** The board was made for the mission, not handed over by the user ("Plan with the fleet"). */
  boardMade?: boolean;
}

/** An ad-hoc agent's card, as `Mission.adHoc` keeps it: the agent's node, the board and the card on it. */
export interface AdHocCard {
  nodeId: string;
  board: string;
  card: string;
}

/** The most ad-hoc cards a mission remembers: the oldest are let go, their agents' reports no longer move a card. */
export const MAX_AD_HOC_CARDS = 200;

function readAdHoc(raw: unknown): AdHocCard[] {
  if (!Array.isArray(raw)) return [];
  const cards = raw.flatMap((entry): AdHocCard[] => {
    const r = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    return typeof r.nodeId === "string" && typeof r.board === "string" && typeof r.card === "string" ? [{ nodeId: r.nodeId, board: r.board, card: r.card }] : [];
  });
  return cards.slice(-MAX_AD_HOC_CARDS);
}

/** A Manager's node and conversation, as `Mission.managerSession` keeps them. */
export interface ManagerSession {
  nodeId: string;
  agent: AgentId;
  name: string;
  claudeSessionId?: string;
  codexSessionId?: string;
}

function readManagerSession(raw: unknown): ManagerSession | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.nodeId !== "string" || typeof r.agent !== "string" || typeof r.name !== "string") return undefined;
  return {
    nodeId: r.nodeId,
    agent: r.agent as AgentId,
    name: r.name,
    ...(typeof r.claudeSessionId === "string" && r.claudeSessionId ? { claudeSessionId: r.claudeSessionId } : {}),
    ...(typeof r.codexSessionId === "string" && r.codexSessionId ? { codexSessionId: r.codexSessionId } : {}),
  };
}

/** A question to the user: whether `tip`, the mission's head, comes onto `target`, their branch (`./land.ts`). */
export interface LandRequest {
  target: string;
  branch: string;
  tip: string;
  /** The newest commits it brings, "<short sha> <subject>"; `count` counts them all. */
  commits: string[];
  count: number;
  fastForward: boolean;
  /** When it was asked: a click on an older question does nothing. */
  at: number;
  /** The node whose call asked it (the Fleet's, the Manager's): it hears the outcome too. */
  askedBy?: string;
}

export const NEW_AGENT = "nouveau";
export const DEFAULT_MAX_AGENTS = 4;
export const MAX_AGENTS = 8;
export const MAX_QUEUE = 100;
export const NEW_MISSION: Mission = { state: "redaction", maxAgents: DEFAULT_MAX_AGENTS, members: [] };

const STATES: readonly string[] = ["redaction", "plan", "lancement", "en_cours", "terminee"];
const STATUSES: readonly string[] = ["termine", "bloque", "echec"];
const MAX_TITLE = 60;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const fold = (name: string) => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/** The fleet names agents as it reads them: case and accents aside. */
export const sameName = (a: string, b: string) => fold(a) === fold(b);

/** Text typed in a terminal ends at its first line break: briefs and messages go on one line. */
export const oneLine = (value: string) => value.replace(/\s*[\r\n]+\s*/g, " ").trim();

function readTicketSource(raw: unknown): TicketSource | undefined {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (r.kind === "backlog") return { kind: "backlog" };
  if (r.kind === "linear") return typeof r.team === "string" && typeof r.label === "string" ? { kind: "linear", team: r.team, label: r.label } : undefined;
  return r.kind === "github" && typeof r.label === "string" ? { kind: "github", label: r.label } : undefined;
}

function readPast(raw: unknown): PastTask | null {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof r.task !== "string" || typeof r.status !== "string" || !STATUSES.includes(r.status)) return null;
  return {
    task: r.task,
    status: r.status as ReportStatus,
    summary: typeof r.summary === "string" ? r.summary : "",
    merged: r.merged === true,
    spentMin: typeof r.spentMin === "number" ? r.spentMin : 0,
    budgetMin: typeof r.budgetMin === "number" ? r.budgetMin : 0,
    branch: typeof r.branch === "string" ? r.branch : "",
    ...(typeof r.check === "string" ? { check: r.check } : {}),
  };
}

function readMember(raw: unknown): Member | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.nodeId !== "string" || typeof r.name !== "string" || typeof r.branch !== "string" || typeof r.worktree !== "string") return null;
  const member: Member = {
    nodeId: r.nodeId,
    name: r.name,
    task: text(r.task),
    budgetMin: typeof r.budgetMin === "number" ? r.budgetMin : 0,
    linked: r.linked === true,
    branch: r.branch,
    worktree: r.worktree,
  };
  if (typeof r.worktreeOf === "string" && r.worktreeOf) member.worktreeOf = r.worktreeOf;
  if (typeof r.sentAt === "number") member.sentAt = r.sentAt;
  // Typed already: what was left of it is no longer to type.
  else if (typeof r.brief === "string" && r.brief) member.brief = r.brief;
  if (r.merged === true) member.merged = true;
  if (typeof r.squashed === "string" && r.squashed) member.squashed = r.squashed;
  if (r.cleanedUp === true) member.cleanedUp = true;
  const leftOpen = r.leftOpen as Record<string, unknown> | undefined;
  if (leftOpen && typeof leftOpen.head === "string" && typeof leftOpen.why === "string" && STAYS_OPEN.includes(leftOpen.why)) {
    member.leftOpen = { head: leftOpen.head, why: leftOpen.why as StaysOpen };
  }
  // Read back after a restart: the agent may still be fixing that conflict, and no merge may retry it meanwhile.
  if (typeof r.conflictAt === "number") member.conflictAt = r.conflictAt;
  const report = r.report as Record<string, unknown> | undefined;
  if (report && typeof report.summary === "string" && typeof report.status === "string" && STATUSES.includes(report.status)) {
    member.report = { summary: report.summary, status: report.status as ReportStatus, at: typeof report.at === "number" ? report.at : 0, ...(typeof report.check === "string" ? { check: report.check } : {}) };
  }
  if (typeof r.extraMin === "number") member.extraMin = r.extraMin;
  if (r.overdue === 1 || r.overdue === 2) member.overdue = r.overdue;
  if (r.nearTold === true) member.nearTold = true;
  if (typeof r.pausedMs === "number" && r.pausedMs > 0) member.pausedMs = r.pausedMs;
  if (typeof r.handedTo === "string") member.handedTo = r.handedTo;
  if (r.abandoned === true) member.abandoned = true;
  if (Array.isArray(r.done)) member.done = r.done.filter((title): title is string => typeof title === "string");
  if (typeof r.model === "string" && r.model) member.model = r.model;
  if (r.keptModel === true) member.keptModel = true;
  if (typeof r.group === "string") member.group = r.group;
  if (Array.isArray(r.past)) member.past = r.past.map(readPast).filter((p): p is PastTask => p !== null);
  return member;
}

function isQueued(raw: unknown): raw is QueuedTask {
  const r = raw as Record<string, unknown>;
  return typeof raw === "object" && raw !== null && typeof r.title === "string" && typeof r.brief === "string" && typeof r.budgetMin === "number";
}

const isSubTask = (raw: unknown): raw is SubTask => isQueued(raw) && typeof (raw as unknown as Record<string, unknown>).agent === "string";

function readSubTask(task: SubTask): SubTask {
  return { ...readQueued(task), agent: task.agent };
}

function readQueued(task: QueuedTask): QueuedTask {
  const { title, brief, budgetMin } = task;
  const level = readLevel(task.level);
  const group = task.group as Partial<PlanGroup> | undefined;
  const waitsFor = Array.isArray(task.waitsFor) ? task.waitsFor.filter((name): name is string => typeof name === "string" && name !== "") : [];
  return {
    title,
    brief,
    budgetMin,
    ...(level ? { level } : {}),
    ...(typeof group?.id === "string" && typeof group.name === "string" ? { group: { id: group.id, name: group.name } } : {}),
    ...(typeof task.card === "string" && task.card ? { card: task.card } : {}),
    ...(typeof task.handedBy === "string" && task.handedBy ? { handedBy: task.handedBy } : {}),
    ...(waitsFor.length > 0 ? { waitsFor } : {}),
  };
}

function readAmendment(raw: unknown): Amendment | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const tasks = Array.isArray(r.tasks) ? r.tasks.filter(isQueued).map(readQueued) : [];
  const drop = Array.isArray(r.drop) ? r.drop.filter((title): title is string => typeof title === "string" && title !== "") : [];
  if (typeof r.task !== "string" || (tasks.length === 0 && drop.length === 0)) return undefined;
  const replaces = Array.isArray(r.replaces) ? r.replaces.filter((title): title is string => typeof title === "string" && title !== "") : [];
  return { task: r.task, tasks, drop, ...(replaces.length > 0 ? { replaces } : {}) };
}

/** A saved mission; undefined when absent or unreadable. A launch cut short by a restart is back to its plan. */
export function readMission(raw: unknown): Mission | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.state !== "string" || !STATES.includes(r.state)) return undefined;
  const mission: Mission = {
    state: r.state === "lancement" ? "plan" : (r.state as MissionState),
    maxAgents: typeof r.maxAgents === "number" ? r.maxAgents : DEFAULT_MAX_AGENTS,
    members: Array.isArray(r.members) ? r.members.map(readMember).filter((m): m is Member => m !== null) : [],
  };
  // Only a night has a length: a regular mission saved with the old global budget drops it.
  if (typeof r.budgetMin === "number" && r.overnight === true) mission.budgetMin = r.budgetMin;
  for (const key of ["name", "task", "project", "slug", "branch", "worktree", "base", "frameId", "summary", "summaryUi", "error", "manager", "board", "teamFrame"] as const) {
    if (typeof r[key] === "string") mission[key] = r[key];
  }
  if (Array.isArray(r.plan)) mission.plan = r.plan.filter(isSubTask).map(readSubTask);
  if (Array.isArray(r.queue)) mission.queue = r.queue.filter(isQueued).map(readQueued);
  // Only a running mission has waiting tasks to change: a proposal the mission outlived has nothing to apply to.
  const amendment = r.state === "en_cours" ? readAmendment(r.amendment) : undefined;
  if (amendment) mission.amendment = amendment;
  if (typeof r.startedAt === "number") mission.startedAt = r.startedAt;
  if (typeof r.endedAt === "number") mission.endedAt = r.endedAt;
  if (r.globalOverdue === true) mission.globalOverdue = true;
  if (typeof r.router === "boolean") mission.router = r.router;
  if (r.overnight === true) mission.overnight = true;
  if (r.windDownTold === true) mission.windDownTold = true;
  const tickets = readTicketSource(r.tickets);
  if (tickets) mission.tickets = tickets;
  if (r.autoLaunch === true) mission.autoLaunch = true;
  if (r.boardMade === true) mission.boardMade = true;
  const managerSession = readManagerSession(r.managerSession);
  if (managerSession) mission.managerSession = managerSession;
  const adHoc = readAdHoc(r.adHoc);
  if (adHoc.length > 0) mission.adHoc = adHoc;
  if (Array.isArray(r.handChecks)) mission.handChecks = r.handChecks.filter((line): line is string => typeof line === "string");
  if (Array.isArray(r.strays)) mission.strays = r.strays.filter((name): name is string => typeof name === "string" && name !== "");
  if (r.permission === "ask" || r.permission === "edits" || r.permission === "work") mission.permission = r.permission;
  const landing = readLandRequest(r.landing);
  if (landing) mission.landing = landing;
  return mission;
}

/** A question to land that was waiting for the user: it still waits after a restart. */
function readLandRequest(raw: unknown): LandRequest | undefined {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof r.target !== "string" || typeof r.branch !== "string" || typeof r.tip !== "string" || typeof r.at !== "number") return undefined;
  const commits = Array.isArray(r.commits) ? r.commits.filter((line): line is string => typeof line === "string") : [];
  return { target: r.target, branch: r.branch, tip: r.tip, commits, count: typeof r.count === "number" ? r.count : commits.length, fastForward: r.fastForward === true, at: r.at, ...(typeof r.askedBy === "string" ? { askedBy: r.askedBy } : {}) };
}

/**
 * What a sub-task of the plan and a queued task share, read from internal names, or what is wrong. `mission.router`
 * is read as its caller resolved it (`@/mission/launch` levelsRequired): on, where a level picks the team's model,
 * every task needs one.
 */
export function readTaskFields(r: Record<string, unknown>, n: number, mission: Mission): Omit<QueuedTask, "group"> | string {
  const e = messages(agentMessages).plan;
  const title = text(r.titre);
  const brief = text(r.consigne);
  const budget = r.budget_min;
  if (!title) return e.title(n, MAX_TITLE);
  // A title is an identifier (`reassign`, `team`), so it is never cut for the caller: the refusal says how long it is
  // and offers a cut at a word, so that the next call needs no guess.
  if (title.length > MAX_TITLE) return e.titleLong(n, MAX_TITLE, title.length, shortTitle(title));
  if (!brief) return e.brief(n);
  if (typeof budget !== "number" || !Number.isInteger(budget) || budget < 1) return e.budget(n);
  // The night is real time: agents in parallel share it, only one sub-task alone could not fit.
  const night = nightMin(mission);
  if (night !== undefined && budget > night) return e.overBudget(n, budget, night);
  const given = r.niveau !== undefined && r.niveau !== null;
  const level = readLevel(r.niveau);
  if (given && !level) return e.level(n);
  if (mission.router && !level) return e.levelRouter(n);
  const waitsFor = readWaits(r.waits_for);
  if (!waitsFor) return e.waitsFor(n);
  return { title, brief, budgetMin: budget, ...(level ? { level } : {}), ...(waitsFor.length > 0 ? { waitsFor } : {}) };
}

/** The titles a task waits for, as typed and once each; null when `waits_for` is not a list of titles. Whether they exist is `./waits`'. */
function readWaits(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((name) => typeof name !== "string" || !text(name))) return null;
  const names: string[] = [];
  for (const name of raw.map(text)) if (!names.some((other) => sameName(other, name))) names.push(name);
  return names;
}

/** `title` cut to the limit at its last word, when that keeps more than half of it. */
function shortTitle(title: string): string {
  const cut = cutWhole(title, MAX_TITLE);
  const space = cut.lastIndexOf(" ");
  return (space > MAX_TITLE / 2 ? cut.slice(0, space) : cut).trimEnd();
}

/** Where a title is held, for the refusal of a task that reuses it. */
export type TitleHolder = { kind: "plan" } | { kind: "queue" } | { kind: "agent"; name: string; done: boolean } | { kind: "call"; n: number };
interface TakenTitle {
  title: string;
  by: TitleHolder;
}

/** The titles the mission's tasks already use: `reassign` and `team` name a task by its title. */
const takenTitles = (mission: Mission, withPlan: boolean): TakenTitle[] => [
  ...(withPlan ? (mission.plan ?? []).map((s): TakenTitle => ({ title: s.title, by: { kind: "plan" } })) : []),
  ...(mission.queue ?? []).map((s): TakenTitle => ({ title: s.title, by: { kind: "queue" } })),
  ...mission.members.flatMap((m): TakenTitle[] => [
    { title: m.task, by: { kind: "agent", name: m.name, done: false } },
    ...(m.done ?? []).map((title): TakenTitle => ({ title, by: { kind: "agent", name: m.name, done: true } })),
  ]),
];

/** Who holds `title` among `taken`, if anyone. */
const heldBy = (taken: readonly TakenTitle[], title: string) => taken.find((t) => sameName(t.title, title))?.by;

/** The card a task names, "" for none; null when it is not one of `cards`. */
export function namedCard(r: Record<string, unknown>, cards: readonly string[]): string | null {
  if (r.card === undefined || r.card === null) return "";
  const card = text(r.card);
  return cards.includes(card) ? card : null;
}

/** `add_tasks`' arguments as tasks for the queue, or what is wrong. `cards`: ids of the cards of its linked boards. */
export function proposedTasks(args: Record<string, unknown>, mission: Mission, groups: readonly PlanGroup[], cards: readonly string[] = []): QueuedTask[] | string {
  const e = messages(agentMessages).plan;
  const raw = args.tasks;
  if (!Array.isArray(raw) || raw.length === 0) return e.atLeastOne;
  // A pending plan's sub-tasks beyond Max agents join the queue at the go-ahead.
  const planned = mission.state === "plan" || mission.state === "lancement" ? Math.max(0, (mission.plan?.length ?? 0) - mission.maxAgents) : 0;
  if ((mission.queue?.length ?? 0) + planned + raw.length > MAX_QUEUE) return e.queueFull(MAX_QUEUE);
  const taken = takenTitles(mission, true);
  const tasks: QueuedTask[] = [];
  for (const [i, item] of raw.entries()) {
    const r = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const fields = readTaskFields(r, i + 1, mission);
    if (typeof fields === "string") return fields;
    const clash = heldBy(taken, fields.title);
    if (clash) return e.titleTaken(i + 1, fields.title, clash);
    const wanted = text(r.groupe);
    const group = wanted ? groups.find((g) => sameName(g.name, wanted)) : undefined;
    if (wanted && !group) return e.notLinkedGroup(i + 1, wanted);
    const card = namedCard(r, cards);
    if (card === null) return e.card(i + 1, String(r.card));
    taken.push({ title: fields.title, by: { kind: "call", n: i + 1 } });
    tasks.push({ ...fields, ...(group ? { group: { id: group.id, name: group.name } } : {}), ...(card ? { card } : {}) });
  }
  return tasks;
}

/**
 * `propose_plan`'s arguments (internal names, `@/mcp/protocol`) as a plan, or what is wrong.
 * `linked`: names of the linked Claude agents; `groups`: the linked groups; `cards`: ids of the cards of its linked boards.
 */
export function proposedPlan(
  args: Record<string, unknown>,
  mission: Mission,
  linked: readonly string[],
  groups: readonly PlanGroup[] = [],
  cards: readonly string[] = [],
): { name: string; task: string; plan: SubTask[] } | string {
  const e = messages(agentMessages).plan;
  const name = text(args.nom);
  if (!name || name.length > MAX_TITLE) return e.name(MAX_TITLE);
  const task = text(args.tache);
  if (!task) return e.task;
  const raw = args.sous_taches;
  if (!Array.isArray(raw) || raw.length === 0) return e.atLeastOne;
  // Beyond Max agents, sub-tasks wait in the queue at the go-ahead.
  if ((mission.queue?.length ?? 0) + Math.max(0, raw.length - mission.maxAgents) > MAX_QUEUE) return e.queueFull(MAX_QUEUE);
  const plan: SubTask[] = [];
  // A plan replaces the pending one: only the queue's titles stand against it.
  const taken = takenTitles(mission, false);
  for (const [i, item] of raw.entries()) {
    const r = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const n = i + 1;
    const fields = readTaskFields(r, n, mission);
    if (typeof fields === "string") return fields;
    const agent = text(r.agent);
    const known = sameName(agent, NEW_AGENT) ? NEW_AGENT : linked.find((l) => sameName(l, agent));
    if (!known) return e.notLinked(n, agent);
    // The queue names no agent: whoever has a seat first takes the task.
    if (known !== NEW_AGENT && n > mission.maxAgents) return e.waitsForNew(n, mission.maxAgents);
    if (known !== NEW_AGENT && plan.some((s) => s.agent === known)) return e.alreadyHas(known);
    // Waiting for others, it starts from the queue: a linked agent's sub-task starts at the go-ahead.
    if (known !== NEW_AGENT && fields.waitsFor) return e.waitsForAgent(n);
    const clash = heldBy([...taken, ...plan.map((s, j): TakenTitle => ({ title: s.title, by: { kind: "call", n: j + 1 } }))], fields.title);
    if (clash) return e.titleTaken(n, fields.title, clash);
    const wanted = text(r.groupe);
    if (wanted && known !== NEW_AGENT) return e.groupForNew(n);
    const group = wanted ? groups.find((g) => sameName(g.name, wanted)) : undefined;
    if (wanted && !group) return e.notLinkedGroup(n, wanted);
    const card = namedCard(r, cards);
    if (card === null) return e.card(n, String(r.card));
    plan.push({ ...fields, agent: known, ...(group ? { group: { id: group.id, name: group.name } } : {}), ...(card ? { card } : {}) });
  }
  return { name, task, plan };
}

const MINUTE = 60_000;

/** How long a night runs: the user's time away. A regular mission has no overall limit, whatever it was saved with. */
export function nightMin(mission: Mission): number | undefined {
  return mission.overnight ? mission.budgetMin : undefined;
}

/** What is kept of a task when its agent takes another. */
export function pastTask(member: Member, report: Report): PastTask {
  return {
    task: member.task,
    status: report.status,
    summary: report.summary,
    merged: member.merged === true,
    spentMin: spentMin(member, report.at),
    budgetMin: member.budgetMin,
    branch: member.branch,
    ...(report.check ? { check: report.check } : {}),
  };
}

/** The sub-tasks `reassign` takes, by the members holding them: not handed over, nor left by `next_task`. */
export const reassignable = (mission: Mission) => mission.members.filter((m) => !m.handedTo && !m.abandoned);

/** How short a start of a title may be to name it: below, "T1" would fit every task of a series. */
const MIN_TITLE_START = 3;

/**
 * The sub-tasks `reassign` takes that `given` names without being their exact title: the name of the agent holding
 * one, the id of its card, or the start of its title (case and accents aside). Several fit when a start is shared:
 * the caller then names none of them by guess.
 */
export function subTasksNamedBy(mission: Mission, given: string): Member[] {
  const wanted = fold(given);
  if (!wanted) return [];
  return reassignable(mission).filter((m) => {
    if (fold(m.name) === wanted) return true;
    const card = mission.plan?.find((s) => s.title === m.task)?.card;
    if (card && fold(card) === wanted) return true;
    return wanted.length >= MIN_TITLE_START && fold(m.task).startsWith(wanted);
  });
}

/** The agents whose worktrees a mission's cleanup removes: its members, and those its end left behind (`strays`). */
export const worktreeOwners = (mission: Mission): AgentBranch[] => [
  ...mission.members.map((m) => ({ name: m.name, ...(m.squashed ? { squashed: m.squashed } : {}) })),
  ...(mission.strays ?? []).map((name) => ({ name })),
];

/**
 * The commit message an agent's work is squashed under: its sub-task's title, then what its report said and what it
 * leaves to check by hand. Never a branch's name. Half a character is dropped: the message goes to git through Rust.
 */
export function squashMessage(member: Pick<Member, "task" | "report">): string {
  const summary = member.report?.summary.trim();
  const check = member.report?.check?.trim();
  const body = [summary, check ? `To check by hand: ${check}` : ""].filter((part): part is string => !!part);
  return [oneLine(member.task), ...body].join("\n\n").replace(HALF_CHARACTER, "");
}

/** Its last merge conflicted, and it has not reported since: it is fixing that conflict (`Member.conflictAt`). */
export const conflictPending = (member: Pick<Member, "conflictAt" | "report">) => member.conflictAt !== undefined && member.conflictAt === member.report?.at;

/** A member's budget with its extensions. */
export const budgetOf = (member: Member) => member.budgetMin + (member.extraMin ?? 0);

/**
 * Minutes a member has spent: from its sub-task's sending to its report, in real time, less the time the whole
 * mission only waited on the user (`pausedMs`): a login that expired overnight is not the agent's time.
 */
export function spentMin(member: Member, now: number): number {
  if (member.sentAt === undefined) return 0;
  return Math.max(0, ((member.report?.at ?? now) - member.sentAt - (member.pausedMs ?? 0)) / MINUTE);
}

/**
 * A member's time as shown: it stops at its report, else at the mission's end
 *. Unknown for a mission ended before end times
 * were kept: its members without a report would count on forever.
 */
export function memberTime(mission: Mission, member: Member, now: number): number | undefined {
  if (member.report || mission.state !== "terminee") return spentMin(member, now);
  return mission.endedAt === undefined ? undefined : spentMin(member, mission.endedAt);
}

export interface Overrun {
  nodeId: string;
  name: string;
  task: string;
  level: 1 | 2;
  budget: number;
}

/**
 * What the clock has to tell: the members past 100 % or 200 % of
 * their budget without a report, each step once, and the end of the night.
 */
export function overruns(mission: Mission, now: number): { members: Overrun[]; global: boolean } {
  if (mission.state !== "en_cours") return { members: [], global: false };
  const members = mission.members.flatMap((m): Overrun[] => {
    if (m.sentAt === undefined || m.report || m.handedTo) return [];
    const ratio = spentMin(m, now) / budgetOf(m);
    const level = ratio >= 2 ? 2 : ratio >= 1 ? 1 : 0;
    return level > (m.overdue ?? 0) ? [{ nodeId: m.nodeId, name: m.name, task: m.task, level: level as 1 | 2, budget: budgetOf(m) }] : [];
  });
  const night = nightMin(mission);
  const global = night !== undefined && mission.startedAt !== undefined && !mission.globalOverdue && (now - mission.startedAt) / MINUTE >= night;
  return { members, global };
}

/** The share of a budget at which its agent's runner is warned, before it is used up. */
export const BUDGET_WARN_AT = 0.8;

export interface NearBudget {
  nodeId: string;
  name: string;
  task: string;
  budget: number;
  /** Whole minutes left of the budget. */
  left: number;
}

/**
 * The members at 80 % of their budget with no report, each told once. Not overnight: a night's budgets are targets
 * and nobody is there to extend them. One that went past 100 % between two looks is told that overrun, not this.
 */
export function nearBudgets(mission: Mission, now: number): NearBudget[] {
  if (mission.state !== "en_cours" || mission.overnight) return [];
  return mission.members.flatMap((m): NearBudget[] => {
    if (m.sentAt === undefined || m.report || m.handedTo || m.abandoned || m.nearTold || m.overdue) return [];
    const budget = budgetOf(m);
    const spent = spentMin(m, now);
    if (spent < BUDGET_WARN_AT * budget || spent >= budget) return [];
    return [{ nodeId: m.nodeId, name: m.name, task: m.task, budget, left: Math.max(1, Math.ceil(budget - spent)) }];
  });
}

/** The whole minutes left of the night, real time from the go-ahead; undefined outside one. */
export function remainingGlobal(mission: Mission, now: number): number | undefined {
  const night = nightMin(mission);
  if (night === undefined) return undefined;
  if (mission.startedAt === undefined) return night;
  return Math.max(0, Math.ceil(night - ((mission.endedAt ?? now) - mission.startedAt) / MINUTE));
}

/** The last minutes of an overnight mission keep the time to merge and finish: 10 %, 10 min at least, half of a short one. */
export const windDownMin = (budget: number) => Math.min(budget / 2, Math.max(10, budget / 10));

/** An overnight mission near its end: no new work, the fleet wraps up. */
export function windingDown(mission: Mission, now: number): boolean {
  if (!mission.overnight || mission.budgetMin === undefined || mission.startedAt === undefined) return false;
  return (now - mission.startedAt) / MINUTE >= mission.budgetMin - windDownMin(mission.budgetMin);
}

/** No new work starts: the night is winding down or over. */
export function noNewWork(mission: Mission, now: number): boolean {
  return windingDown(mission, now) || (mission.startedAt !== undefined && remainingGlobal(mission, now) === 0);
}

export type BudgetTone = "ok" | "late" | "over";

/** The tone of the complete bar of a reported member: done is ok, blocked waits, failed is in danger. */
const REPORT_TONE: Record<ReportStatus, BudgetTone> = { termine: "ok", bloque: "late", echec: "over" };

/**
 * A budget's bar: green, orange past 80 %, red past 100 %. A member
 * that reported is finished, its time frozen: its bar is complete, in the tone of its report.
 */
export function budgetBar(spent: number, budget: number, report?: ReportStatus): { ratio: number; tone: BudgetTone } {
  if (report) return { ratio: 1, tone: REPORT_TONE[report] };
  const ratio = budget > 0 ? spent / budget : 0;
  return { ratio: Math.min(1, ratio), tone: ratio > 1 ? "over" : ratio > 0.8 ? "late" : "ok" };
}

/** The fleet's header during a mission: time spent, over the night's length if overnight. */
export function clockText(mission: Mission, now: number): string | null {
  if (mission.state !== "en_cours" || mission.startedAt === undefined) return null;
  const spent = Math.floor((now - mission.startedAt) / MINUTE);
  const night = nightMin(mission);
  return night === undefined ? `${spent} min` : `${spent} / ${night} min`;
}
