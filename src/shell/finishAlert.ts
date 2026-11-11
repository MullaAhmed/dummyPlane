import { getCurrentWindow } from "@tauri-apps/api/window";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { toast } from "sonner";
import { finishAlertsStore } from "@/app/finishAlertsSetting";
import { nativeNotificationsStore } from "@/app/nativeNotifications";
import { onFinish, type FinishSignal } from "@/agents/finishes";
import { hasSpawnedAtWork } from "@/agents/spawnFamily";
import { clip, plainText } from "@/agents/taskSummary";
import { openAgent, type OpenAgent } from "@/agents/waitingAgents";
import { activeTerminalStore } from "@/canvas/activeTerminal";
import { nodeInSight } from "@/canvas/arrive";
import { terminalWithKeyboard } from "@/canvas/keyboardFocus";
import { goToAgent } from "@/commands/goToRun";
import { memberOf } from "@/mission/store";
import { messages } from "@/i18n";
import { agentActivityStore, type AgentActivity } from "@/store/agentActivity";
import { isManagerRecord, nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { shellMessages } from "./messages";

/**
 * A turn alerts when the agent worked this long in it, waits for the user left
 * out: a quick answer is read where it was asked, a real piece of work is what
 * the user went elsewhere during.
 */
export const MIN_WORK_MS = 20_000;
/**
 * How long an idle must last to end the turn. Without hooks (Codex, Gemini's
 * output, a hooked agent right after an answer) 1.5 s of quiet reads as idle
 * though the agent is still at it: a turn that resumes within this goes on.
 */
export const SETTLE_MS = 5_000;
/** The longest summary line, in characters: the question preview's (spec notification §7). */
export const MAX_SUMMARY = 140;

type State = FinishSignal["state"] | "finished";

interface Turn {
  /** Time spent working in it, in ms: waiting for the user does not count. */
  worked: number;
  /** The report or mission's end that already alerted for it: its end says nothing more, nor the same report again. */
  told?: string;
  /**
   * It went idle with its task still going (`stillAtWork`): the turn that the
   * news of its sub-agents or its mission wakes it for goes on with this one,
   * so a short wrap-up after long work still alerts.
   */
  held: boolean;
  /** The idle that may end it, confirmed after SETTLE_MS. */
  settling?: ReturnType<typeof setTimeout>;
}

/** The turn under way of each agent: from leaving idle to an idle that lasts. */
const turns = new Map<string, Turn>();

const warn = (error: unknown) => console.warn("finish alert failed", error);

const ESCAPES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-_])/g;
/** Controls, and the format and separator characters that can disguise a text or break its line. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
/** What starts a Markdown line without being words: a heading's #, a quote's >, a list's bullet or number, a table's |. */
const LINE_MARKERS = /^(?:\s*(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\|))+/;

/**
 * The first line of a summary that says something, as plain text: Markdown
 * marks, code, rules and table separators away, controls and escapes stripped,
 * at most MAX_SUMMARY characters. A summary written in OpenUI Lang arrives
 * here as its Markdown text (`reportTool`).
 */
export function summaryLine(summary: string): string {
  let inCode = false;
  for (const raw of summary.replace(ESCAPES, "").split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const line = plainText(raw.replace(INVISIBLE, " ").replace(LINE_MARKERS, "").replace(/\s*\|\s*$/, ""));
    if (/[\p{L}\p{N}]/u.test(line)) return clip(line, MAX_SUMMARY);
  }
  return "";
}

/**
 * Who alerts: what the user launched, and the Fleet. A sub-agent opened with
 * spawn_agent reports to its parent; a plain shell's output is no agent's
 * work. A mission's team agents alert, as their questions do (the question
 * alert covers every agent); Claude's built-in subagents are no terminals.
 */
function isMainAgent(nodeId: string): boolean {
  const record = nodesStore.getState().nodes[nodeId];
  if (record?.kind === "fleet") return true;
  if (record?.kind !== "terminal" || record.payload.agent === "shell") return false;
  // A mission's Manager works for its Fleet: the mission's end alerts once, on the Fleet.
  if (isManagerRecord(record)) return false;
  // A running mission's team agent is the Fleet's to hear: the mission's end alerts once.
  return !record.payload.spawnedBy && memberOf(nodeId) === null;
}

/**
 * Its turn ended but its task goes on: a Fleet whose mission runs (its end
 * alerts), an agent whose sub-agents still work (their reports wake it). A
 * sub-agent gone idle without reporting holds nobody: nothing will wake its
 * parent, and a report made before a reload is forgotten with it.
 */
function stillAtWork(nodeId: string): boolean {
  const record = nodesStore.getState().nodes[nodeId];
  if (record?.kind === "fleet" && record.payload.mission?.state === "en_cours") return true;
  return hasSpawnedAtWork(nodeId, (id) => agentActivityStore.getState().activities[id]?.activity !== "idle");
}

/** The keyboard is in it: an xterm's textarea, or a fleet's field. */
function keyboardIn(): string | null {
  return terminalWithKeyboard() ?? document.activeElement?.closest("[data-fleet]")?.getAttribute("data-fleet") ?? null;
}

/** In the window, the user sees it: its canvas is on screen and it is the active terminal, has the keyboard or shows. */
function lookingAt(agent: OpenAgent): boolean {
  if (projectsStore.getState().view !== "project" || agent.workspaceId !== workspacesStore.getState().activeId) return false;
  return activeTerminalStore.getState().id === agent.id || keyboardIn() === agent.id || nodeInSight(agent.id);
}

/**
 * Tells that a main agent finished. Window not focused: a Windows notification
 * (the question alert's rule, and its "Windows notifications" setting), whose
 * click comes back to the agent (`./waitingAlert`). Window focused: a notice
 * with Show, unless the user is looking at the agent. The view never moves on
 * its own: a finish asks nothing of the user.
 */
async function alert(nodeId: string, state: State, summary: string) {
  if (!finishAlertsStore.getState().enabled || !isMainAgent(nodeId)) return;
  const agent = openAgent(nodeId);
  if (!agent) return;
  const t = messages(shellMessages).finishAlert;
  const title = t.title(agent.name, t.states[state]);
  const body = summaryLine(summary) || (agent.kind === "fleet" && state !== "finished" ? t.missionOver : t.turnOver);
  if (!(await getCurrentWindow().isFocused())) {
    if (nativeNotificationsStore.getState().enabled) sendNotification({ title, body, extra: { nodeId, finished: true } });
    return;
  }
  if (lookingAt(agent)) return;
  const canShow = projectsStore.getState().view === "project";
  toast(title, {
    description: body,
    ...(canShow ? { action: { label: t.show, onClick: () => projectsStore.getState().view === "project" && goToAgent(agent) } } : {}),
  });
}

function drop(nodeId: string) {
  clearTimeout(turns.get(nodeId)?.settling);
  turns.delete(nodeId);
}

/**
 * An idle that lasted: the turn is over, and alerts if it was real work nothing
 * told yet. One that only waits for its sub-agents or its mission is held.
 */
function settle(nodeId: string) {
  const turn = turns.get(nodeId);
  if (!turn) return;
  turn.settling = undefined;
  if (agentActivityStore.getState().activities[nodeId]?.activity !== "idle") return;
  if (turn.told === undefined && stillAtWork(nodeId)) {
    turn.held = true;
    return;
  }
  turns.delete(nodeId);
  if (turn.told === undefined && turn.worked >= MIN_WORK_MS) void alert(nodeId, "finished", "").catch(warn);
}

function changed(nodeId: string, before: AgentActivity | undefined, now: AgentActivity) {
  let turn = turns.get(nodeId);
  const pausing = turn?.settling !== undefined;
  clearTimeout(turn?.settling);
  if (turn) turn.settling = undefined;
  // Out of idle, not back from a pause nor woken from a held turn: a new turn.
  const starts = !pausing && (before === undefined || before.activity === "idle") && now.activity !== "idle";
  if (!turn || (starts && !turn.held)) turn = { worked: 0, held: false };
  turns.set(nodeId, turn);
  if (before?.activity === "working") turn.worked += Math.max(0, now.since - before.since);
  if (now.activity === "idle") turn.settling = setTimeout(() => settle(nodeId), SETTLE_MS);
}

/** A report or a mission's end: it alerts now, and the turn it ends says nothing more. The same report again says nothing. */
function finished({ nodeId, state, summary }: FinishSignal) {
  const turn = turns.get(nodeId) ?? { worked: 0, held: false };
  const told = `${state}\n${summary}`;
  if (turn.told === told) return;
  turn.told = told;
  // A Fleet whose Manager ended the mission while it rested: the "board is finished" line wakes it, and that
  // wrap-up goes on with this turn, which has alerted already.
  const record = nodesStore.getState().nodes[nodeId];
  if (record?.kind === "fleet" && (agentActivityStore.getState().activities[nodeId]?.activity ?? "idle") === "idle") turn.held = true;
  turns.set(nodeId, turn);
  void alert(nodeId, state, summary).catch(warn);
}

/**
 * Alerts when a main agent finishes: it reports (done, blocked, failed), its
 * Fleet ends the mission, or its turn ends after at least MIN_WORK_MS of work.
 * One alert per finish. Installed after the activity snapshot, so a reload
 * does not replay the turns already over. Off with "Alert when an agent finishes".
 */
export function installFinishAlerts(): () => void {
  for (const nodeId of [...turns.keys()]) drop(nodeId);
  const unsubscribe = agentActivityStore.subscribe((state, previous) => {
    for (const nodeId of new Set([...Object.keys(previous.activities), ...Object.keys(state.activities)])) {
      const now = state.activities[nodeId];
      const before = previous.activities[nodeId];
      // Its process ended, or its agent exited back to the shell (`left`): no turn to finish, and a shell's output is no agent's work.
      if (!now || now.left) drop(nodeId);
      else if (now !== before && now.activity !== before?.activity) changed(nodeId, before, now);
    }
  });
  const unlisten = onFinish(finished);
  return () => {
    unsubscribe();
    unlisten();
    for (const nodeId of [...turns.keys()]) drop(nodeId);
  };
}
