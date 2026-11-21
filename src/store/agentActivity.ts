import { useMemo } from "react";
import { createStore, useStore } from "zustand";
import type { PendingDialog } from "@/agents/dialogs";
import type { Activity, ActivityEvent } from "@/ipc/activity";
import { fleetDecisionsStore, type FleetDecision, type FleetDecisionKind } from "./fleetDecisions";

export interface AgentActivity {
  activity: Activity;
  since: number;
  message?: string;
  /** Claude exited and the terminal is back at its shell (Rust's `SessionEnd`). */
  left?: boolean;
  /** The dialog dummyPlane read on its screen that holds it (`hold`): what it waits on. */
  dialog?: PendingDialog;
  /** The decision its Fleet's panel asks of the person (`withDecisions`): only on the person's reading, never in the store. */
  decision?: FleetDecisionKind;
}

interface AgentActivityState {
  activities: Record<string, AgentActivity>;
  /** One change computed by Rust. */
  apply: (event: ActivityEvent) => void;
  /** Rust's state when the webview (re)loads. */
  load: (events: readonly ActivityEvent[]) => void;
  remove: (nodeId: string) => void;
  /**
   * Rust's activity of the agents a dialog holds (`hold`), kept apart while it does: shown again once it lets go.
   * A key is here exactly while its agent is held.
   */
  under: Record<string, AgentActivity | undefined>;
  /**
   * An agent held by a dialog dummyPlane read on its screen before its session opened (`@/agents/dialogs`): it
   * waits, whatever Rust reads of its output meanwhile (before Claude's first hook, its output alone says working or
   * idle). Null lets go. Another dialog in a row keeps its place, as a new question does (`sameWait`).
   */
  hold: (nodeId: string, waiting: AgentActivity | null) => void;
}

/**
 * How far apart Rust's dates of one transition can fall: it converts the same
 * instant to the wall clock again for each event, which moves it a few ms.
 */
const SAME_WAIT_MS = 50;

/**
 * A new question during a wait is no transition: it only replaces the message
 * and the agent keeps its place. A later wait stays a transition, or an older
 * event could pass for newer than the `since` kept.
 */
function sameWait(held: AgentActivity, event: AgentActivity): boolean {
  return held.activity === "waiting" && event.activity === "waiting" && Math.abs(held.since - event.since) <= SAME_WAIT_MS;
}

/** What `event` makes of the activity held: itself, the same wait with a new message, or nothing (an older event). */
function following(held: AgentActivity | undefined, event: AgentActivity): AgentActivity | null {
  if (held && sameWait(held, event)) return { ...event, since: held.since };
  return held && held.since > event.since ? null : event;
}

export const agentActivityStore = createStore<AgentActivityState>()((set) => ({
  activities: {},
  under: {},
  // `since` dates each transition: an event older than the one held arrived out of order (two Rust threads
  // emit after releasing their lock) or is a startup snapshot overtaken by a live event, and is dropped.
  apply: ({ nodeId, ...event }) =>
    set((s) => {
      const held = nodeId in s.under;
      const next = following(held ? s.under[nodeId] : s.activities[nodeId], event);
      if (!next) return s;
      return held ? { under: { ...s.under, [nodeId]: next } } : { activities: { ...s.activities, [nodeId]: next } };
    }),
  load: (events) =>
    set((s) => {
      // Rust's list is the truth about which terminals run; for those, a newer live event wins.
      const activities: Record<string, AgentActivity> = {};
      for (const { nodeId, ...event } of events) {
        const held = nodeId in s.under ? s.under[nodeId] : s.activities[nodeId];
        activities[nodeId] = held && held.since > event.since ? held : event;
      }
      // A dialog still holds those of them that run: Rust's entry goes under it.
      const under: Record<string, AgentActivity | undefined> = {};
      for (const nodeId of Object.keys(s.under)) {
        if (!(nodeId in activities)) continue;
        under[nodeId] = activities[nodeId];
        activities[nodeId] = s.activities[nodeId];
      }
      return { activities, under };
    }),
  remove: (nodeId) =>
    set((s) => ({
      activities: Object.fromEntries(Object.entries(s.activities).filter(([id]) => id !== nodeId)),
      under: Object.fromEntries(Object.entries(s.under).filter(([id]) => id !== nodeId)),
    })),
  hold: (nodeId, waiting) =>
    set((s) => {
      const held = nodeId in s.under;
      if (waiting) {
        const shown = s.activities[nodeId];
        if (!held) return { under: { ...s.under, [nodeId]: shown }, activities: { ...s.activities, [nodeId]: waiting } };
        return { activities: { ...s.activities, [nodeId]: { ...waiting, since: shown?.since ?? waiting.since } } };
      }
      if (!held) return s;
      const { [nodeId]: rust, ...under } = s.under;
      const others = Object.fromEntries(Object.entries(s.activities).filter(([id]) => id !== nodeId));
      return { under, activities: rust ? { ...others, [nodeId]: rust } : others };
    }),
}));

/**
 * An agent's activity as the person reads it: a Fleet whose panel asks them a decision (`@/store/fleetDecisions`)
 * waits, whatever its terminal does (it may well rest at its prompt). A question on its screen stays what it waits on,
 * and a Fleet whose Claude exited (`left`) waits on nothing.
 */
export function withDecision(activity: AgentActivity | undefined, decision: FleetDecision | undefined): AgentActivity | undefined {
  if (!decision || activity?.left || activity?.activity === "waiting") return activity;
  return { activity: "waiting", since: decision.since, ...(decision.message ? { message: decision.message } : {}), decision: decision.kind };
}

/** Every agent's activity as the person reads it (`withDecision`). The same object while neither store changes. */
export function withDecisions(activities: Record<string, AgentActivity>, decisions: Record<string, FleetDecision>): Record<string, AgentActivity> {
  const ids = Object.keys(decisions);
  if (ids.length === 0) return activities;
  const shown = { ...activities };
  for (const id of ids) {
    const activity = withDecision(activities[id], decisions[id]);
    if (activity) shown[id] = activity;
  }
  return shown;
}

let read: { activities: Record<string, AgentActivity>; decisions: Record<string, FleetDecision>; shown: Record<string, AgentActivity> } | null = null;

/**
 * The activities as the person reads them, now: what the counts, the waiting notice and the alerts read. What acts on
 * an agent's terminal (a line typed, a loop, a dialog answered) reads `agentActivityStore` itself: a Fleet that waits on
 * a decision still takes lines.
 */
export function personActivities(): Record<string, AgentActivity> {
  const { activities } = agentActivityStore.getState();
  const { decisions } = fleetDecisionsStore.getState();
  if (read?.activities !== activities || read.decisions !== decisions) read = { activities, decisions, shown: withDecisions(activities, decisions) };
  return read.shown;
}

/** An agent's activity as the person reads it (`withDecision`): its pill, its row, its frame. */
export function useActivity(nodeId: string): AgentActivity | undefined {
  const activity = useStore(agentActivityStore, (s) => s.activities[nodeId]);
  const decision = useStore(fleetDecisionsStore, (s) => s.decisions[nodeId]);
  return useMemo(() => withDecision(activity, decision), [activity, decision]);
}

/** Every agent's activity as the person reads it (`withDecisions`): the counts, the panel, the group labels. */
export function useActivities(): Record<string, AgentActivity> {
  const activities = useStore(agentActivityStore, (s) => s.activities);
  const decisions = useStore(fleetDecisionsStore, (s) => s.decisions);
  return useMemo(() => withDecisions(activities, decisions), [activities, decisions]);
}
