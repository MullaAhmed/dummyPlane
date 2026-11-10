import { signalWire } from "@/canvas/wireActivity";
import { messages } from "@/i18n";
import { ptySendText } from "@/ipc/pty";
import { agentMessages } from "@/mcp/messages";
import { freshText, quietFor, typedAgo } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";
import { remoteBusy } from "@/agents/remoteControl";
import { whenReady } from "./ready";
import { memberOf } from "./store";

/** Lines waiting for their fleet to be free. */
const queues = new Map<string, { line: string; typed?: () => void }[]>();
/** Fleets just (re)started whose Claude's prompt is not up yet (final review H2). */
const starting = new Set<string>();

/** A line waits this long after the user's last keystroke: it would be typed into their half-written text. */
export const TYPING_PAUSE_MS = 4000;

/** A fleet takes a line while its Claude's prompt is up and no dialog waits for the user (spec §7.5). */
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

/** Watches the members of running missions, and frees held lines when a fleet is free again. */
export function installMissionEvents(): () => void {
  const flushAll = () => [...queues.keys()].forEach(flush);
  const offActivity = agentActivityStore.subscribe((state, previous) => {
    for (const [nodeId, now] of Object.entries(state.activities)) {
      if (now.activity !== "waiting" || previous.activities[nodeId]?.activity === "waiting") continue;
      const found = memberOf(nodeId);
      if (!found) continue;
      signalWire(nodeId, "toFleet", found.fleetId);
      notify(found.fleetId, messages(agentMessages).lines.waiting(found.member.name));
    }
    flushAll();
  });
  const offStatus = terminalStatusStore.subscribe((state, previous) => {
    // A terminal removed from the canvas leaves the statuses: it stopped too.
    for (const nodeId of new Set([...Object.keys(previous.statuses), ...Object.keys(state.statuses)])) {
      const started = previous.statuses[nodeId]?.state !== "running" && state.statuses[nodeId]?.state === "running";
      if (started && nodesStore.getState().nodes[nodeId]?.kind === "fleet") awaitPrompt(nodeId);
      if (previous.statuses[nodeId]?.state !== "running" || state.statuses[nodeId]?.state === "running") continue;
      const found = memberOf(nodeId);
      if (!found) continue;
      signalWire(nodeId, "toFleet", found.fleetId);
      notify(found.fleetId, messages(agentMessages).lines.stopped(found.member.name));
    }
    flushAll();
  });
  return () => {
    offActivity();
    offStatus();
  };
}
