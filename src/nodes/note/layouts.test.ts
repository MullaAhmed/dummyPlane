import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { arrangedElements } from "@/agents/arrange";
import { layoutSignature } from "@/agents/autoArrange";
import { GROUP_GAP } from "@/agents/groupLayout";
import { layoutSpawnTree, type ParentOf } from "@/agents/spawnLayout";
import { createGroupFrame, type Rect } from "@/canvas/groups";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import { linkFor, NOTE_GAP, notesOutOfGroups, withNoteLink } from "./link";
import { newNoteRect } from "./placement";

/**
 * The layouts keep a host's quick notes beside it and make room for them:
 * a new note's place, Arrange, the spawn tree's flowchart, Auto-arrange.
 */

const { width: W, height: H } = NODE_SIZE.terminal;
const NOTE = NODE_SIZE.note;

function terminal(id: string, x: number, y: number, extra: Partial<ExcalidrawElement> = {}): ExcalidrawElement {
  const e = createNodeElement("terminal", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
  return { ...e, id, x, y, ...extra } as ExcalidrawElement;
}

function noteBeside(id: string, host: ExcalidrawElement, x: number, y: number): ExcalidrawElement {
  const e = createNodeElement("note", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
  const note = { ...e, id, x, y } as ExcalidrawElement;
  return { ...note, customData: withNoteLink(note.customData, linkFor(host.id, note, host)) } as ExcalidrawElement;
}

const at = (elements: readonly ExcalidrawElement[], id: string) => elements.find((e) => e.id === id)!;
const pos = (elements: readonly ExcalidrawElement[], id: string) => ({ x: at(elements, id).x, y: at(elements, id).y });
const parents =
  (map: Record<string, string>): ParentOf =>
  (id) =>
    map[id] ?? null;

function overlap(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
}

function expectNoOverlap(elements: readonly ExcalidrawElement[]) {
  const nodes = elements.filter((e) => !e.isDeleted && e.type === "embeddable");
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(overlap(nodes[i], nodes[j]), `${nodes[i].id} / ${nodes[j].id}`).toBe(false);
}

describe("a new note's place", () => {
  it("goes right of its terminal, tops level, then stacks under the notes already there", () => {
    const host = terminal("batman", 0, 0);
    const first = newNoteRect([host], host, NOTE);
    expect(first).toEqual({ x: W + NOTE_GAP, y: 0, ...NOTE });
    const note = noteBeside("n1", host, first.x, first.y);
    expect(newNoteRect([host, note], host, NOTE)).toEqual({ x: W + NOTE_GAP, y: NOTE.height + NOTE_GAP, ...NOTE });
  });

  it("covers no other node: a terminal right beside pushes it to the nearest free spot", () => {
    const host = terminal("batman", 0, 0);
    const neighbour = terminal("cyborg", W + 40, 0);
    const rect = newNoteRect([host, neighbour], host, NOTE);
    expectNoOverlap([host, neighbour, { ...createNodeElement("note", { x: 0, y: 0 }), ...rect } as ExcalidrawElement]);
    expect(rect.x - (W + NOTE_GAP)).toBeGreaterThanOrEqual(0);
  });

  it("never lands inside a group's frame: beside its terminal, just outside the frame", () => {
    const frame = createGroupFrame({ x: 0, y: 0, width: 2 * 32 + W, height: 48 + H + 56 }, "Olympus", { role: "general", pantheon: "greek" }) as ExcalidrawElement;
    const host = terminal("batman", 32, 48, { frameId: frame.id });
    const rect = newNoteRect([host, frame], host, NOTE);
    expect(overlap(rect, frame)).toBe(false);
    expect(rect.y).toBe(48);
    expect(rect.x).toBe(frame.x + frame.width + NOTE_GAP);
  });
});

describe("Arrange", () => {
  it("moves a terminal's notes with it and keeps room for them: nothing lands on a note", () => {
    const a = terminal("a", 0, 0);
    const b = terminal("b", 3000, 0);
    const note = noteBeside("n1", a, W + NOTE_GAP, 0);
    const out = arrangedElements({ elements: [b, note, a], parentOf: () => null, isMinimized: () => false, aspect: 4 })!.elements;
    expectNoOverlap(out);
    // The note kept its place beside a.
    expect(pos(out, "n1")).toEqual({ x: at(out, "a").x + W + NOTE_GAP, y: at(out, "a").y });
  });

  it("takes a selected note for its terminal, and lays out a note whose terminal closed as a node of its own", () => {
    const a = terminal("a", 0, 0);
    const gone = terminal("gone", 0, 2000, { isDeleted: true });
    const alone = noteBeside("n2", gone, W + NOTE_GAP, 2000);
    const out = arrangedElements({ elements: [a, gone, alone], parentOf: () => null, isMinimized: () => false })!.elements;
    expectNoOverlap(out);
    expect(at(out, "n2").customData?.note).toEqual(alone.customData?.note);
  });

  it("keeps a minimized terminal with a note among the tabs", () => {
    const tab = terminal("tab", 0, 0, { width: 280, height: 68 });
    const note = noteBeside("n1", tab, 280 + NOTE_GAP, 0);
    const big = terminal("big", 2000, 0);
    const out = arrangedElements({ elements: [tab, note, big], parentOf: () => null, isMinimized: (id) => id === "tab" })!.elements;
    // Tabs gather under the rest.
    expect(at(out, "tab").y).toBeGreaterThan(at(out, "big").y + H - 1);
    expect(pos(out, "n1")).toEqual({ x: at(out, "tab").x + 280 + NOTE_GAP, y: at(out, "tab").y });
    expectNoOverlap(out);
  });
});

describe("the spawn tree's flowchart", () => {
  it("puts the children past the root's notes, and its children's notes follow them", () => {
    const root = terminal("root", 0, 0);
    const rootNote = noteBeside("rn", root, W + NOTE_GAP, 0);
    const child = terminal("a", 5000, 5000);
    const childNote = noteBeside("an", child, 5000 + W + NOTE_GAP, 5000);
    const out = layoutSpawnTree([root, rootNote, child, childNote], parents({ a: "root" }), "a")!;
    // The root's box is the root and its note: the child's column starts GROUP_GAP past the note.
    expect(pos(out, "a")).toEqual({ x: W + NOTE_GAP + NOTE.width + GROUP_GAP, y: 0 });
    expect(pos(out, "an")).toEqual({ x: at(out, "a").x + W + NOTE_GAP, y: 0 });
    expect(pos(out, "rn")).toEqual({ x: W + NOTE_GAP, y: 0 });
    expectNoOverlap(out);
  });

  it("is not pushed away by its own notes, but keeps clear of another terminal's", () => {
    const root = terminal("root", 0, 0);
    const child = terminal("a", 5000, 5000);
    const other = terminal("other", 0, 2000);
    const otherNote = noteBeside("on", other, W + NOTE_GAP, 2000);
    const childNote = noteBeside("an", child, 5000 + W + NOTE_GAP, 5000);
    const out = layoutSpawnTree([root, child, childNote, other, otherNote], parents({ a: "root" }), "a")!;
    expect(pos(out, "a")).toEqual({ x: W + GROUP_GAP, y: 0 });
    expect(pos(out, "on")).toEqual({ x: W + NOTE_GAP, y: 2000 });
    expectNoOverlap(out);
  });
});

it("lays out a spawn tree inside a group without creeping: its notes stand outside the frame", () => {
  const frame = createGroupFrame({ x: 0, y: 0, width: 2 * 32 + W, height: 48 + H + 56 }, "Olympus", { role: "general", pantheon: "greek" }) as ExcalidrawElement;
  const root = terminal("root", 32, 48, { frameId: frame.id });
  const child = terminal("a", 5000, 5000, { frameId: frame.id });
  const note = noteBeside("rn", root, frame.width + NOTE_GAP, 48);
  const first = layoutSpawnTree([frame, root, child, note], parents({ a: "root" }), "a")!;
  // The group grew around its members; the note moved past it, kept there.
  const settled = [...notesOutOfGroups(first)];
  expect(layoutSpawnTree(settled, parents({ a: "root" }), "a")).toBeNull();
  expect(pos(settled, "a")).toEqual({ x: 32 + W + GROUP_GAP, y: 48 });
});

it("Auto-arrange leaves the canvas as it is when a note opens or closes", () => {
  const a = terminal("a", 0, 0);
  const note = noteBeside("n1", a, W + NOTE_GAP, 0);
  expect(layoutSignature([a, note], () => false)).toBe(layoutSignature([a], () => false));
});
