import { markedSteps, type StepState } from "@/nodes/steps";
import { nodesStore, terminalOf } from "@/store/nodes";

/**
 * A step an agent hands to a sub-agent it opens (spawn_agent's `step`): the step of its own frieze that the sub-agent
 * carries. The sub-agent marks its own frieze, never its parent's, so a parent's step stayed "to come" after the work
 * was done (12 Nov, Hulk and Batgirl). dummyPlane ties the two by the title the parent gave: the step goes in progress
 * when the sub-agent opens, and follows its report. Only where the parent named the link: no title is guessed.
 */

/** The title, as the parent declared it, of its step that `raw` names (case aside); undefined when it names none. */
export function carriedStep(parentId: string, raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const wanted = raw.trim().toLowerCase();
  return terminalOf(nodesStore.getState().nodes[parentId])?.steps?.find((s) => s.title.toLowerCase() === wanted)?.title;
}

/** Puts one of a parent's declared steps in `state`; a step it no longer has (it declared others since) is left alone. */
export function markParentStep(parentId: string, title: string, state: Exclude<StepState, "a_venir">) {
  const current = terminalOf(nodesStore.getState().nodes[parentId])?.steps;
  if (!current?.some((s) => s.title === title)) return;
  const steps = markedSteps(current, title, state);
  if (typeof steps !== "string") nodesStore.getState().update(parentId, { steps });
}

/**
 * A sub-agent reported: the step of its parent that it carried follows. Done is done, failed is failed; blocked leaves
 * the step in progress, as the sub-agent's own friezes do (`settledSteps`: it waits for a decision, not for the work).
 */
export function followChildReport(childId: string, status: "termine" | "bloque" | "echec") {
  const child = terminalOf(nodesStore.getState().nodes[childId]);
  if (!child?.spawnedBy || !child.forStep || status === "bloque") return;
  markParentStep(child.spawnedBy, child.forStep, status === "termine" ? "fait" : "echec");
}
