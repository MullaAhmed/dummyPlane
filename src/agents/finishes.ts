/**
 * An agent saying it finished: a `report` its terminal records (done, blocked
 * or failed), or a Fleet ending its mission. Said by the code that records
 * them, never read back from the nodes: a workspace loaded from disk brings
 * its old reports and finished missions, which are no news.
 */
export interface FinishSignal {
  nodeId: string;
  state: "done" | "blocked" | "failed";
  /** What it said, as text (an OpenUI Lang summary is already Markdown here). */
  summary: string;
}

const listeners = new Set<(signal: FinishSignal) => void>();

/** Hears every finish said from now on. */
export function onFinish(listener: (signal: FinishSignal) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Never throws: what records the finish must go on whatever a listener does. */
export function signalFinish(signal: FinishSignal) {
  for (const listener of listeners) {
    try {
      listener(signal);
    } catch (error) {
      console.warn(`finish of ${signal.nodeId} not heard`, error);
    }
  }
}
