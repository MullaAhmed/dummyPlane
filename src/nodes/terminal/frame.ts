import type { CSSProperties } from "react";

/**
 * A node's frame (unslop direction): a neutral hairline, a hairline in the
 * wait colour while its agent waits for the user, and a 1px ink frame when it
 * is selected. An agent's identity is its icon and status dot, never its frame.
 *
 * The ink frame carries a 1px paper line just inside it: in a palette whose ink
 * is as dark as the terminal (calm), the frame alone would melt into the body.
 * The line is an outline drawn 2px in, not an inset shadow: an outline paints
 * over the node's own children (its opaque header, the xterm host), a shadow
 * under them. Excalidraw clips what overflows an embeddable, so nothing is
 * drawn outside.
 */
export function frameStyle(selected: boolean, waiting: boolean): CSSProperties {
  if (selected) return { border: "1px solid var(--dp-accent)", outline: "1px solid var(--dp-on-accent)", outlineOffset: "-2px" };
  return { border: `1px solid ${waiting ? "var(--dp-wait)" : "var(--dp-line)"}` };
}
