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
 *
 * Who takes the wheel is decided once per gesture, as a browser does for nested
 * scrollers: a trackpad pan moves the canvas under a pointer that stays put, and
 * the terminals passing under it must not catch the rest of the pan (momentum
 * included). A gesture ends after a pause or once the pointer moves; nothing
 * else is kept, so it cannot stay stuck on a terminal.
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
  /** The pointer is over the terminal node (its gesture began there). */
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

/** A wheel event's time (its `timeStamp`, when the input happened) and pointer. */
export interface WheelSample {
  time: number;
  x: number;
  y: number;
}

/** A gesture ends after this long without a wheel event; a trackpad sends one every few ms, momentum included. */
export const GESTURE_GAP_MS = 200;
/** It also ends once the pointer moves: a mouse brought over another node scrolls that one. */
export const GESTURE_SLOP_PX = 4;

/** The event `next` goes on the gesture of `previous`: soon after it, the pointer where it was. */
export function sameGesture(previous: WheelSample | undefined, next: WheelSample): boolean {
  if (!previous) return false;
  const elapsed = next.time - previous.time;
  return (
    elapsed >= 0 &&
    elapsed <= GESTURE_GAP_MS &&
    Math.abs(next.x - previous.x) <= GESTURE_SLOP_PX &&
    Math.abs(next.y - previous.y) <= GESTURE_SLOP_PX
  );
}

/** A gesture that starts sideways pans the canvas: a terminal only scrolls up and down. */
export function startsSideways(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) > Math.abs(deltaY);
}

/** The xterm members the wheel needs. */
export type WheelTerminal = Pick<Terminal, "scrollLines" | "buffer" | "modes" | "element" | "rows">;

/** A terminal node that keeps the wheel: its body and its xterm. */
interface Holder {
  root: HTMLElement;
  terminal: () => WheelTerminal | undefined;
  /** The fraction of a line not scrolled yet. */
  carry: number;
}

/** The wheel of one Excalidraw container: one listener for all its terminals, and the gesture under way. */
interface CanvasWheel {
  holders: Set<Holder>;
  last?: WheelSample;
  /** Who the gesture under way belongs to: a terminal, or the canvas (null). */
  owner: Holder | null;
  onWheel: (event: WheelEvent) => void;
}

const canvases = new WeakMap<HTMLElement, CanvasWheel>();

// Events this module dispatches again (to xterm, to Excalidraw): its own listener lets them pass.
const forwarded = new WeakSet<Event>();

function insideRect(rect: DOMRect, x: number, y: number): boolean {
  // A hidden body (minimized, scrolled out of the view) has no box.
  return rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** The terminal under the pointer as a gesture begins: the one its target is in (the active one), else the one under it. */
function holderUnder(holders: Set<Holder>, event: WheelEvent): Holder | null {
  const target = event.target;
  if (target instanceof Node) for (const holder of holders) if (holder.root.contains(target)) return holder;
  for (const holder of holders) if (insideRect(holder.root.getBoundingClientRect(), event.clientX, event.clientY)) return holder;
  return null;
}

function copyOf(event: WheelEvent): WheelEvent {
  const copy = new WheelEvent("wheel", {
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    bubbles: true,
    cancelable: true,
  });
  forwarded.add(copy);
  return copy;
}

function forward(term: WheelTerminal, event: WheelEvent) {
  term.element?.dispatchEvent(copyOf(event));
}

/**
 * The canvas's gesture over the active terminal, which takes the wheel itself:
 * Excalidraw pans (or zooms) only for a target that is its canvas, so the wheel
 * is handed to its interactive canvas, and the terminal does not scroll.
 */
function toCanvas(container: HTMLElement, event: WheelEvent) {
  const surface = container.querySelector<HTMLCanvasElement>("canvas.excalidraw__canvas.interactive");
  if (!surface) return;
  event.preventDefault();
  event.stopPropagation();
  surface.dispatchEvent(copyOf(event));
}

function canvasWheel(container: HTMLElement): CanvasWheel {
  const known = canvases.get(container);
  if (known) return known;
  const wheel: CanvasWheel = {
    holders: new Set(),
    owner: null,
    onWheel: (event) => {
      if (forwarded.has(event) || event.defaultPrevented) return;
      const sample = { time: event.timeStamp, x: event.clientX, y: event.clientY };
      const modifier = event.ctrlKey || event.metaKey || event.shiftKey;
      if (modifier || !sameGesture(wheel.last, sample)) {
        // Zoom (ctrl, meta), horizontal pan (shift) and a sideways start are the canvas's; else the terminal it begins over.
        wheel.owner = modifier || startsSideways(event.deltaX, event.deltaY) ? null : holderUnder(wheel.holders, event);
      }
      wheel.last = sample;
      const owner = wheel.owner;
      if (!owner) {
        const target = event.target;
        if (target instanceof Node && [...wheel.holders].some((holder) => holder.root.contains(target))) toCanvas(container, event);
        return;
      }
      const term = owner.terminal();
      if (!term) return;
      const target = event.target;
      const route = routeWheel({
        overTerminal: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        onViewport: target instanceof Element && owner.root.contains(target) && target.closest(".xterm-viewport") !== null,
        interactive: term.buffer.active.type === "alternate" || term.modes.mouseTrackingMode !== "none",
      });
      if (route === "ignore" || route === "native") return;
      event.preventDefault();
      event.stopPropagation();
      if (route === "forward") {
        forward(term, event);
        return;
      }
      const step = takeWholeLines(owner.carry, wheelLines(event.deltaY, event.deltaMode, term.rows));
      owner.carry = step.carry;
      if (step.lines !== 0) term.scrollLines(step.lines);
    },
  };
  container.addEventListener("wheel", wheel.onWheel, { capture: true, passive: false });
  canvases.set(container, wheel);
  return wheel;
}

/**
 * Keeps the wheel over a terminal node (`root`) from panning or zooming the
 * Excalidraw `canvas` that contains it, and gives it to the terminal instead.
 * `terminal` returns the node's xterm, once it exists. All the terminals of a
 * canvas share one listener, and the gesture under way.
 */
export function keepTerminalWheel(root: HTMLElement, canvas: HTMLElement, terminal: () => WheelTerminal | undefined): () => void {
  const wheel = canvasWheel(canvas);
  const holder: Holder = { root, terminal, carry: 0 };
  wheel.holders.add(holder);
  return () => {
    wheel.holders.delete(holder);
    // Its node left in the middle of a gesture: the rest of it goes to the canvas.
    if (wheel.owner === holder) wheel.owner = null;
    if (wheel.holders.size > 0) return;
    canvas.removeEventListener("wheel", wheel.onWheel, { capture: true });
    canvases.delete(canvas);
  };
}
