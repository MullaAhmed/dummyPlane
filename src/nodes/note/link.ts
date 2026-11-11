import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Rect } from "@/canvas/groups";
import { nodeKindOf, type NodeKind } from "@/canvas/nodeElement";

/**
 * A quick note stands beside the node it was written for, its host (a terminal
 * or a Fleet), and keeps its place there: its element's `customData.note` says
 * which host and where, from the host's nearer edges. The note follows when the
 * host moves, is laid out, shrinks to a card or grows back; moved by hand, it
 * keeps its new place from then on. A note whose host has left the canvas stays
 * where it is, unattached, until an undo brings the host back.
 *
 * Pure: the scene goes in, the scene comes out (tests cannot load Excalidraw).
 */

/** The nodes a note can stand beside. */
export const NOTE_HOSTS: readonly NodeKind[] = ["terminal", "fleet"];

export interface NoteLink {
  /** The host's node id. */
  of: string;
  /** The host's edge the note is measured from, across: its left or its right. */
  x: "left" | "right";
  dx: number;
  /** And down: its top, or its bottom for a note under it. */
  y: "top" | "bottom";
  dy: number;
}

/** Air between a host and its notes, and between two notes of a stack. */
export const NOTE_GAP = 16;

export function isNote(element: ExcalidrawElement): boolean {
  return !element.isDeleted && nodeKindOf(element) === "note";
}

export function isNoteHost(element: ExcalidrawElement): boolean {
  const kind = nodeKindOf(element);
  return !element.isDeleted && kind !== null && NOTE_HOSTS.includes(kind);
}

/** A note element's link, or null for another element or one unreadable. */
export function noteLinkOf(element: ExcalidrawElement): NoteLink | null {
  if (nodeKindOf(element) !== "note") return null;
  const raw = element.customData?.note as Record<string, unknown> | undefined;
  if (!raw || typeof raw.of !== "string" || !raw.of) return null;
  const { dx, dy } = raw;
  if (typeof dx !== "number" || !Number.isFinite(dx) || typeof dy !== "number" || !Number.isFinite(dy)) return null;
  return { of: raw.of, x: raw.x === "left" ? "left" : "right", dx, y: raw.y === "bottom" ? "bottom" : "top", dy };
}

/** A note element's `customData` with `link`. */
export function withNoteLink(customData: ExcalidrawElement["customData"], link: NoteLink): Record<string, unknown> {
  return { ...customData, note: { ...link } };
}

const rectOf = (e: Rect): Rect => ({ x: e.x, y: e.y, width: e.width, height: e.height });

/**
 * The link that keeps `note` where it stands beside `host`: measured from the
 * host's right edge when the note is right of the host's middle (it stays
 * beside a terminal that shrinks to a card), from its bottom when the note is
 * wholly under it.
 */
export function linkFor(of: string, note: Rect, host: Rect): NoteLink {
  const x = note.x + note.width / 2 >= host.x + host.width / 2 ? "right" : "left";
  const y = note.y >= host.y + host.height ? "bottom" : "top";
  return {
    of,
    x,
    dx: note.x - (x === "right" ? host.x + host.width : host.x),
    y,
    dy: note.y - (y === "bottom" ? host.y + host.height : host.y),
  };
}

/** Where a note's top-left corner goes beside `host`. */
export function noteSpotFor(link: NoteLink, host: Rect): { x: number; y: number } {
  return {
    x: (link.x === "right" ? host.x + host.width : host.x) + link.dx,
    y: (link.y === "bottom" ? host.y + host.height : host.y) + link.dy,
  };
}

export function sameLink(a: NoteLink | null, b: NoteLink | null): boolean {
  if (!a || !b) return a === b;
  return a.of === b.of && a.x === b.x && a.y === b.y && Math.abs(a.dx - b.dx) <= 0.5 && Math.abs(a.dy - b.dy) <= 0.5;
}

/** The live hosts of the scene by id. */
export function liveHosts(elements: readonly ExcalidrawElement[]): Map<string, ExcalidrawElement> {
  return new Map(elements.filter(isNoteHost).map((e) => [e.id, e]));
}

/** The live notes standing beside `hostId`, in scene order. */
export function notesOf(elements: readonly ExcalidrawElement[], hostId: string): ExcalidrawElement[] {
  return elements.filter((e) => isNote(e) && noteLinkOf(e)?.of === hostId);
}

/** The live host a note stands beside; null when it stands alone (its host closed). */
export function hostOf(note: ExcalidrawElement, hosts: ReadonlyMap<string, ExcalidrawElement>): ExcalidrawElement | null {
  const link = noteLinkOf(note);
  return (link && hosts.get(link.of)) ?? null;
}

/** Each live host's live notes: what the layouts move and make room for with it. */
export function notesByHost(elements: readonly ExcalidrawElement[]): Map<string, ExcalidrawElement[]> {
  const hosts = liveHosts(elements);
  const byHost = new Map<string, ExcalidrawElement[]>();
  for (const e of elements) {
    if (!isNote(e)) continue;
    const host = hostOf(e, hosts);
    if (host) byHost.set(host.id, [...(byHost.get(host.id) ?? []), e]);
  }
  return byHost;
}

/** Each attached note's host, by note id: what a note's card names, and hides with (a folded group). */
export function noteHostsOf(elements: readonly ExcalidrawElement[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [hostId, notes] of notesByHost(elements)) for (const note of notes) out[note.id] = hostId;
  return out;
}

/** The ids of the notes that stand beside a live host. */
export function attachedNoteIds(elements: readonly ExcalidrawElement[]): Set<string> {
  return new Set([...notesByHost(elements).values()].flat().map((e) => e.id));
}

function boundsOf(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
}

/** Where `notes` stand when their host stands at `host`: each at its link's place. */
export function notesAt(host: Rect, notes: readonly ExcalidrawElement[]): Rect[] {
  return notes.flatMap((note) => {
    const link = noteLinkOf(note);
    return link ? [{ ...noteSpotFor(link, host), width: note.width, height: note.height }] : [];
  });
}

/**
 * What a host takes on the canvas with its notes beside it, standing at
 * `host`: the box of both, and where the host sits in it. The layouts place
 * this box, then put the host at its offset in it.
 */
export function footprint(host: Rect, notes: readonly ExcalidrawElement[]): { rect: Rect; offset: { x: number; y: number } } {
  const rect = notes.length === 0 ? rectOf(host) : boundsOf([rectOf(host), ...notesAt(host, notes)]);
  return { rect, offset: { x: host.x - rect.x, y: host.y - rect.y } };
}

const random = () => Math.floor(Math.random() * 2 ** 31);

/** `element` with `fields`, its version bumped as Excalidraw's newElementWith does. */
function changed<T extends ExcalidrawElement>(element: T, fields: Partial<T>): T {
  return { ...element, ...fields, version: element.version + 1, versionNonce: random(), updated: Date.now() };
}

/**
 * The scene with every attached note at its place beside its host, and in no
 * frame: a frame would clip it and count it as one of its terminals. A note
 * whose host is gone stays where it is. The scene itself when nothing moves;
 * calling it again changes nothing.
 */
export function settleNotes<T extends ExcalidrawElement>(elements: readonly T[]): readonly T[] {
  const hosts = liveHosts(elements);
  let moved = false;
  const next = elements.map((e) => {
    if (!isNote(e)) return e;
    const host = hostOf(e, hosts);
    const link = noteLinkOf(e);
    const spot = host && link ? noteSpotFor(link, host) : null;
    const away = spot !== null && (Math.abs(spot.x - e.x) > 0.5 || Math.abs(spot.y - e.y) > 0.5);
    if (!away && e.frameId === null) return e;
    moved = true;
    return changed(e, { ...(away ? spot : {}), frameId: null } as Partial<T>);
  });
  return moved ? next : elements;
}

/** The scene with these notes' links set (where they now stand, kept from now on); the scene itself when none changes. */
export function relinkNotes<T extends ExcalidrawElement>(elements: readonly T[], links: ReadonlyMap<string, NoteLink>): readonly T[] {
  let moved = false;
  const next = elements.map((e) => {
    const link = links.get(e.id);
    if (!link || e.isDeleted || sameLink(noteLinkOf(e), link)) return e;
    moved = true;
    return changed(e, { customData: withNoteLink(e.customData, link) } as Partial<T>);
  });
  return moved ? next : elements;
}

const sameRect = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= 0.5 && Math.abs(a.y - b.y) <= 0.5 && Math.abs(a.width - b.width) <= 0.5 && Math.abs(a.height - b.height) <= 0.5;

/**
 * What the canvas did to the notes since it was last seen (`seen`, the rects of
 * the notes and their hosts then, copied: Excalidraw moves a dragged element in
 * place). A note that moved while its host stood still was moved by hand, or
 * by an undo of such a move: it keeps its new place (a new link). A note first
 * seen (the scene loaded, a copy, a note brought back) keeps the place it has.
 * Every other note goes back beside its host (`settleNotes`). `seen` is brought
 * up to date. Called between gestures only: during a drag, nothing is decided.
 */
export function noteChanges(elements: readonly ExcalidrawElement[], seen: Map<string, Rect>): Map<string, NoteLink> {
  const hosts = liveHosts(elements);
  const relinks = new Map<string, NoteLink>();
  for (const note of elements) {
    if (!isNote(note)) continue;
    const host = hostOf(note, hosts);
    if (!host) continue;
    const before = seen.get(note.id);
    const hostBefore = seen.get(host.id);
    const moved = !before || !sameRect(before, note);
    const hostMoved = hostBefore !== undefined && !sameRect(hostBefore, host);
    if (!moved || hostMoved) continue;
    // Where its link puts it (settled there, or both moved as one): its link stays, sides included, so a
    // stack beside a terminal that shrinks to a card and grows back comes back where it was.
    const spot = noteSpotFor(noteLinkOf(note)!, host);
    if (Math.abs(spot.x - note.x) <= 0.5 && Math.abs(spot.y - note.y) <= 0.5) continue;
    relinks.set(note.id, linkFor(host.id, note, host));
  }
  for (const e of elements) if (!e.isDeleted && (isNote(e) || hosts.has(e.id))) seen.set(e.id, rectOf(e));
  return relinks;
}

/**
 * Notes copied with their host (Ctrl+D, copy-paste of both): each copy stands
 * beside the host's copy, where it was put, not beside the original. `copyOf`
 * maps an original node id to its copy's; a note copied alone keeps its host.
 */
export function remapCopiedNotes<T extends ExcalidrawElement>(elements: readonly T[], copyOf: ReadonlyMap<string, string>, noteIds: ReadonlySet<string>): readonly T[] {
  const hosts = liveHosts(elements);
  const links = new Map<string, NoteLink>();
  for (const e of elements) {
    if (!noteIds.has(e.id) || !isNote(e)) continue;
    const copyId = copyOf.get(noteLinkOf(e)?.of ?? "");
    const host = copyId ? hosts.get(copyId) : undefined;
    if (host) links.set(e.id, linkFor(host.id, e, host));
  }
  return relinkNotes(elements, links);
}

/** The live notes of `hostIds` that `isEmpty` says hold no text: they leave with their host. */
export function emptyNotesOf(elements: readonly ExcalidrawElement[], hostIds: Iterable<string>, isEmpty: (noteId: string) => boolean): string[] {
  const hosts = new Set(hostIds);
  return elements.filter((e) => isNote(e) && hosts.has(noteLinkOf(e)?.of ?? "") && isEmpty(e.id)).map((e) => e.id);
}

/**
 * The scene with no attached note covering another node: one that a terminal
 * landed on (a group's new column, a sub-agent's place) or that was dropped on
 * one moves right of that node, level where it was, and keeps that place from
 * then on. A note may stand over its own host, over a group's frame (Arrange
 * makes room for it in the group's grid), and over another note. The scene
 * itself when no note covers a node.
 */
export function notesClearOfNodes<T extends ExcalidrawElement>(elements: readonly T[]): readonly T[] {
  const hosts = liveHosts(elements);
  const nodes = elements.filter((e) => !e.isDeleted && nodeKindOf(e) !== null && nodeKindOf(e) !== "note");
  if (nodes.length === 0) return elements;
  const out = new Map<string, { x: number; link: NoteLink }>();
  for (const note of elements) {
    if (!isNote(note)) continue;
    const host = hostOf(note, hosts);
    if (!host) continue;
    const rect = rectOf(note);
    const others = nodes.filter((n) => n.id !== host.id).map(rectOf);
    // Past one node, the note may land on the next: as many passes as there are nodes.
    for (let pass = 0; pass < others.length; pass++) {
      const under = others.find((o) => overlapsRect(rect, o));
      if (!under) break;
      rect.x = under.x + under.width + NOTE_GAP;
    }
    if (rect.x !== note.x) out.set(note.id, { x: rect.x, link: linkFor(host.id, rect, host) });
  }
  if (out.size === 0) return elements;
  return elements.map((e) => {
    const moved = out.get(e.id);
    return moved ? changed(e, { x: moved.x, customData: withNoteLink(e.customData, moved.link) } as Partial<T>) : e;
  });
}

function overlapsRect(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
}
