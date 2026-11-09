import { createStore, useStore } from "zustand";

/** Which way a message goes along a wire: from the orchestrator to an agent, or back. */
export type WireDirection = "toAgent" | "toOrchestrator";

/** How long a wire shows a message passing, its fade included. */
export const WIRE_PULSE_MS = 1500;

/** The last message an agent sent or received over a wire. */
export interface WirePulse {
  direction: WireDirection;
  at: number;
  /** The orchestrator at the other end when it is known; else every wire reaching the agent lights. */
  orchestratorId?: string;
}

interface WireActivityState {
  /** By agent (terminal) id: only the latest message of each, until it has faded. */
  pulses: Record<string, WirePulse>;
}

export const wireActivityStore = createStore<WireActivityState>()(() => ({ pulses: {} }));

export function useWireActivity<T>(selector: (state: WireActivityState) => T): T {
  return useStore(wireActivityStore, selector);
}

/** The one timer that drops faded pulses: none runs while the wires are quiet. */
let sweep: ReturnType<typeof setTimeout> | null = null;

function scheduleSweep() {
  if (sweep !== null) clearTimeout(sweep);
  sweep = null;
  const ats = Object.values(wireActivityStore.getState().pulses).map((p) => p.at);
  if (ats.length === 0) return;
  const next = Math.min(...ats) + WIRE_PULSE_MS;
  sweep = setTimeout(() => {
    sweep = null;
    expireWirePulses(Date.now());
  }, Math.max(0, next - Date.now()));
}

/** A message passed between `agentId` and an orchestrator: the wire between them shows it for a moment. */
export function signalWire(agentId: string, direction: WireDirection, orchestratorId?: string, now = Date.now()) {
  const pulse: WirePulse = orchestratorId ? { direction, at: now, orchestratorId } : { direction, at: now };
  wireActivityStore.setState((s) => ({ pulses: { ...s.pulses, [agentId]: pulse } }));
  scheduleSweep();
}

/** Drops the pulses that have faded by `now`. */
export function expireWirePulses(now = Date.now()) {
  const { pulses } = wireActivityStore.getState();
  const live = Object.fromEntries(Object.entries(pulses).filter(([, p]) => now - p.at < WIRE_PULSE_MS));
  if (Object.keys(live).length !== Object.keys(pulses).length) wireActivityStore.setState({ pulses: live });
  scheduleSweep();
}

/** Forgets every pulse (workspace switch, tests). */
export function clearWirePulses() {
  wireActivityStore.setState({ pulses: {} });
  scheduleSweep();
}
