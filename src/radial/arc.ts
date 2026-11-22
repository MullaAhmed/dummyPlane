import type { CommandContext } from "@/commands/command";
import type { Point } from "@/agents/terminals";
import { arcAngle, arcToward, ringArea, SLIDE_THRESHOLD, slotDirection } from "./gesture";
import { radialStore, updateRadial, type OpenArc, type RadialOpen } from "./radialState";
import { arcOf, lineOf, RINGS, type RingSlot } from "./rings";

/**
 * How long the pointer rests on a wedge with an arc (More, Arrange, Other agent) before its arc opens:
 * long enough that sweeping across the wedge on the way to another does not open it, short enough to
 * feel like a hover. A click, a slide released there or Enter opens it at once.
 */
export const ARC_INTENT_MS = 180;

/** What an arc opens from: a wedge of the ring, or a wedge of the open arc (More's Arrange, whose layouts take its arc's place). */
export type ArcFrom = { slot: number } | { item: number };

interface Owner {
  slot: RingSlot;
  /** The context it reads: the ring's, or the open arc's. */
  context: CommandContext;
  /** Where its arc fans out from: its middle. */
  direction: number;
  /** The ring's wedge the arc hangs from. */
  root: number;
  /** The arc it replaces, at the wedge it opens from. */
  parent: OpenArc["parent"];
}

function ownerOf(ring: RadialOpen, from: ArcFrom): Owner | null {
  if ("slot" in from) {
    const slots = RINGS[ring.kind];
    const slot = slots[from.slot];
    return slot ? { slot, context: ring.context, direction: slotDirection(from.slot, slots.length), root: from.slot, parent: null } : null;
  }
  const arc = ring.arc;
  const slot = arc?.slots[from.item];
  return arc && slot ? { slot, context: arc.context, direction: arcAngle(arc, from.item), root: arc.slot, parent: { arc, item: from.item } } : null;
}

/** Whether `from`, on the ring on screen, opens an arc: it has one, and is not greyed (the selection's Arrange for drawings alone). */
export function opensArc(from: ArcFrom): boolean {
  const { ring } = radialStore.getState();
  const owner = ring ? ownerOf(ring, from) : null;
  return owner?.slot.arc !== undefined && lineOf(owner.slot, owner.context)?.enabled === true;
}

/** Where the pointer last was over the ring: where the wedges of an arc opened from an arc's wedge come under it. */
let lastPointer: Point | null = null;

/** The wedges an arc lists, by their commands: to tell whether a look changed them. */
const idsOf = (slots: readonly RingSlot[], context: CommandContext) => slots.map((slot) => lineOf(slot, context)?.command?.id ?? "").join(" ");

/**
 * Opens the arc of `from` (by default, the wedge of the ring pointed at), its wedges laid out to fit the window, its
 * wedge on the ring pointed at. From the keyboard, its first wedge is pointed at too, and nothing eases. A slide
 * under way goes on into it. Opened from a wedge of the open arc (More's Arrange), it takes that arc's place, its
 * wedges centred on that wedge; opened so by the pointer, it is unarmed until the pointer moves (`OpenArc.under`). An
 * arc that waits for a first look (the agents found on this machine) opens once it is over, if its wedge is still
 * pointed at, on what it found: a look that failed opens it all the same (Other agent's says no agent was found), and
 * is not made again.
 */
export function openArc(options: { keyboard?: boolean; from?: ArcFrom; at?: Point; looked?: boolean } = {}) {
  cancelArcIntent();
  const { ring } = radialStore.getState();
  if (!ring) return;
  const from = options.from ?? (ring.hovered !== null ? { slot: ring.hovered } : null);
  const owner = from ? ownerOf(ring, from) : null;
  if (!from || !owner) return;
  const look = options.looked ? null : owner.slot.look?.();
  if (look && !look.ready) {
    void look.done.then(() => {
      const now = radialStore.getState().ring;
      if (now?.context === ring.context && (now.arc ?? null) === (ring.arc ?? null) && stillPointed(now, from)) openArc({ ...options, from, looked: true });
    });
    return;
  }
  const open = arcOf(owner.slot, owner.context);
  if (!open || open.slots.length === 0) return;
  const keyboard = options.keyboard === true;
  const layout = arcToward(ring.center, owner.direction, open.slots.length, ringArea(window));
  const under = owner.parent && !keyboard ? (options.at ?? lastPointer) : null;
  const arc: OpenArc = { ...layout, slot: owner.root, slots: open.slots, context: open.context, label: open.label, parent: owner.parent, under };
  updateRadial({ arc, item: keyboard ? 0 : null, hovered: owner.root, arcInstant: keyboard, ...(keyboard ? { keyboard: true } : {}) });
  // A look made since (an agent installed meanwhile) that changes what the arc lists: it is laid out again, in place.
  if (look) {
    void look.done.then(() => {
      const now = radialStore.getState().ring;
      if (!now?.arc || now.arc.slots !== arc.slots) return;
      const again = arcOf(owner.slot, owner.context);
      if (!again || again.slots.length === 0 || idsOf(again.slots, again.context) === idsOf(arc.slots, arc.context)) return;
      const { middle, count, step } = arcToward(now.center, owner.direction, again.slots.length, ringArea(window));
      const item = now.item != null && now.item < count ? now.item : null;
      updateRadial({ arc: { ...now.arc, middle, count, step, slots: again.slots, context: again.context }, item });
    });
  }
}

/**
 * Back one step: from an arc that took another's place (Arrange's layouts, from More's), to that one, the wedge it
 * opened from pointed at; else to the ring, its wedge still pointed at.
 */
export function closeArc(options: { keyboard?: boolean } = {}) {
  cancelArcIntent();
  const { ring } = radialStore.getState();
  const arc = ring?.arc;
  if (!ring || !arc) return;
  const keyboard = options.keyboard ? { keyboard: true } : {};
  if (arc.parent) updateRadial({ arc: arc.parent.arc, item: arc.parent.item, hovered: arc.slot, arcInstant: true, ...keyboard });
  else updateRadial({ arc: null, item: null, hovered: arc.slot, ...keyboard });
}

/** The keyboard points at `item` of the open arc: an arc unarmed under the pointer is armed, the keyboard chose to be there. */
export function pointItemByKeyboard(item: number | null) {
  const arc = radialStore.getState().ring?.arc;
  updateRadial({ item, keyboard: true, ...(arc?.under ? { arc: { ...arc, under: null } } : {}) });
}

/** Whether `from` is still where the pointer (or the keyboard) rests, its arc not open yet. */
function stillPointed(ring: RadialOpen, from: ArcFrom): boolean {
  if ("slot" in from) return ring.hovered === from.slot && ring.item == null && !(ring.arc && ring.arc.slot === from.slot && !ring.arc.parent);
  return ring.arc != null && ring.item === from.item && !ring.arc.under;
}

let intent: { timer: ReturnType<typeof setTimeout>; key: string } | null = null;

/** The pointer has come to rest on a wedge with an arc: its arc opens after ARC_INTENT_MS, unless it moves on. */
export function scheduleArcIntent(from: ArcFrom) {
  const key = "slot" in from ? `r${from.slot}` : `a${from.item}`;
  if (intent?.key === key) return;
  clearIntent();
  const slots = radialStore.getState().ring?.arc?.slots;
  const timer = setTimeout(() => {
    intent = null;
    const { ring } = radialStore.getState();
    if (ring && stillPointed(ring, from) && ("slot" in from || ring.arc?.slots === slots)) openArc({ from });
  }, ARC_INTENT_MS);
  intent = { timer, key };
}

function clearIntent() {
  if (intent !== null) clearTimeout(intent.timer);
  intent = null;
}

export function cancelArcIntent() {
  clearIntent();
  cancelArcLeave();
}

let leave: ReturnType<typeof setTimeout> | null = null;

/**
 * The pointer is on another wedge of the ring: the arc closes once it rests there (ARC_INTENT_MS),
 * not while it crosses the ring on its way to an arc turned away from its wedge by the window's edge.
 * Rested on a wedge with an arc of its own (Other agent, from Arrange's), that arc opens in its place.
 */
function scheduleArcLeave() {
  if (leave !== null) return;
  leave = setTimeout(() => {
    leave = null;
    const { ring } = radialStore.getState();
    if (!ring?.arc || ring.hovered === ring.arc.slot || ring.item != null) return;
    updateRadial({ arc: null, item: null });
    if (ring.hovered !== null && opensArc({ slot: ring.hovered })) openArc({ from: { slot: ring.hovered } });
  }, ARC_INTENT_MS);
}

function cancelArcLeave() {
  if (leave !== null) clearTimeout(leave);
  leave = null;
}

/**
 * The pointer, at `pointer`, now points at `slot` of the ring and `item` of the arc: the ring's pointed wedge and
 * the arc's follow. Resting on a wedge with an arc opens it; resting on another wedge of the ring closes the arc
 * open; resting on its own wedge, from an arc that took its own's place, brings its own back (More's).
 */
export function pointTo(slot: number | null, item: number | null, pointer?: Point) {
  if (pointer) lastPointer = pointer;
  const { ring } = radialStore.getState();
  if (!ring) return;
  let arc = ring.arc ?? null;
  // Its wedges came under the pointer: it arms once the pointer has moved off where it stood.
  if (arc?.under && pointer && Math.hypot(pointer.x - arc.under.x, pointer.y - arc.under.y) > SLIDE_THRESHOLD) {
    arc = { ...arc, under: null };
    updateRadial({ arc });
  }
  if (arc) {
    if (slot !== null && slot !== arc.slot) {
      clearIntent();
      scheduleArcLeave();
      if (slot !== ring.hovered || ring.item != null) updateRadial({ hovered: slot, item: null });
      return;
    }
    // In the arc, on its wedge, or past the rim on the way to the arc: the arc stays, its wedge pointed as its parent.
    cancelArcLeave();
    const at = arc.under ? null : item;
    if (at !== null && opensArc({ item: at })) scheduleArcIntent({ item: at });
    else if (slot === arc.slot && arc.parent) scheduleArcIntent({ slot });
    else clearIntent();
    if (at !== (ring.item ?? null) || ring.hovered !== arc.slot) updateRadial({ item: at, hovered: arc.slot });
    return;
  }
  if (slot !== null && opensArc({ slot })) scheduleArcIntent({ slot });
  else clearIntent();
  if (slot !== ring.hovered) updateRadial({ hovered: slot });
}
