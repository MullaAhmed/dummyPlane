import { arrive } from "@/canvas/arrive";
import { focusGroup } from "@/canvas/canvasFocus";

export type ReachKind = "terminal" | "group" | "fleet";

/** Reaches a node or a group of the workspace on screen (Go to, a keyboard surface: at once); false when it is gone. */
export function reach(kind: ReachKind, id: string): boolean {
  return kind === "group" ? focusGroup(id, "keyboard") : arrive(id);
}
