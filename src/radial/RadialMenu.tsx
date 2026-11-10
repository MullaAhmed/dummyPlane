import { useEffect, useState, type MouseEvent, type PointerEvent } from "react";
import { X } from "lucide-react";
import { paletteStore } from "@/commands/paletteState";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { projectsStore } from "@/store/projects";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { chooseSlot } from "./choose";
import { radialMessages } from "./messages";
import { HIT_RADIUS, HUB_RADIUS, OUTER_RADIUS, POP, popOffset, slotAt, slotPosition, wedgePath } from "./gesture";
import { closeRadial, radialStore, updateRadial, useRadial } from "./radialState";
import { lineOf, RINGS, type RingLine } from "./rings";

/** The ring closes when its context goes: another workspace or project, a dialog, the palette (spec menu radial §7). */
function closeOnLeave() {
  const close = () => {
    if (radialStore.getState().ring) closeRadial();
  };
  const unsubscribes = [
    workspacesStore.subscribe((s, prev) => s.activeId !== prev.activeId && close()),
    projectsStore.subscribe((s, prev) => (s.view !== prev.view || s.activeId !== prev.activeId) && close()),
    uiStore.subscribe((s) => (s.closing !== null || s.closingGroup !== null) && close()),
    paletteStore.subscribe((s) => s.open && close()),
  ];
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

/** A press on the ring leaves the keyboard where it was: after "Paste", Enter still goes to the terminal. */
const keepKeyboard = (event: PointerEvent) => event.preventDefault();

/** Half the side of a wedge's box: the wheel, the pointed wedge's move and its hairline. */
const BOX = OUTER_RADIUS + POP + 2;

/** The slot under the pointer, by its place on the wheel. */
function slotUnder(event: { clientX: number; clientY: number }): number | null {
  const { ring } = radialStore.getState();
  return ring ? slotAt(ring.center, { x: event.clientX, y: event.clientY }, RINGS[ring.kind].length) : null;
}

/** With the mouse, after a click: the wedge pointed at follows the pointer. A slide's is install.ts's. */
function follow(event: PointerEvent) {
  const { ring } = radialStore.getState();
  if (!ring || ring.pressed) return;
  const hovered = slotUnder(event);
  if (hovered !== ring.hovered) updateRadial({ hovered });
}

function unpoint() {
  const { ring } = radialStore.getState();
  if (ring && !ring.pressed && ring.hovered !== null) updateRadial({ hovered: null });
}

interface WedgeProps {
  slot: number;
  count: number;
  line: RingLine;
  pointed: boolean;
  pressed: boolean;
}

/**
 * One command of the wheel. A real button, for the keyboard and assistive
 * technology, but not for the mouse: the wheel's hit circle above it takes the
 * pointer, so the wedge pointed at may move out without its edge flickering.
 */
function Wedge({ slot, count, line, pointed, pressed }: WedgeProps) {
  const lit = pointed && line.enabled;
  const label = slotPosition(slot, count);
  const pop = popOffset(slot, count);
  return (
    // A raw button, not shadcn's: the wedge is drawn by its path, and Button's box, border and hover would fight it.
    <button
      type="button"
      // Not data-slot: shadcn's components carry one of their own.
      data-radial-slot={slot}
      aria-label={line.label}
      aria-disabled={!line.enabled}
      aria-description={line.reason ?? undefined}
      className={cn(
        "group pointer-events-none absolute outline-none transition-[translate,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none",
        // Pressed, it sinks back toward the hub: with the mouse (the hit circle tells), or held from the keyboard.
        pressed && lit && "scale-[0.97]",
        line.enabled && "active:scale-[0.97]",
      )}
      style={{ left: -BOX, top: -BOX, width: 2 * BOX, height: 2 * BOX, translate: lit ? `${pop.x}px ${pop.y}px` : undefined }}
      onPointerDown={keepKeyboard}
      onFocus={() => updateRadial({ hovered: slot })}
      onBlur={() => radialStore.getState().ring?.hovered === slot && updateRadial({ hovered: null })}
      onClick={() => line.enabled && chooseSlot(slot)}
    >
      <svg aria-hidden viewBox={`${-BOX} ${-BOX} ${2 * BOX} ${2 * BOX}`} className="absolute inset-0 size-full">
        <path
          d={wedgePath(slot, count)}
          className={cn(
            "stroke-1 transition-[fill,stroke] duration-(--dp-dur-fast) ease-(--dp-ease-out) group-focus-visible:stroke-2 group-focus-visible:stroke-dp-accent motion-reduce:transition-none",
            !pointed && "fill-dp-surface stroke-dp-line",
            // Its hairline in the ink written on it: the ground's color, unseen on the canvas, but the edge that keeps
            // its shape over a terminal, whose color the accent nearly is in the light palette.
            lit && (line.danger ? "fill-dp-danger stroke-dp-on-accent" : "fill-dp-accent stroke-dp-on-accent"),
            // Pointed but unable to run: a surface step, never the fill that means "this runs".
            pointed && !line.enabled && "fill-dp-card stroke-dp-line",
          )}
        />
      </svg>
      <span
        className={cn(
          "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none",
          lit ? "text-dp-on-accent" : "text-dp-text",
          !line.enabled && "opacity-50",
        )}
        style={{ left: BOX + label.x, top: BOX + label.y }}
      >
        <line.Icon className={cn("size-4", !lit && (line.danger ? "text-dp-danger" : "text-dp-text-2"))} />
        {/* A name longer than any of today's wraps rather than crossing the wedge's edge. */}
        <span className="block w-max max-w-18 text-center text-xs leading-4 font-medium text-balance">{line.short}</span>
      </span>
    </button>
  );
}

/** The ring of the right click, a wheel of wedges around a hub (spec menu radial §5). */
export function RadialMenu() {
  const ring = useRadial((s) => s.ring);
  const t = useMessages(radialMessages);
  const [pressed, setPressed] = useState<number | null>(null);
  useEffect(closeOnLeave, []);
  if (!ring) return null;
  const lines = RINGS[ring.kind].map((slot) => lineOf(slot, ring.context));
  const pointed = ring.hovered !== null ? lines[ring.hovered] : null;
  /** A click on the wheel runs the wedge it points at, a gap and the slack around included; on the hub, it closes. */
  const choose = (event: MouseEvent) => {
    setPressed(null);
    const slot = slotUnder(event);
    if (slot === null) closeRadial();
    else if (lines[slot]?.enabled) chooseSlot(slot);
  };
  return (
    <div
      data-radial
      className="dp-radial dp-radial-in pointer-events-none fixed z-[45]"
      style={{ left: ring.center.x, top: ring.center.y }}
      onPointerMove={follow}
      onPointerLeave={() => {
        setPressed(null);
        unpoint();
      }}
    >
      {lines.map((line, slot) =>
        line ? <Wedge key={slot} slot={slot} count={lines.length} line={line} pointed={ring.hovered === slot} pressed={pressed === slot} /> : null,
      )}
      {/* The pointer's side of the wheel: one circle, so that the corners of its box fall through to the canvas and close it. */}
      <div
        data-radial-hit
        aria-hidden
        className={cn("pointer-events-auto absolute", pointed?.enabled && "cursor-pointer")}
        style={{ left: -HIT_RADIUS, top: -HIT_RADIUS, width: 2 * HIT_RADIUS, height: 2 * HIT_RADIUS, clipPath: "circle(50%)" }}
        onPointerDown={(event) => {
          keepKeyboard(event);
          if (event.button === 0) setPressed(slotUnder(event));
        }}
        onPointerUp={() => setPressed(null)}
        onClick={choose}
      />
      <button
        type="button"
        data-radial-hub
        aria-label={t.closeMenu}
        onPointerDown={keepKeyboard}
        onClick={closeRadial}
        className="pointer-events-auto absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-dp-line bg-dp-surface text-dp-text-2 transition-[color,background-color,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:bg-dp-card hover:text-dp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 focus-visible:ring-inset active:scale-[0.97] motion-reduce:transition-none"
        style={{ left: 0, top: 0, width: 2 * HUB_RADIUS, height: 2 * HUB_RADIUS }}
      >
        {pointed ? (
          // The full name of the wedge pointed at, and why it cannot run. The button keeps its own name: it closes the menu.
          <span aria-hidden className="flex flex-col items-center gap-1 px-1 text-center">
            <span className="line-clamp-2 text-(length:--text-ui) leading-4 font-medium text-balance text-dp-text">{pointed.label}</span>
            {pointed.reason && <span className="line-clamp-2 text-xs text-balance text-dp-text-3">{sentence(pointed.reason)}</span>}
          </span>
        ) : (
          <X className="size-4" />
        )}
      </button>
    </div>
  );
}

/** A reason on a line of its own starts with a capital ("nothing selected" → "Nothing selected"). */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
