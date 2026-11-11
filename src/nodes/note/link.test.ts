import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createGroupFrame, type Rect } from "@/canvas/groups";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import {
  emptyNotesOf,
  footprint,
  linkFor,
  noteChanges,
  noteHostsOf,
  noteLinkOf,
  notesOutOfGroups,
  noteSpotFor,
  relinkNotes,
  remapCopiedNotes,
  settleNotes,
  withNoteLink,
  NOTE_GAP,
} from "./link";

function node(kind: "terminal" | "fleet" | "note", id: string, rect: Partial<Rect> = {}): ExcalidrawElement {
  const element = createNodeElement(kind, { x: 0, y: 0 });
  const { width, height } = NODE_SIZE[kind];
  return { ...element, id, x: 0, y: 0, width, height, ...rect } as ExcalidrawElement;
}

/** A note beside `host`, where `rect` puts it, linked from there. */
function noteOf(id: string, host: ExcalidrawElement, rect: Partial<Rect>): ExcalidrawElement {
  const note = node("note", id, rect);
  return { ...note, customData: withNoteLink(note.customData, linkFor(host.id, note, host)) };
}

const at = (elements: readonly ExcalidrawElement[], id: string) => {
  const e = elements.find((x) => x.id === id)!;
  return { x: e.x, y: e.y };
};
const moved = (e: ExcalidrawElement, fields: Partial<ExcalidrawElement>) => ({ ...e, ...fields, version: e.version + 1 }) as ExcalidrawElement;

describe("a note's link to its host", () => {
  const host = node("terminal", "batman", { x: 100, y: 50 });

  it("measures a note right of the host from its right edge, one under it from its bottom", () => {
    expect(linkFor("batman", { x: 836, y: 50, width: 280, height: 200 }, host)).toEqual({ of: "batman", x: "right", dx: 16, y: "top", dy: 0 });
    expect(linkFor("batman", { x: 100, y: 506, width: 280, height: 200 }, host)).toEqual({ of: "batman", x: "left", dx: 0, y: "bottom", dy: 16 });
    expect(linkFor("batman", { x: -200, y: 30, width: 280, height: 200 }, host)).toEqual({ of: "batman", x: "left", dx: -300, y: "top", dy: -20 });
  });

  it("puts the note back where its link says, whatever the host's size", () => {
    const link = linkFor("batman", { x: 836, y: 306, width: 280, height: 200 }, host);
    expect(noteSpotFor(link, host)).toEqual({ x: 836, y: 306 });
    // Shrunk to a card from its top-left corner: the note stays beside its right edge.
    expect(noteSpotFor(link, { x: 100, y: 50, width: 280, height: 68 })).toEqual({ x: 396, y: 306 });
  });

  it("reads only a well-formed link", () => {
    const note = node("note", "n1");
    expect(noteLinkOf(note)).toBeNull();
    expect(noteLinkOf({ ...note, customData: { ...note.customData, note: { of: "batman", dx: "1", dy: 0 } } })).toBeNull();
    expect(noteLinkOf({ ...node("terminal", "t"), customData: { kind: "terminal", note: { of: "x", dx: 0, dy: 0 } } })).toBeNull();
    expect(noteLinkOf({ ...note, customData: { ...note.customData, note: { of: "batman", x: "left", dx: 1, y: "bottom", dy: 2 } } })).toEqual({
      of: "batman",
      x: "left",
      dx: 1,
      y: "bottom",
      dy: 2,
    });
  });
});

describe("settleNotes: a note follows its host", () => {
  const host = node("terminal", "batman", { x: 0, y: 0 });
  const note = noteOf("n1", host, { x: 736, y: 0 });

  it("moves the note by its host's move, and changes nothing a second time", () => {
    const scene = [moved(host, { x: 500, y: 300 }), note];
    const settled = settleNotes(scene);
    expect(at(settled, "n1")).toEqual({ x: 1236, y: 300 });
    expect(settled.find((e) => e.id === "n1")!.version).toBe(note.version + 1);
    expect(settleNotes(settled)).toBe(settled);
  });

  it("keeps the note beside a host minimized to a card, then expanded again", () => {
    const card = settleNotes([moved(host, { width: 280, height: 68 }), note]);
    expect(at(card, "n1")).toEqual({ x: 296, y: 0 });
    const expanded = settleNotes([moved(host, { width: 720, height: 440 }), card[1]]);
    expect(at(expanded, "n1")).toEqual({ x: 736, y: 0 });
  });

  it("leaves a note alone once its host is gone, and takes it out of any frame", () => {
    const gone = [moved(host, { isDeleted: true, x: 900 }), note];
    expect(settleNotes(gone)).toBe(gone);
    const framed = settleNotes([host, { ...note, frameId: "f1" }]);
    expect(framed[1].frameId).toBeNull();
  });

  it("follows a Fleet as it follows a terminal", () => {
    const fleet = node("fleet", "chef", { x: 0, y: 0 });
    const onFleet = noteOf("n2", fleet, { x: 656, y: 0 });
    expect(at(settleNotes([moved(fleet, { x: 40 }), onFleet]), "n2")).toEqual({ x: 696, y: 0 });
    expect(noteHostsOf([fleet, onFleet, note])).toEqual({ n2: "chef" });
  });
});

describe("noteChanges: what the canvas did, between gestures", () => {
  const host = node("terminal", "batman", { x: 0, y: 0 });
  const note = noteOf("n1", host, { x: 736, y: 0 });

  it("keeps the place of a note moved by hand: a new link", () => {
    const seen = new Map<string, Rect>();
    expect(noteChanges([host, note], seen).size).toBe(0);
    const relinks = noteChanges([host, moved(note, { x: 800, y: 120 })], seen);
    expect(relinks.get("n1")).toEqual({ of: "batman", x: "right", dx: 80, y: "top", dy: 120 });
    const kept = settleNotes(relinkNotes([host, moved(note, { x: 800, y: 120 })], relinks));
    expect(at(kept, "n1")).toEqual({ x: 800, y: 120 });
  });

  it("leaves the link of a note whose host moved: the note goes back beside it", () => {
    const seen = new Map<string, Rect>();
    noteChanges([host, note], seen);
    expect(noteChanges([moved(host, { x: 300 }), note], seen).size).toBe(0);
    // Both dragged as one: the note is where its link puts it, nothing to change.
    expect(noteChanges([moved(host, { x: 400 }), moved(note, { x: 1136 })], seen).size).toBe(0);
  });

  it("keeps the place a note has when first seen (a scene loaded, a copy)", () => {
    const seen = new Map<string, Rect>();
    const off = moved(note, { x: 760, y: 40 });
    expect(noteChanges([host, off], seen).get("n1")).toMatchObject({ dx: 40, dy: 40 });
  });

  it("does not drift a stack of notes through minimize and expand", () => {
    const second = noteOf("n2", host, { x: 736, y: 216 });
    const seen = new Map<string, Rect>();
    noteChanges([host, note, second], seen);
    // Minimized: the watch settles the notes, then sees them where their links put them.
    let scene = settleNotes([moved(host, { width: 280, height: 68 }), note, second]);
    expect(noteChanges(scene, seen).size).toBe(0);
    noteChanges(scene, seen);
    scene = settleNotes([moved(scene[0], { width: 720, height: 440 }), scene[1], scene[2]]);
    expect(noteChanges(scene, seen).size).toBe(0);
    expect([at(scene, "n1"), at(scene, "n2")]).toEqual([
      { x: 736, y: 0 },
      { x: 736, y: 216 },
    ]);
  });
});

describe("the room a host takes with its notes", () => {
  it("is the box of the host and its notes, and where the host sits in it", () => {
    const host = node("terminal", "batman", { x: 100, y: 100 });
    const left = noteOf("n1", host, { x: -196, y: 100 });
    const right = noteOf("n2", host, { x: 836, y: 100 });
    expect(footprint(host, [])).toEqual({ rect: { x: 100, y: 100, width: 720, height: 440 }, offset: { x: 0, y: 0 } });
    // Measured where the host would stand: a layout moves the host, its notes keep their sides.
    expect(footprint({ ...host, x: 1000, y: 0 }, [left, right])).toEqual({ rect: { x: 704, y: 0, width: 1312, height: 440 }, offset: { x: 296, y: 0 } });
  });
});

describe("copies, closing and groups", () => {
  it("puts a note copied with its terminal beside the terminal's copy", () => {
    const host = node("terminal", "batman", { x: 0, y: 0 });
    const copyHost = node("terminal", "batman-2", { x: 0, y: 600 });
    const copy = noteOf("n1-copy", host, { x: 736, y: 600 });
    const scene = remapCopiedNotes([host, copyHost, copy], new Map([["batman", "batman-2"]]), new Set(["n1-copy"]));
    expect(noteLinkOf(scene[2])).toEqual({ of: "batman-2", x: "right", dx: 16, y: "top", dy: 0 });
    // A note copied alone stays with its terminal.
    expect(remapCopiedNotes([host, copy], new Map(), new Set(["n1-copy"]))[1]).toBe(copy);
  });

  it("names the empty notes of closing hosts: they go with them", () => {
    const host = node("terminal", "batman");
    const empty = noteOf("n1", host, { x: 736 });
    const written = noteOf("n2", host, { x: 736, y: 216 });
    const other = noteOf("n3", node("terminal", "cyborg"), { x: 0 });
    expect(emptyNotesOf([host, empty, written, other], ["batman"], (id) => id !== "n2")).toEqual(["n1"]);
  });

  it("moves a note a group grew over right of its frame, and keeps it there", () => {
    const host = { ...node("terminal", "batman", { x: 32, y: 48 }), frameId: "g1" } as ExcalidrawElement;
    const frame = createGroupFrame({ x: 0, y: 0, width: 784, height: 544 }, "Olympus", { role: "general", pantheon: "greek" }) as ExcalidrawElement;
    const note = noteOf("n1", host, { x: 800, y: 48 });
    expect(notesOutOfGroups([host, frame, note])).toEqual([host, frame, note]);
    // A new column: the frame grows to the right, over the note.
    const grown = { ...frame, width: 1536 } as ExcalidrawElement;
    const out = notesOutOfGroups([host, grown, note]);
    expect(at(out, "n1")).toEqual({ x: 1536 + NOTE_GAP, y: 48 });
    expect(settleNotes(out)).toBe(out);
  });
});
