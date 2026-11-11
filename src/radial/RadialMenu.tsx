import { useEffect, useState, type MouseEvent, type PointerEvent } from "react";
import { X } from "lucide-react";
import { paletteStore } from "@/commands/paletteState";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { projectsStore } from "@/store/projects";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import type { Point } from "@/agents/terminals";
import { cancelArcIntent, pointTo } from "./arc";
import { chooseItem, chooseSlot } from "./choose";
import { radialMessages } from "./messages";
import {
  ARC_HIT,
  ARC_OUTER,
  arcHitPath,
  arcPopOffset,
  arcPosition,
  arcWedgePath,
  HIT_RADIUS,
  HUB_RADIUS,
  OUTER_RADIUS,
  POP,
  pointingAt,
  popOffset,
  slotPosition,
  wedgePath,
  type Pointing,
} from "./gesture";
import { closeRadial, radialStore, updateRadial, useRadial } from "./radialState";
import { arcLines, ringLines, wedgeCountOf, type RingLine } from "./rings";

/** The ring closes when its context goes: another workspace or project, a dialog, the palette. */
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

/** Half the side of a ring wedge's box: the wheel, the pointed wedge's move and its hairline. */
const BOX = OUTER_RADIUS + POP + 2;
/** The same for a wedge of the More arc. */
const ARC_BOX = ARC_OUTER + POP + 2;

/** What the pointer points at, by its place on the wheel and the open arc. */
function pointingUnder(event: { clientX: number; clientY: number }): Pointing {
  const { ring } = radialStore.getState();
  if (!ring) return { slot: null, item: null };
  return pointingAt(ring.center, { x: event.clientX, y: event.clientY }, wedgeCountOf(ring.kind), ring.arc ?? null);
}

/** With the mouse, after a click: the wedge pointed at follows the pointer, and resting on More opens its arc. A slide's is install.ts's. */
function follow(event: PointerEvent) {
  const { ring } = radialStore.getState();
  if (!ring) return;
  // The pointer takes the wheel back from the keyboard: the wedges ease again.
  if (ring.keyboard) updateRadial({ keyboard: false });
  if (ring.pressed) return;
  const { slot, item } = pointingUnder(event);
  pointTo(slot, item);
}

/** The pointer left the wheel: nothing is pointed at, an open arc stays open. */
function unpoint() {
  const { ring } = radialStore.getState();
  if (!ring || ring.pressed) return;
  cancelArcIntent();
  if (ring.arc) {
    if (ring.item != null) updateRadial({ item: null });
  } else if (ring.hovered !== null) updateRadial({ hovered: null });
}

interface WedgeProps {
  line: RingLine;
  /** The wedge's outline, centered on the ring's center. */
  path: string;
  /** Where its icon and name sit, and where it moves when pointed at. */
  label: Point;
  pop: Point;
  /** Half the side of its box. */
  box: number;
  pointed: boolean;
  pressed: boolean;
  /** Data attributes that say which wedge it is. */
  data: Record<string, string | number>;
  /** The More wedge: whether its arc is open. */
  expanded?: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onClick: () => void;
}

/**
 * One command of the wheel or of its More arc. A real button, for the keyboard and assistive
 * technology, but not for the mouse: the hit areas above it take the pointer, so the wedge
 * pointed at may move out without its edge flickering.
 */
function Wedge({ line, path, label, pop, box, pointed, pressed, data, expanded, onFocus, onBlur, onClick }: WedgeProps) {
  const lit = pointed && line.enabled;
  return (
    // A raw button, not shadcn's: the wedge is drawn by its path, and Button's box, border and hover would fight it.
    <button
      type="button"
      {...data}
      aria-label={line.label}
      aria-disabled={!line.enabled}
      aria-description={line.reason ?? undefined}
      aria-expanded={expanded}
      className={cn(
        "group pointer-events-none absolute outline-none transition-[translate,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none [[data-keyboard]_&]:transition-none",
        // Pressed, it sinks back toward the hub: with the mouse (the hit circle tells), or held from the keyboard.
        pressed && lit && "scale-[0.97]",
        line.enabled && "active:scale-[0.97]",
      )}
      style={{ left: -box, top: -box, width: 2 * box, height: 2 * box, translate: lit ? `${pop.x}px ${pop.y}px` : undefined }}
      onPointerDown={keepKeyboard}
      // Only the keyboard focuses a wedge (the pointer's press keeps the focus where it was).
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={() => line.enabled && onClick()}
    >
      <svg aria-hidden viewBox={`${-box} ${-box} ${2 * box} ${2 * box}`} className="absolute inset-0 size-full">
        <path
          d={path}
          className={cn(
            "stroke-1 transition-[fill,stroke] duration-(--dp-dur-fast) ease-(--dp-ease-out) group-focus-visible:stroke-2 group-focus-visible:stroke-dp-accent motion-reduce:transition-none [[data-keyboard]_&]:transition-none",
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
          "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none [[data-keyboard]_&]:transition-none",
          lit ? "text-dp-on-accent" : "text-dp-text",
          !line.enabled && "opacity-50",
        )}
        style={{ left: box + label.x, top: box + label.y }}
      >
        <line.Icon className={cn("size-4", !lit && (line.danger ? "text-dp-danger" : "text-dp-text-2"))} />
        {/* A name longer than any of today's wraps rather than crossing the wedge's edge. */}
        <span className="block w-max max-w-18 text-center text-xs leading-4 font-medium text-balance">{line.short}</span>
      </span>
    </button>
  );
}

/** The ring of the right click, a wheel of wedges around a hub, and the arc its More opens. */
export function RadialMenu() {
  const ring = useRadial((s) => s.ring);
  const t = useMessages(radialMessages);
  // The wedge the mouse holds down: `r3` on the ring, `a1` in the arc.
  const [pressed, setPressed] = useState<string | null>(null);
  useEffect(closeOnLeave, []);
  useEffect(() => cancelArcIntent, []);
  // A press the window lost (alt-tab mid-click) never sees its pointerup: the wedge does not stay sunk.
  useEffect(() => {
    const release = () => setPressed(null);
    window.addEventListener("blur", release);
    return () => window.removeEventListener("blur", release);
  }, []);
  if (!ring) return null;
  const lines = ringLines(ring.kind, ring.context);
  const arc = ring.arc ?? null;
  const items = arc ? arcLines(ring.kind, ring.context) : [];
  const item = arc ? (ring.item ?? null) : null;
  const pointed = item !== null ? items[item] : ring.hovered !== null ? lines[ring.hovered] : null;
  const keyOf = ({ slot, item: at }: Pointing) => (at !== null ? `a${at}` : slot !== null ? `r${slot}` : null);
  /** A click runs the wedge it points at, a gap and the slack around included; More opens its arc; elsewhere, it closes. */
  const choose = (event: MouseEvent) => {
    setPressed(null);
    const at = pointingUnder(event);
    if (at.item !== null) {
      if (items[at.item]?.enabled) chooseItem(at.item);
    } else if (at.slot !== null) {
      if (lines[at.slot]?.enabled) chooseSlot(at.slot);
    } else closeRadial();
  };
  const press = (event: PointerEvent) => {
    keepKeyboard(event);
    if (event.button === 0) setPressed(keyOf(pointingUnder(event)));
  };
  const release = () => setPressed(null);
  return (
    // It opens at once, where the right click was: opened tens of times a day, and the wedge under a
    // sliding pointer must not move while the wheel grows.
    <div
      data-radial
      data-keyboard={ring.keyboard || undefined}
      className="dp-radial pointer-events-none fixed z-[45]"
      style={{ left: ring.center.x, top: ring.center.y }}
      onPointerMove={follow}
      onPointerLeave={() => {
        setPressed(null);
        unpoint();
      }}
    >
      {lines.map((line, slot) =>
        line ? (
          <Wedge
            key={slot}
            line={line}
            path={wedgePath(slot, lines.length)}
            label={slotPosition(slot, lines.length)}
            pop={popOffset(slot, lines.length)}
            box={BOX}
            pointed={ring.hovered === slot}
            pressed={pressed === `r${slot}`}
            data={{ "data-radial-slot": slot, ...(line.more ? { "data-radial-more": "" } : {}) }}
            expanded={line.more ? arc !== null : undefined}
            onFocus={() => {
              // Back on the ring from the arc: the arc closes, unless it is More's own.
              updateRadial(line.more ? { hovered: slot, keyboard: true, item: null } : { hovered: slot, keyboard: true, arc: null, item: null });
            }}
            onBlur={() => radialStore.getState().ring?.hovered === slot && !radialStore.getState().ring?.arc && updateRadial({ hovered: null })}
            onClick={() => chooseSlot(slot)}
          />
        ) : null,
      )}
      {arc && (
        // The arc fans out from More: it grows from the ring's center, a fade alone when motion is reduced, at once from the keyboard.
        <div
          role="group"
          aria-label={t.more}
          data-radial-arc
          // Read from how it opened, not from the keyboard of the moment: dropping `data-instant` later would replay the entrance.
          data-instant={ring.arcInstant ? "" : undefined}
          className="absolute top-0 left-0 animate-in fade-in-0 zoom-in-95 duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:[--tw-enter-scale:1]"
        >
          {items.map((line, index) =>
            line ? (
              <Wedge
                key={index}
                line={line}
                path={arcWedgePath(arc, index)}
                label={arcPosition(arc, index)}
                pop={arcPopOffset(arc, index)}
                box={ARC_BOX}
                pointed={item === index}
                pressed={pressed === `a${index}`}
                data={{ "data-radial-item": index }}
                onFocus={() => updateRadial({ item: index, keyboard: true })}
                onBlur={() => radialStore.getState().ring?.item === index && updateRadial({ item: null })}
                onClick={() => chooseItem(index)}
              />
            ) : null,
          )}
          {/* The pointer's side of the arc: its band and the slack around it, from the ring's rim out. */}
          <svg aria-hidden className="pointer-events-none absolute overflow-visible" style={{ left: -ARC_HIT, top: -ARC_HIT, width: 2 * ARC_HIT, height: 2 * ARC_HIT }} viewBox={`${-ARC_HIT} ${-ARC_HIT} ${2 * ARC_HIT} ${2 * ARC_HIT}`}>
            <path
              data-radial-arc-hit
              d={arcHitPath(arc)}
              fill="transparent"
              className={cn("pointer-events-auto", item !== null && items[item]?.enabled && "cursor-pointer")}
              onPointerDown={press}
              onPointerUp={release}
              onPointerCancel={release}
              onClick={choose}
            />
          </svg>
        </div>
      )}
      {/* The pointer's side of the wheel: one circle, so that the corners of its box fall through to the canvas and close it. */}
      <div
        data-radial-hit
        aria-hidden
        className={cn("pointer-events-auto absolute", pointed?.enabled && "cursor-pointer")}
        style={{ left: -HIT_RADIUS, top: -HIT_RADIUS, width: 2 * HIT_RADIUS, height: 2 * HIT_RADIUS, clipPath: "circle(50%)" }}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onClick={choose}
      />
      <button
        type="button"
        data-radial-hub
        aria-label={t.closeMenu}
        onPointerDown={keepKeyboard}
        onClick={closeRadial}
        className="pointer-events-auto absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-dp-line bg-dp-surface text-dp-text-2 transition-[color,background-color,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:bg-dp-card hover:text-dp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/70 focus-visible:ring-inset active:scale-[0.97] motion-reduce:transition-none"
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
