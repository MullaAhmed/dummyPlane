/**
 * Terminals created by the user start on their first mount, possibly after a
 * delay: a new group starts one agent every 300 ms.
 */
export function createAutostart(setTimer = setTimeout, clearTimer = clearTimeout) {
  const delays = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    mark: (nodeId: string, delayMs = 0) => {
      delays.set(nodeId, delayMs);
    },
    /** Runs `start` for a marked node, at once or after its delay; false if it was not marked. */
    run: (nodeId: string, start: () => void): boolean => {
      const delay = delays.get(nodeId);
      if (delay === undefined) return false;
      delays.delete(nodeId);
      if (delay <= 0) start();
      else
        timers.set(
          nodeId,
          setTimer(() => {
            timers.delete(nodeId);
            start();
          }, delay),
        );
      return true;
    },
    /** A removed node never starts. */
    cancel: (nodeId: string) => {
      delays.delete(nodeId);
      const timer = timers.get(nodeId);
      if (timer !== undefined) clearTimer(timer);
      timers.delete(nodeId);
    },
  };
}
