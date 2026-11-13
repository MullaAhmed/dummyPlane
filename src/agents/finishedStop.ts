import { subagentSettingsStore } from "@/app/subagentSettings";
import { ptyWrite } from "@/ipc/pty";
import { moving } from "@/mission/active";
import { pendingEvents } from "@/mission/events";
import { whenReady } from "@/mission/ready";
import { missionOf } from "@/mission/store";
import { canResume, relaunchMode } from "@/nodes/terminal/launch";
import { freshText, hasFocus, isLiveInRust, quietFor, relaunchTerminal, stopTerminal, touchedAgo } from "@/nodes/terminal/registry";
import type { TerminalPayload, TerminalReport } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { isManagerRecord, nodesStore, terminalOf, type NodeRecord } from "@/store/nodes";
import { isRestarting, isRunning, terminalStatusStore, waitForExit } from "@/store/terminalStatus";
import { hasSpawnedAtWork, isLaunching } from "./spawnFamily";

/**
 * A sub-agent that reported done and shrank to its card (`@/nodes/terminal/minimize`) stops its process a minute
 * later, to free its memory: its saved screen and its conversation stay, so its card reads what it last showed, and
 * an expand, or new work its parent or its Manager gives it, starts it again on its own conversation. The minute
 * lets a parent's follow-up reach it first. Blocked and failed agents run on: someone has to look at them.
 * "Stop finished agents" in Settings turns it off.
 */

/** How long a finished agent shrunk to its card runs on before its process stops. */
export const FINISHED_STOP_DELAY_MS = 60_000;

/** The stops waiting for their minute, by terminal. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** The report whose stop was given up, by terminal: the user came to it, it is theirs until its next report. */
const declined = new Map<string, TerminalReport>();
/** The finished agents starting again, by terminal: true once their CLI's prompt is up. */
const wakes = new Map<string, Promise<boolean>>();

/**
 * A terminal whose process may stop once it has finished: a sub-agent (spawned by another agent, a Manager's team
 * agents included) whose CLI can take its conversation up again. Never a top-level agent, a Fleet, a Manager, a
 * shell, a one-shot command, a Remote Control session the user may follow from their phone, nor a CLI that would
 * start a new conversation (any but Claude, and Codex once it saved its thread).
 */
export function stoppable(record: NodeRecord | undefined): boolean {
  const payload = terminalOf(record);
  if (!payload || isManagerRecord(record)) return false;
  return Boolean(payload.spawnedBy) && !payload.role && payload.agent !== "shell" && !payload.oneShot && !payload.remoteControl && canResume(payload);
}

/** Its process runs: shown, or still alive in Rust after a webview reload, not attached again yet. */
const alive = (nodeId: string) => isRunning(nodeId) || isLiveInRust(nodeId);

const finished = (payload: TerminalPayload) => payload.lastReport?.status === "done" && payload.minimized === true && !payload.stoppedFinished;

/** Whether a terminal's stop is to wait for its minute now. */
function due(nodeId: string): boolean {
  const record = nodesStore.getState().nodes[nodeId];
  const payload = terminalOf(record);
  return subagentSettingsStore.getState().stopFinished && payload !== undefined && stoppable(record) && finished(payload) && alive(nodeId);
}

function disarm(nodeId: string) {
  const timer = timers.get(nodeId);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(nodeId);
}

function arm(nodeId: string) {
  disarm(nodeId);
  timers.set(
    nodeId,
    setTimeout(() => fire(nodeId), FINISHED_STOP_DELAY_MS),
  );
}

/**
 * Arms a terminal's stop when it is due, disarms it when it no longer is (new work cleared its report, it was
 * expanded, it stopped): each change starts from nothing, so a card minimized again waits a whole new minute.
 */
function look(nodeId: string) {
  if (!due(nodeId)) {
    disarm(nodeId);
    declined.delete(nodeId);
    return;
  }
  const report = terminalOf(nodesStore.getState().nodes[nodeId])?.lastReport;
  if (timers.has(nodeId) || declined.get(nodeId) === report) return;
  arm(nodeId);
}

/** A mission member its Manager is moving on: its branch merging (`moving`), a sub-task handed to it and not typed yet. */
function handedWork(nodeId: string): boolean {
  return Object.values(nodesStore.getState().nodes).some((record) => {
    const mission = missionOf(record);
    if (mission?.state !== "en_cours") return false;
    return mission.members.some((m) => m.nodeId === nodeId && !m.handedTo && (moving.has(nodeId) || !m.report || m.brief !== undefined));
  });
}

/** Something under way that its stop would cut: it waits one more minute. */
function busy(nodeId: string): boolean {
  const activity = agentActivityStore.getState().activities[nodeId]?.activity;
  return (
    isRestarting(nodeId) ||
    wakes.has(nodeId) ||
    isLaunching(nodeId) ||
    pendingEvents(nodeId).length > 0 ||
    activity === "working" ||
    activity === "waiting" ||
    // Its own sub-agents' reports are typed into it: stopped, it would never hear them.
    hasSpawnedAtWork(nodeId) ||
    handedWork(nodeId)
  );
}

function fire(nodeId: string) {
  timers.delete(nodeId);
  if (!due(nodeId)) return;
  // The user is at it, or was this last minute: it stays running, theirs, until its next report.
  if (hasFocus(nodeId) || touchedAgo(nodeId) < FINISHED_STOP_DELAY_MS) {
    const report = terminalOf(nodesStore.getState().nodes[nodeId])?.lastReport;
    if (report) declined.set(nodeId, report);
    return;
  }
  if (busy(nodeId)) {
    arm(nodeId);
    return;
  }
  // Marked before the kill: its exit is no crash to tell its mission of (`@/mission/events`), and its card reads its report.
  nodesStore.getState().update(nodeId, { stoppedFinished: true });
  stopTerminal(nodeId);
  // A process that would not stop runs on: it is no stopped one.
  void waitForExit(nodeId).then(() => {
    if (isRunning(nodeId)) nodesStore.getState().update(nodeId, { stoppedFinished: undefined });
  });
}

/** Resolves once no restart of the terminal is under way. */
function restartEnded(nodeId: string): Promise<void> {
  return new Promise((resolve) => {
    if (!isRestarting(nodeId)) return resolve();
    const off = terminalStatusStore.subscribe(() => {
      if (isRestarting(nodeId)) return;
      off();
      resolve();
    });
  });
}

/** Starts it again on its own conversation (a restart under way is waited for, not doubled), then waits for its CLI's prompt. */
async function wake(nodeId: string, slow?: () => void): Promise<boolean> {
  const payload = terminalOf(nodesStore.getState().nodes[nodeId]);
  if (!payload) return false;
  // Called before anything is awaited: from this tick on it is restarting, and a keystroke starts no second one.
  if (isRestarting(nodeId)) await restartEnded(nodeId);
  else if (!isRunning(nodeId)) await relaunchTerminal(nodeId, payload, relaunchMode(payload));
  if (!isRunning(nodeId)) return false;
  return whenReady({
    running: () => isRunning(nodeId),
    quietMs: () => quietFor(nodeId),
    screen: () => freshText(nodeId, 50),
    press: (keys) => ptyWrite(nodeId, keys),
    agent: payload.agent,
    // A question only the user answers (a project's new MCP server) may hold its prompt past the minute.
    waitLonger: () => isRunning(nodeId),
    slow,
  });
}

/**
 * A finished agent new work reaches, or the user expanded: started again on its own conversation, once. True once
 * its prompt is up and a line typed now reaches it; false when it did not start or its session did not open.
 * `slow`: told once when its session takes more than a minute.
 */
export function wakeFinished(nodeId: string, slow?: () => void): Promise<boolean> {
  const under = wakes.get(nodeId);
  if (under) return under;
  const woken: Promise<boolean> = wake(nodeId, slow)
    .catch((error: unknown) => {
      console.warn(`terminal ${nodeId}: finished agent not started again`, error);
      return false;
    })
    .finally(() => {
      if (wakes.get(nodeId) === woken) wakes.delete(nodeId);
    });
  wakes.set(nodeId, woken);
  return woken;
}

/** The start under way of a finished agent (`wakeFinished`): a line for it waits for it, else it would land in its shell. */
export function wakingUp(nodeId: string): Promise<boolean> | undefined {
  return wakes.get(nodeId);
}

/**
 * A stopped finished agent that new work starts again on its conversation: one this feature stopped
 * (`stoppedFinished`), or, for its parent `parentId`, a sub-agent of its that reported and stopped since (an app
 * restart leaves finished sub-agents stopped: `@/agents/resumable`). Never one alive in Rust, not attached yet.
 */
export function wakeable(nodeId: string, parentId?: string): boolean {
  const payload = terminalOf(nodesStore.getState().nodes[nodeId]);
  if (!payload || !canResume(payload)) return false;
  const finishedOne = wakes.has(nodeId) || payload.stoppedFinished === true || (parentId !== undefined && payload.spawnedBy === parentId && payload.lastReport !== undefined);
  return finishedOne && !alive(nodeId);
}

/**
 * For the app's life, installed at boot once the sessions alive in Rust are known: the stops follow the nodes, their
 * statuses and the setting. A stopped one the user expands starts again; one that runs again is no longer stopped.
 */
export function installFinishedStops(): () => void {
  for (const nodeId of Object.keys(nodesStore.getState().nodes)) look(nodeId);
  const offNodes = nodesStore.subscribe((state, previous) => {
    for (const [nodeId, record] of Object.entries(state.nodes)) {
      const before = previous.nodes[nodeId];
      if (record === before) continue;
      const payload = terminalOf(record);
      // Expanded, it shows its conversation going on, not a stopped screen to resume by hand.
      if (terminalOf(before)?.minimized && !payload?.minimized && payload?.stoppedFinished && !alive(nodeId)) void wakeFinished(nodeId);
      look(nodeId);
    }
    for (const nodeId of Object.keys(previous.nodes)) {
      if (state.nodes[nodeId]) continue;
      disarm(nodeId);
      declined.delete(nodeId);
    }
  });
  const offStatuses = terminalStatusStore.subscribe((state, previous) => {
    if (state.statuses === previous.statuses) return;
    for (const nodeId of new Set([...Object.keys(previous.statuses), ...Object.keys(state.statuses)])) {
      const status = state.statuses[nodeId];
      if (status === previous.statuses[nodeId]) continue;
      const started = status?.state === "running" && previous.statuses[nodeId]?.state !== "running";
      if (started && terminalOf(nodesStore.getState().nodes[nodeId])?.stoppedFinished) nodesStore.getState().update(nodeId, { stoppedFinished: undefined });
      look(nodeId);
    }
  });
  const offSetting = subagentSettingsStore.subscribe((state, previous) => {
    if (state.stopFinished === previous.stopFinished) return;
    for (const nodeId of Object.keys(nodesStore.getState().nodes)) look(nodeId);
  });
  return () => {
    offNodes();
    offStatuses();
    offSetting();
    for (const nodeId of [...timers.keys()]) disarm(nodeId);
    declined.clear();
  };
}
