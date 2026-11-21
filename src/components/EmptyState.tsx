import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** How long a loading line holds its tongue: a read that answers within it never flashes "Reading…". */
export const GRACE_MS = 150;

/**
 * False for `GRACE_MS` from the first render that wants it, then true: what a loading state waits for before it speaks.
 * Not wanted, it is true at once: a line that turns from "reading" to "empty" speaks the moment it does.
 */
export function useGrace(wanted = true): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!wanted || late) return;
    const timer = setTimeout(() => setLate(true), GRACE_MS);
    return () => clearTimeout(timer);
  }, [wanted, late]);
  return late || !wanted;
}

/** A pane with nothing to show, centred in what is left; or a line among a list's rows, not a pane. */
export type EmptyPlace = "pane" | "list";

const PLACES: Record<EmptyPlace, string> = {
  pane: "grid flex-1 place-items-center p-6 text-center text-xs text-dp-text-2",
  list: "px-3 py-4 text-center text-xs text-dp-text-2",
};

/**
 * What a pane or a list says when it has nothing to show: still reading, nothing there, nothing picked. The one copy of
 * it (the git, review, studio and notes panels each had their own). `grace` for a loading line: it keeps its place, empty,
 * for `GRACE_MS`, then speaks, so a quick answer shows no flash. A problem is an InlineProblem.
 */
export function EmptyState({ children, place = "pane", grace = false }: { children: ReactNode; place?: EmptyPlace; grace?: boolean }) {
  const late = useGrace(grace);
  return <p className={cn(PLACES[place])}>{late ? children : null}</p>;
}
