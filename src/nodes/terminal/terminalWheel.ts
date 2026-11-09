import type { Terminal } from "@xterm/xterm";

/**
 * A wheel over a terminal node scrolls the terminal, not the canvas.
 *
 * Excalidraw pans on a wheel whose target is its canvas, a textarea or an
 * iframe, and zooms on ctrl/meta. An inactive embeddable is `pointer-events:
 * none`, so the wheel lands on the canvas underneath and pans it. An active one
 * takes the wheel, but its WebGL canvas and helper textarea still count as
 * canvas and textarea targets. So the wheel is caught on the Excalidraw
 * container in the capture phase, before Excalidraw sees it: a stopped event
 * never reaches its bubble-phase listener.
 */

/** What to do with a wheel event over a terminal. */
export type WheelRoute =
  /** Not for the terminal (or a zoom/horizontal gesture): Excalidraw keeps it. */
  | "ignore"
  /** The terminal's own viewport scrolls natively: nothing to do. */
  | "native"
  /** Scroll the scrollback by `scrollLines`. */
  | "scrollback"
  /** Alternate screen or mouse tracking: hand the wheel to xterm's own listener. */
  | "forward";

export interface WheelFacts {
  /** The pointer is over the terminal node. */
  overTerminal: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** The target is xterm's viewport, which scrolls natively. */
  onViewport: boolean;
  /** The alternate screen is shown or mouse tracking is on: xterm decides what a wheel means. */
  interactive: boolean;
}

export function routeWheel(facts: WheelFacts): WheelRoute {
  if (!facts.overTerminal || facts.ctrlKey || facts.metaKey || facts.shiftKey) return "ignore";
  if (facts.interactive) return "forward";
  return facts.onViewport ? "native" : "scrollback";
}

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const PIXELS_PER_LINE = 40; // the figure xterm itself divides pixel deltas by

/** A wheel delta in lines, positive towards the bottom of the scrollback. */
export function wheelLines(deltaY: number, deltaMode: number, rows: number): number {
  if (deltaMode === DOM_DELTA_LINE) return deltaY;
  if (deltaMode === DOM_DELTA_PAGE) return deltaY * rows;
  return deltaY / PIXELS_PER_LINE;
}

/** Whole lines to scroll now, keeping the fraction for the next wheel event (trackpads send small deltas). */
export function takeWholeLines(carry: number, lines: number): { lines: number; carry: number } {
  const total = carry + lines;
  const whole = Math.trunc(total);
  return { lines: whole, carry: total - whole };
}

/** The xterm members the wheel needs. */
export type WheelTerminal = Pick<Terminal, "scrollLines" | "buffer" | "modes" | "element" | "rows">;

// Events this module re-dispatches to xterm: its own listener must let them pass.
const forwarded = new WeakSet<Event>();

function insideRect(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function forward(term: WheelTerminal, event: WheelEvent) {
  const copy = new WheelEvent("wheel", {
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    clientX: event.clientX,
    clientY: event.clientY,
    bubbles: true,
    cancelable: true,
  });
  forwarded.add(copy);
  term.element?.dispatchEvent(copy);
}

/**
 * Keeps the wheel over a terminal node (`root`) from panning or zooming the
 * Excalidraw `canvas` that contains it, and gives it to the terminal instead.
 * `terminal` returns the node's xterm, once it exists.
 */
export function keepTerminalWheel(root: HTMLElement, canvas: HTMLElement, terminal: () => WheelTerminal | undefined): () => void {
  let carry = 0;
  const onWheel = (event: WheelEvent) => {
    if (forwarded.has(event) || event.defaultPrevented) return; // another terminal already took it
    const term = terminal();
    if (!term) return;
    const target = event.target;
    const route = routeWheel({
      overTerminal: insideRect(root.getBoundingClientRect(), event.clientX, event.clientY) || root.contains(target as Node),
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      onViewport: target instanceof Element && root.contains(target) && target.closest(".xterm-viewport") !== null,
      interactive: term.buffer.active.type === "alternate" || term.modes.mouseTrackingMode !== "none",
    });
    if (route === "ignore" || route === "native") return;
    event.preventDefault();
    event.stopPropagation();
    if (route === "forward") {
      forward(term, event);
      return;
    }
    const step = takeWholeLines(carry, wheelLines(event.deltaY, event.deltaMode, term.rows));
    carry = step.carry;
    if (step.lines !== 0) term.scrollLines(step.lines);
  };
  canvas.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => canvas.removeEventListener("wheel", onWheel, { capture: true });
}
