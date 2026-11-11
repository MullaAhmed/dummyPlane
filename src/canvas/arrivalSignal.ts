import { createStore, useStore } from "zustand";

interface ArrivalState {
  /** The terminal that arrived last. */
  nodeId: string | null;
  /** Counts arrivals: a new value restarts the flash. */
  seq: number;
}

export const arrivalStore = createStore<ArrivalState>()(() => ({ nodeId: null, seq: 0 }));

/**
 * The flash's length: a 100 ms hold and a --dp-dur fade (index.css, .dp-arrival), under the 300 ms
 * UI motion stays within. Past it the ring is removed, or showing the terminal again would replay it.
 */
export const ARRIVAL_FLASH_MS = 300;

/** The arriving terminal's border takes the accent at once, then fades back, once. */
export function signalArrival(nodeId: string) {
  const seq = arrivalStore.getState().seq + 1;
  arrivalStore.setState({ nodeId, seq });
  setTimeout(() => {
    if (arrivalStore.getState().seq === seq) arrivalStore.setState({ nodeId: null });
  }, ARRIVAL_FLASH_MS);
}

/** The flash of `nodeId`, as a key that changes on every arrival; null when another terminal arrived last. */
export function useArrivalSignal(nodeId: string): number | null {
  return useStore(arrivalStore, (state) => (state.nodeId === nodeId ? state.seq : null));
}
