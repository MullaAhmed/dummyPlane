import { useStore } from "zustand";
import { sendToAgents } from "@/agents/broadcast";
import { getSetting, keepSettingAside, projectsOfNodes, setSetting } from "@/ipc/db";
import { freshText, isLiveInRust } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { isRestarting, statusOf } from "@/store/terminalStatus";
import { acceptsInstruction } from "./engine";
import { createLoopsStore, LOOPS_KEY, type LoopsState } from "./store";

/**
 * The real loops store: its engine reads the application's
 * agents and sends through `sendToAgents`, which spares those that wait.
 */
export const loopsStore = createLoopsStore(
  {
    now: () => Date.now(),
    isLive: (id) => isLiveTarget(id),
    isAgent: (id) => isAgentTerminal(id),
    activityOf: (id) => agentActivityStore.getState().activities[id]?.activity,
    screenOf: (id) => freshText(id, 40),
    canReceive: (id) => acceptsInstruction(terminalOf(nodesStore.getState().nodes[id])?.agent, freshText(id, 40)),
    send: async (ids, text) => {
      const { sent } = await sendToAgents(ids, text);
      return { sent };
    },
  },
  {
    read: () => getSetting<unknown>(LOOPS_KEY),
    write: (value) => setSetting(LOOPS_KEY, value),
    keepAside: (some) => keepSettingAside(LOOPS_KEY, some),
    projectsOf: projectsOfNodes,
    activeProject: () => projectsStore.getState().activeId,
  },
);

/**
 * A target a loop can reach: a terminal on the canvas (a closed one's record stays in the store for an undo) whose
 * process runs, or is about to (its staggered start, a restart under way, a process alive in Rust since a reload).
 * A stopped or exited agent, a finished one dummyPlane stopped among them, is none: its last screen still shows its
 * prompt, and a loop would fire at it with nothing sent. Woken again, it is a target again.
 */
export function isLiveTarget(id: string): boolean {
  const { nodes, isClosed } = nodesStore.getState();
  if (nodes[id]?.kind !== "terminal" || isClosed(id)) return false;
  const { state } = statusOf(id);
  return state === "running" || state === "starting" || isRestarting(id) || isLiveInRust(id);
}

/** A terminal running an agent, not a plain shell: what a loop may target, and type into. */
export function isAgentTerminal(id: string): boolean {
  const agent = terminalOf(nodesStore.getState().nodes[id])?.agent;
  return agent !== undefined && agent !== "shell";
}

// The idle trigger hears each change of an agent's activity.
agentActivityStore.subscribe((state, previous) => {
  for (const [id, now] of Object.entries(state.activities)) {
    const before = previous.activities[id];
    if (before !== now) loopsStore.activity(id, now.activity, before?.activity);
  }
});

export function useLoops<T>(selector: (state: LoopsState) => T): T {
  return useStore(loopsStore, selector);
}
