import { talk } from "@/agents/talkWires";
import { messages } from "@/i18n";
import { ptySendText } from "@/ipc/pty";
import { agentMessages } from "@/mcp/messages";
import { freshText, quietFor, typedAgo } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { isManagerRecord, nodesStore, nodeNameOf, sessionOf } from "@/store/nodes";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";
import { remoteBusy } from "@/agents/remoteControl";
import { whenReady } from "./ready";
import { managedFleet, memberOf, missionOf, missionRunner } from "./store";

/** Lines waiting for their fleet to be free. */
const queues = new Map<string, { line: string; typed?: () => void }[]>();
/** Fleets just (re)started whose CLI's prompt is not up yet (final review H2). */
const starting = new Set<string>();

/** A line waits this long after the user's last keystroke: it would be typed into their half-written text. */
export const TYPING_PAUSE_MS = 4000;

/** A fleet takes a line while its Claude's prompt is up and no dialog waits for the user. */
function free(fleetId: string): boolean {
  return (
    isRunning(fleetId) &&
    !starting.has(fleetId) &&
    agentActivityStore.getState().activities[fleetId]?.activity !== "waiting"
  );
}

function flush(fleetId: string) {
  const queue = queues.get(fleetId);
  if (!queue?.length || !free(fleetId)) return;
  // A line typed while the Remote Control menu is open would land in the menu.
  if (remoteBusy(fleetId)) {
    setTimeout(() => flush(fleetId), 1000);
    return;
  }
  const sinceKey = typedAgo(fleetId);
  if (sinceKey < TYPING_PAUSE_MS) {
    // Looked at again when the pause is over.
    setTimeout(() => flush(fleetId), TYPING_PAUSE_MS - sinceKey + 50);
    return;
  }
  queues.delete(fleetId);
  // ptySendText keeps a node's writes in order; Claude queues what comes while it works.
  for (const entry of queue) {
    void ptySendText(fleetId, `[dummyPlane] ${entry.line}`).then(
      () => entry.typed?.(),
      () => {
        // Not typed (its session ended meanwhile): back in line for its next start.
        queues.set(fleetId, [...(queues.get(fleetId) ?? []), entry]);
      },
    );
  }
}

/** Holds a fleet's lines from its start until its Claude's prompt is up; its trust prompt is the user's. */
function awaitPrompt(fleetId: string) {
  if (starting.has(fleetId)) return;
  starting.add(fleetId);
  const probe = {
    running: () => isRunning(fleetId),
    quietMs: () => quietFor(fleetId),
    screen: () => freshText(fleetId, 50),
    press: () => Promise.resolve(),
    agent: sessionOf(nodesStore.getState().nodes[fleetId])?.agent,
  };
  void (async () => {
    while (isRunning(fleetId) && !(await whenReady(probe, undefined, false)));
    starting.delete(fleetId);
    flush(fleetId);
  })();
}

/** Types `line` in the fleet's terminal, now or as soon as it is free; `typed` runs once it has been. */
export function notify(fleetId: string, line: string, typed?: () => void) {
  queues.set(fleetId, [...(queues.get(fleetId) ?? []), { line, typed }]);
  flush(fleetId);
}

export function pendingEvents(fleetId: string): readonly string[] {
  return (queues.get(fleetId) ?? []).map((entry) => entry.line);
}

/** A node whose lines wait for its CLI's prompt after a (re)start: a Fleet, or a mission's Manager. */
const takesLines = (nodeId: string) => {
  const record = nodesStore.getState().nodes[nodeId];
  return record?.kind === "fleet" || isManagerRecord(record);
};

/**
 * A running mission's Manager is stuck on the user: its Fleet hears it, in one line,
 * and tells them. Its team's news never reaches the Fleet.
 */
function tellFleetOfManager(managerId: string, line: (name: string) => string) {
  const fleetId = managedFleet(managerId);
  if (!fleetId || missionOf(nodesStore.getState().nodes[fleetId])?.state !== "en_cours") return;
  notify(fleetId, line(nodeNameOf(nodesStore.getState().nodes[managerId])));
}

/**
 * Watches the members of running missions, and frees held lines when a fleet is free again. A member's
 * question or stop goes to whoever runs its mission (`missionRunner`), its Manager or, run the old way, its
 * Fleet; the message draws its wire.
 */
export function installMissionEvents(): () => void {
  const flushAll = () => [...queues.keys()].forEach(flush);
  const lines = () => messages(agentMessages).lines;
  const offActivity = agentActivityStore.subscribe((state, previous) => {
    for (const [nodeId, now] of Object.entries(state.activities)) {
      if (now.activity !== "waiting" || previous.activities[nodeId]?.activity === "waiting") continue;
      tellFleetOfManager(nodeId, lines().waiting);
      const found = memberOf(nodeId);
      if (!found) continue;
      const runner = missionRunner(found.fleetId);
      talk(nodeId, runner);
      notify(runner, lines().waiting(found.member.name));
    }
    flushAll();
  });
  const offStatus = terminalStatusStore.subscribe((state, previous) => {
    // A terminal removed from the canvas leaves the statuses: it stopped too.
    for (const nodeId of new Set([...Object.keys(previous.statuses), ...Object.keys(state.statuses)])) {
      const started = previous.statuses[nodeId]?.state !== "running" && state.statuses[nodeId]?.state === "running";
      if (started && takesLines(nodeId)) awaitPrompt(nodeId);
      if (previous.statuses[nodeId]?.state !== "running" || state.statuses[nodeId]?.state === "running") continue;
      tellFleetOfManager(nodeId, lines().managerStopped);
      const found = memberOf(nodeId);
      if (!found) continue;
      const runner = missionRunner(found.fleetId);
      talk(nodeId, runner);
      notify(runner, lines().stopped(found.member.name));
    }
    flushAll();
  });
  return () => {
    offActivity();
    offStatus();
  };
}
