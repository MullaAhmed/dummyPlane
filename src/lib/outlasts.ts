/**
 * Whether `work` is still running after `ms`: true then, false once it settled first. `work` goes on either way, and
 * its outcome is the caller's to take; nothing is cancelled. The timer is cleared as soon as `work` settles.
 */
export function outlasts(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), ms);
  });
  const settled = work.then(
    () => false,
    () => false,
  );
  return Promise.race([settled, late]).finally(() => clearTimeout(timer));
}
