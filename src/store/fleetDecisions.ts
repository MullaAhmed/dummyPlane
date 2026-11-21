import { createStore } from "zustand";

/**
 * What a Fleet's panel asks the person to decide: the go-ahead of its plan, or of its changes to the waiting tasks
 * (`changes`), whether to land its mission, whether to clean up the leftovers of past missions.
 */
export type FleetDecisionKind = "plan" | "changes" | "land" | "leftovers";

/** A decision a Fleet waits on: a wait for the person, never for its agent (`@/mission/decisions` keeps it). */
export interface FleetDecision {
  kind: FleetDecisionKind;
  /** Since when it waits, in ms. */
  since: number;
  /** What it asks, in the app's own words: plain text. */
  message?: string;
  /**
   * Found standing when its Fleet was first read (the app started, its project opened): counted and shown as any wait,
   * but no new alert, as a reload does not repeat the waits already known.
   */
  standing?: boolean;
}

/**
 * The decisions the Fleets wait on, by Fleet. Apart from the agents' activity on purpose: there, "waiting" also means
 * that the agent's terminal is held by a dialog and takes no line, while a Fleet that waits on a decision still talks
 * with the user and hears its team. Only what speaks to the person reads them (`@/store/agentActivity` `useActivities`).
 */
export const fleetDecisionsStore = createStore<{ decisions: Record<string, FleetDecision> }>(() => ({ decisions: {} }));
