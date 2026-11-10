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
 * error. Only a waiting agent's dot moves, a slow breath, and never with
 * reduced motion.
 */
const LOOK: Record<DotState, string> = {
  working: "rounded-full bg-dp-accent",
  waiting: "rounded-full bg-dp-wait animate-pulse motion-reduce:animate-none",
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
