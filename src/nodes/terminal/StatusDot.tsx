import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import type { PillTone } from "./pill";

/** Where an agent stands, as its dot shows it. */
export type DotState = "working" | "waiting" | "idle" | "done" | "stopped" | "error";

/**
 * The signature of dummyPlane (unslop direction): one 8px dot per agent, the
 * same in a terminal's header, its minimized card and the agents panel. Shape
 * carries the state as much as colour does, so states stay apart in every
 * palette (in calm the ink, the ok green and the text are all greens):
 * solid while the process lives, a ring once it rests or ended, a square on
 * error, and a solid dot inside a ring while it waits for the user: the state
 * the product most needs to surface reads without its colour, or its motion.
 * Only a waiting agent's dot moves, a slow breath of its opacity; under
 * reduced motion a slower, shallower one (dp-breath, index.css), nothing else.
 * Its ring is an outline: off the layout, so the dot keeps its 8px place, and
 * with a clear gap that shows whatever ground it sits on.
 */
const LOOK: Record<DotState, string> = {
  working: "rounded-full bg-dp-accent",
  waiting:
    "rounded-full bg-dp-wait outline-[1.5px] outline-offset-1 outline-dp-wait motion-safe:animate-pulse motion-reduce:animate-[dp-breath_3s_ease-in-out_infinite]",
  idle: "rounded-full border-[1.5px] border-dp-text-2",
  done: "rounded-full border-[1.5px] border-dp-ok",
  stopped: "rounded-full border-[1.5px] border-dp-text-3 opacity-60",
  error: "rounded-[2px] bg-dp-danger",
};

/** The dot of a status pill's tone: one look for the two working tones. */
export const DOT_OF_TONE: Record<PillTone, DotState> = {
  live: "idle",
  ready: "idle",
  working: "working",
  workingIndigo: "working",
  waiting: "waiting",
  stopped: "stopped",
  done: "done",
  failed: "error",
};

/**
 * Beside its word (a header, a card) the dot is decoration and hidden from
 * screen readers; alone (the `@` list), it takes a `label` and is named.
 */
export function StatusDot({ state, label, className, ...rest }: { state: DotState; label?: string } & ComponentProps<"span">) {
  const naming = label ? { role: "img", "aria-label": label, title: label } : { "aria-hidden": true };
  return <span {...rest} {...naming} data-status={state} className={cn("size-2 shrink-0", LOOK[state], className)} />;
}
