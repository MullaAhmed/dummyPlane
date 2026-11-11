import { arcLayout } from "./gesture";
import { radialStore, updateRadial } from "./radialState";
import { ARCS, moreSlotOf, wedgeCountOf } from "./rings";

/**
 * How long the pointer rests on More before its arc opens: long enough that sweeping across the
 * wedge on the way to another does not open it, short enough to feel like a hover. A click, a
 * slide released there or Enter opens it at once.
 */
export const ARC_INTENT_MS = 180;

let intent: ReturnType<typeof setTimeout> | null = null;

/**
 * Opens the More arc of the ring on screen, its wedges laid out to fit the window, More pointed
 * at. From the keyboard, its first wedge is pointed at too, and nothing eases. A slide under way
 * goes on into it.
 */
export function openArc(options: { keyboard?: boolean } = {}) {
  cancelArcIntent();
  const { ring } = radialStore.getState();
  if (!ring) return;
  const more = moreSlotOf(ring.kind);
  const arc = arcLayout(ring.center, more, wedgeCountOf(ring.kind), ARCS[ring.kind].length, { width: window.innerWidth, height: window.innerHeight });
  updateRadial({ arc, item: options.keyboard ? 0 : null, hovered: more, arcInstant: options.keyboard === true, ...(options.keyboard ? { keyboard: true } : {}) });
}

/** Back to the ring: the arc closes, More still pointed at. */
export function closeArc(options: { keyboard?: boolean } = {}) {
  cancelArcIntent();
  const { ring } = radialStore.getState();
  if (!ring?.arc) return;
  updateRadial({ arc: null, item: null, hovered: moreSlotOf(ring.kind), ...(options.keyboard ? { keyboard: true } : {}) });
}

/** The pointer has come to rest on More: its arc opens after ARC_INTENT_MS, unless it moves on. */
export function scheduleArcIntent() {
  if (intent !== null) return;
  intent = setTimeout(() => {
    intent = null;
    const { ring } = radialStore.getState();
    if (ring && !ring.arc && ring.hovered === moreSlotOf(ring.kind)) openArc();
  }, ARC_INTENT_MS);
}

export function cancelArcIntent() {
  if (intent !== null) clearTimeout(intent);
  intent = null;
  cancelArcLeave();
}

let leave: ReturnType<typeof setTimeout> | null = null;

/**
 * The pointer is on another wedge of the ring: the arc closes once it rests there (ARC_INTENT_MS),
 * not while it crosses the ring on its way to an arc turned away from More by the window's edge.
 */
function scheduleArcLeave() {
  if (leave !== null) return;
  leave = setTimeout(() => {
    leave = null;
    const { ring } = radialStore.getState();
    if (ring?.arc && ring.hovered !== moreSlotOf(ring.kind) && ring.item == null) updateRadial({ arc: null, item: null });
  }, ARC_INTENT_MS);
}

function cancelArcLeave() {
  if (leave !== null) clearTimeout(leave);
  leave = null;
}

/**
 * The pointer now points at `slot` of the ring and `item` of the arc: the ring's pointed wedge
 * and the arc's follow. Resting on More opens its arc; resting on another wedge of the ring closes it.
 */
export function pointTo(slot: number | null, item: number | null) {
  const { ring } = radialStore.getState();
  if (!ring) return;
  const more = moreSlotOf(ring.kind);
  if (ring.arc) {
    if (slot !== null && slot !== more) {
      scheduleArcLeave();
      if (slot !== ring.hovered || ring.item != null) updateRadial({ hovered: slot, item: null });
      return;
    }
    // In the arc, on More, or past the rim on the way to the arc: the arc stays, More pointed as its parent.
    cancelArcLeave();
    if (item !== (ring.item ?? null) || ring.hovered !== more) updateRadial({ item, hovered: more });
    return;
  }
  if (slot === more) scheduleArcIntent();
  else cancelArcIntent();
  if (slot !== ring.hovered) updateRadial({ hovered: slot });
}
