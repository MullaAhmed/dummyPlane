import { useEffect, type PointerEvent } from "react";
import { X } from "lucide-react";
import { paletteStore } from "@/commands/paletteState";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { projectsStore } from "@/store/projects";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { chooseSlot } from "./choose";
import { radialMessages } from "./messages";
import { BUTTON_SIZE, PILL_GAP, RING_RADIUS, slotPosition } from "./gesture";
import { closeRadial, radialStore, updateRadial, useRadial } from "./radialState";
import { lineOf, RINGS } from "./rings";

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

/** The ring of the right click (spec menu radial §5). */
export function RadialMenu() {
  const ring = useRadial((s) => s.ring);
  const t = useMessages(radialMessages);
  useEffect(closeOnLeave, []);
  if (!ring) return null;
  const lines = RINGS[ring.kind].map((slot) => (slot ? lineOf(slot, ring.context) : null));
  const pill = ring.hovered !== null ? lines[ring.hovered] : null;
  return (
    <div data-radial className="dp-radial-in pointer-events-none fixed z-[45]" style={{ left: ring.center.x, top: ring.center.y }}>
      {lines.map((line, slot) => {
        if (!line) return null;
        const at = slotPosition(slot);
        return (
          <button
            key={slot}
            type="button"
            // Not data-slot: shadcn's components carry one of their own.
            data-radial-slot={slot}
            aria-label={line.label}
            aria-disabled={!line.enabled}
            className={cn(
              "dp-glass-strong pointer-events-auto absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-dp-text transition-[transform,background-color,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 motion-reduce:transition-none",
              ring.hovered === slot && line.enabled && "scale-[1.06] bg-dp-accent-soft ring-1 ring-dp-accent",
              !line.enabled && "opacity-40",
            )}
            style={{ left: at.x, top: at.y }}
            onPointerDown={keepKeyboard}
            onPointerEnter={() => updateRadial({ hovered: slot })}
            onPointerLeave={() => updateRadial({ hovered: null })}
            onClick={() => line.enabled && chooseSlot(slot)}
          >
            <line.Icon className={cn("size-4", line.danger && "text-dp-danger")} />
          </button>
        );
      })}
      <button
        type="button"
        aria-label={t.closeMenu}
        onPointerDown={keepKeyboard}
        onClick={closeRadial}
        className="dp-glass-strong pointer-events-auto absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-dp-text-2 transition-[color,background-color,transform] duration-150 ease-out hover:text-dp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97] motion-reduce:transition-none"
        style={{ left: 0, top: 0 }}
      >
        <X className="size-4" />
      </button>
      {pill && (
        <div
          className="dp-glass-strong absolute -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-xs text-dp-text"
          style={{ left: 0, top: RING_RADIUS + BUTTON_SIZE / 2 + PILL_GAP }}
        >
          {pill.reason ? `${pill.label} · ${pill.reason}` : pill.label}
        </div>
      )}
    </div>
  );
}
