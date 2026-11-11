// Pending debounced saves register here so they can all be written before the
// window closes.
const flushers = new Set<() => unknown>();

export function onFlushAll(flush: () => unknown): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

export async function flushAll(): Promise<void> {
  await Promise.allSettled([...flushers].map((flush) => flush()));
}
