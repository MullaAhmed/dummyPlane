import type { CSSProperties } from "react";

/**
 * A node's frame (unslop direction): a neutral hairline, a hairline in the
 * wait colour while its agent waits for the user, and a 1px ink frame when it
 * is selected. An agent's identity is its icon and status dot, never its frame.
 *
 * A selected node is also ringed by Excalidraw's own selection outline, a
 * hairline a few pixels out, kept 1px wide even while the node is worked in
 * (scripts/excalidraw-thin-selection.mjs): that outline is what tells a
 * selected node in a palette whose ink is as dark as the terminal (calm), so
 * the frame needs no second line inside it.
 */
/** The rounded frame of a terminal, a Fleet or a subagent; its colours and its border are frameStyle's. */
export const NODE_FRAME = "relative flex h-full flex-col overflow-hidden rounded-xl";

/**
 * The area of a terminal's grid: 8px of air around it, so its text clears the
 * header, the frame's rounded corners and the scrollbar. The padding sits on
 * this wrapper, not on the host: the grid is sized from the host's client
 * size, which would include padding set on the host itself.
 */
export const TERMINAL_BODY = "relative min-h-0 flex-1 p-2";

export function frameStyle(selected: boolean, waiting: boolean): CSSProperties {
  if (selected) return { border: "1px solid var(--dp-accent)" };
  return { border: `1px solid ${waiting ? "var(--dp-wait)" : "var(--dp-line)"}` };
}
