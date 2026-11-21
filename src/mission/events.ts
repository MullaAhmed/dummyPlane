import { dialogText, heldByDialog, holdFor, pendingDialog } from "@/agents/dialogs";
import { isLaunching } from "@/agents/spawnFamily";
import { spawnedBy } from "@/agents/spawnTree";
import { talk } from "@/agents/talkWires";
import { messages } from "@/i18n";
import { ptySendText } from "@/ipc/pty";
import { agentMessages } from "@/mcp/messages";
import { hasUnsentInput } from "@/nodes/terminal/draft";
import { freshText, quietFor, typedAgo } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { isManagerNode, isManagerRecord, nodesStore, nodeNameOf, sessionOf, terminalOf } from "@/store/nodes";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";
import { remoteBusy } from "@/agents/remoteControl";
import { whenReady } from "./ready";
import { isRestoring } from "./restore";
import type { Member } from "./mission";
import { managedFleet, memberOf, missionOf, missionRunner } from "./store";

/**
 * A card stands "In progress" while its agent runs: one whose agent stopped before it reported waits on alert (in
 * "Blocked" on a board a Manager runs), and goes back to "In progress" when its agent runs again. Not the card of a
 * sub-task handed over or abandoned: it is another's now. Imported late: the boards' module types into this one.
 */
function followCard(fleetId: string, member: Member, how: "stopped" | "restarted") {
  if (member.report || member.handedTo || member.abandoned) return;
  void import("@/kanban/fleetBoards")
    .then(({ flagMissionCard, reassignMissionCard }) => {
      const plan = missionOf(nodesStore.getState().nodes[fleetId])?.plan;
      return how === "stopped" ? flagMissionCard(fleetId, plan, member.task, "failed") : reassignMissionCard(fleetId, plan, member.task, member.name);
    })
    .catch(() => undefined);
}

/** Lines waiting for their fleet to be free; a command (`sendCommand`) is typed as is, with no `[dummyPlane]` tag. */
const queues = new Map<string, { line: string; typed?: () => void; command?: true }[]>();
/** Fleets just (re)started whose CLI's prompt is not up yet (final review H2). */
const starting = new Set<string>();

/** A line waits this long after the user's last keystroke, whether or not a draft is left: a key is still on its way. */
export const TYPING_PAUSE_MS = 4000;

/** How often a line held back by the user's unsent text looks at it again: the Enter that sends it ends the wait. */
export const DRAFT_RECHECK_MS = 1000;
/** The terminals with a look at their draft programmed: one timer each, however many lines wait. */
const rechecking = new Set<string>();

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
  // Text the user has written and not sent: a line typed now would be spliced into it and sent with it. It waits for
  // the Enter (or Ctrl+C) that ends the draft, however long that takes, up to the time the user leaves it (./draft.ts).
  if (hasUnsentInput(fleetId)) {
    if (!rechecking.has(fleetId)) {
      rechecking.add(fleetId);
      setTimeout(() => {
        rechecking.delete(fleetId);
        flush(fleetId);
      }, DRAFT_RECHECK_MS);
    }
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
    void ptySendText(fleetId, entry.command ? entry.line : `[dummyPlane] ${entry.line}`).then(
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
    // A Manager held so waits for the user: its Fleet hears it, once: one wait for as long as it runs, not one a
    // minute, each letting go of the dialog on its way out.
    held: holdFor(fleetId),
    waitLonger: () => isRunning(fleetId),
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

/**
 * Types a command of the agent's CLI (Claude's `/rename …`) in its terminal, as is, in line with the `[dummyPlane]`
 * lines: it waits as they do for a dialog, a Remote Control flow or the user's typing, which it must not land in.
 */
export function sendCommand(nodeId: string, command: string) {
  queues.set(nodeId, [...(queues.get(nodeId) ?? []), { line: command, command: true }]);
  flush(nodeId);
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
 * A sub-agent (spawn_agent) waits for the user: the agent that opened it hears what on, in one line. Not a
 * mission's member nor its Manager: their runner and Fleet hear it (`installMissionEvents`).
 */
function tellParent(nodeId: string, what: string | undefined) {
  const parentId = spawnedBy(nodeId);
  if (!parentId || !isRunning(parentId) || isManagerNode(nodeId)) return;
  talk(nodeId, parentId);
  notify(parentId, messages(agentMessages).spawn.waiting(nodeNameOf(nodesStore.getState().nodes[nodeId]), what, isLaunching(nodeId)));
}

/**
 * Watches the members of running missions, and frees held lines when a fleet is free again. A member's
 * question or stop goes to whoever runs its mission (`missionRunner`), its Manager or, run the old way, its
 * Fleet; the message draws its wire. A question names what it is (`@/agents/dialogs`), and reaches a sub-agent's
 * parent too, a dialog that holds its session from opening as well as one in its work.
 */
export function installMissionEvents(): () => void {
  const flushAll = () => [...queues.keys()].forEach(flush);
  const lines = () => messages(agentMessages).lines;
  const offActivity = agentActivityStore.subscribe((state, previous) => {
    for (const [nodeId, now] of Object.entries(state.activities)) {
      if (now.activity !== "waiting" || previous.activities[nodeId]?.activity === "waiting") continue;
      const what = dialogText(pendingDialog(nodeId));
      tellFleetOfManager(nodeId, (name) => lines().waiting(name, what));
      const found = memberOf(nodeId) ?? memberOf(nodeId, { evenUnsent: true });
      if (!found) {
        tellParent(nodeId, what);
        continue;
      }
      // Its sub-task not typed yet, only for a dialog that holds its session from opening: a linked agent may wait on
      // the user's own work before it.
      if (found.member.sentAt === undefined && !heldByDialog(nodeId)) continue;
      const runner = missionRunner(found.fleetId);
      talk(nodeId, runner);
      notify(runner, lines().waiting(found.member.name, what, found.member.sentAt === undefined));
    }
    flushAll();
  });
  /** Its Manager, or its Fleet for a Manager, hears how a member's terminal went: stopped, or restarted. */
  const tell = (nodeId: string, how: "stopped" | "restarted") => {
    tellFleetOfManager(nodeId, how === "stopped" ? lines().managerStopped : lines().managerRestarted);
    // A finished member dummyPlane stopped to free its memory (`@/agents/finishedStop`): no news, its report said it all.
    if (how === "stopped" && terminalOf(nodesStore.getState().nodes[nodeId])?.stoppedFinished) return;
    // Started again by a mission's restore (`./restore`): its summary names it with the rest of the team.
    if (how === "restarted" && isRestoring(nodeId)) return;
    const found = memberOf(nodeId);
    if (!found) return;
    followCard(found.fleetId, found.member, how);
    const runner = missionRunner(found.fleetId);
    talk(nodeId, runner);
    notify(runner, (how === "stopped" ? lines().stopped : lines().restarted)(found.member.name));
  };
  /** The terminals being restarted, and whether each ran when its restart began: its end says how it went, once. */
  const restarting = new Map<string, boolean>();
  const offStatus = terminalStatusStore.subscribe((state, previous) => {
    // In this order: a close mid-restart changes its status and its restart in one update, and is told once.
    for (const nodeId of Object.keys(state.restarts)) {
      if (!previous.restarts[nodeId]) restarting.set(nodeId, state.statuses[nodeId]?.state === "running");
    }
    // A terminal removed from the canvas leaves the statuses: it stopped too. Not yet while it restarts: its old
    // process's exit is part of it.
    for (const nodeId of new Set([...Object.keys(previous.statuses), ...Object.keys(state.statuses)])) {
      const started = previous.statuses[nodeId]?.state !== "running" && state.statuses[nodeId]?.state === "running";
      if (started && takesLines(nodeId)) awaitPrompt(nodeId);
      if (previous.statuses[nodeId]?.state !== "running" || state.statuses[nodeId]?.state === "running") continue;
      if (!restarting.has(nodeId)) tell(nodeId, "stopped");
    }
    // Its restart over: back running, it restarted; not, it stopped, if it ran before (else that stop was told then).
    for (const nodeId of Object.keys(previous.restarts)) {
      if (state.restarts[nodeId]) continue;
      const ran = restarting.get(nodeId);
      restarting.delete(nodeId);
      if (state.statuses[nodeId]?.state === "running") tell(nodeId, "restarted");
      else if (ran) tell(nodeId, "stopped");
    }
    flushAll();
  });
  return () => {
    offActivity();
    offStatus();
  };
}
