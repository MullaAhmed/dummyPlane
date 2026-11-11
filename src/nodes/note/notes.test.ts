// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { linkFor, noteLinkOf, NOTE_GAP, withNoteLink } from "./link";
import { addNote, createNoteWatch, deleteNote, focusNote, onNodesGone } from "./notes";
import { revealNode } from "@/canvas/arrive";

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { NEVER: "NEVER", IMMEDIATELY: "IMMEDIATELY" } }));
vi.mock("@/canvas/arrive", () => ({ revealNode: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const { width: W } = NODE_SIZE.terminal;

/** A canvas on screen: Excalidraw's API over a plain array, its updates kept. */
function fakeCanvas(initial: ExcalidrawElement[]) {
  let elements = initial;
  let appState: Record<string, unknown> = { selectedElementsAreBeingDragged: false, isResizing: false, isRotating: false, activeEmbeddable: null };
  const updates: { elements?: readonly ExcalidrawElement[]; appState?: Record<string, unknown>; captureUpdate?: string }[] = [];
  const api = {
    getSceneElementsIncludingDeleted: () => elements,
    getSceneElements: () => elements.filter((e) => !e.isDeleted),
    getAppState: () => appState,
    updateScene: (update: (typeof updates)[number]) => {
      updates.push(update);
      if (update.elements) elements = [...update.elements];
      if (update.appState) appState = { ...appState, ...update.appState };
    },
  };
  canvasStore.setState({ api: api as unknown as ExcalidrawImperativeAPI });
  return {
    updates,
    elements: () => elements,
    set: (next: ExcalidrawElement[]) => (elements = next),
    setAppState: (fields: Record<string, unknown>) => (appState = { ...appState, ...fields }),
  };
}

function terminal(id: string, x = 0, y = 0): ExcalidrawElement {
  return { ...createNodeElement("terminal", { x: 0, y: 0 }), id, x, y } as ExcalidrawElement;
}

function noteBeside(id: string, host: ExcalidrawElement, x: number, y: number, fields: Partial<ExcalidrawElement> = {}): ExcalidrawElement {
  const note = { ...createNodeElement("note", { x: 0, y: 0 }), id, x, y, ...fields } as ExcalidrawElement;
  return { ...note, customData: withNoteLink(note.customData, linkFor(host.id, note, host)) } as ExcalidrawElement;
}

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
const claude = { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" } as const;

beforeEach(async () => {
  mockIPC(() => undefined);
  workspacesStore.setState({ activeId: "w1" });
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { ...claude } });
});

afterEach(() => {
  vi.clearAllMocks();
  clearMocks();
  canvasStore.setState({ api: null });
  document.body.innerHTML = "";
});

describe("addNote", () => {
  it("puts an empty note right of its terminal, in one undo step, saved, and in view", async () => {
    const canvas = fakeCanvas([terminal("batman", 100, 50)]);
    const id = (await addNote("batman"))!;
    const note = canvas.elements().find((e) => e.id === id)!;
    expect(nodesStore.getState().nodes[id]).toEqual({ workspaceId: "w1", kind: "note", payload: { text: "" } });
    expect({ x: note.x, y: note.y, link: note.link }).toEqual({ x: 100 + W + NOTE_GAP, y: 50, link: `dummyplane://note/${id}` });
    expect(noteLinkOf(note)).toEqual({ of: "batman", x: "right", dx: NOTE_GAP, y: "top", dy: 0 });
    expect(last(canvas.updates)?.captureUpdate).toBe("IMMEDIATELY");
    expect(revealNode).toHaveBeenCalledWith(id);
  });

  it("stacks a second note under the first", async () => {
    const canvas = fakeCanvas([terminal("batman")]);
    const first = (await addNote("batman"))!;
    const second = (await addNote("batman"))!;
    const at = (id: string) => canvas.elements().find((e) => e.id === id)!;
    expect(at(second).x).toBe(at(first).x);
    expect(at(second).y).toBe(at(first).y + NODE_SIZE.note.height + NOTE_GAP);
  });

  it("gives the note's text the keyboard once it mounts, the note activated", async () => {
    const canvas = fakeCanvas([terminal("batman")]);
    const id = (await addNote("batman"))!;
    await frame();
    // Mounted a few frames later, as Excalidraw shows it.
    const card = document.createElement("div");
    card.dataset.note = id;
    const field = document.createElement("textarea");
    card.append(field);
    document.body.append(card);
    await frame();
    await frame();
    expect(document.activeElement).toBe(field);
    expect(last(canvas.updates)?.appState?.activeEmbeddable).toMatchObject({ element: { id }, state: "active" });
  });

  it("beside an agent with sub-agents, takes its place right of it and lays the tree out again around it", async () => {
    await nodesStore.getState().create("robin", { workspaceId: "w1", kind: "terminal", payload: { ...claude, name: "Robin", spawnedBy: "batman" } });
    const canvas = fakeCanvas([terminal("batman"), terminal("robin", W + 96, 0)]);
    const id = (await addNote("batman"))!;
    const at = (nodeId: string) => canvas.elements().find((e) => e.id === nodeId)!;
    expect({ x: at(id).x, y: at(id).y }).toEqual({ x: W + NOTE_GAP, y: 0 });
    // The sub-agent's column moved past the note.
    expect(at("robin").x).toBeGreaterThanOrEqual(at(id).x + NODE_SIZE.note.width);
    expect(at("robin").y).toBe(0);
  });

  it("adds nothing beside a node that cannot have notes, or a terminal not on the canvas", async () => {
    await nodesStore.getState().create("board", { workspaceId: "w1", kind: "kanban", payload: { columns: [], cards: {} } });
    fakeCanvas([]);
    expect(await addNote("board")).toBeNull();
    expect(await addNote("batman")).toBeNull();
  });
});

it("focusNote keeps offering the keyboard while something else takes it back (a menu's focus trap)", async () => {
  fakeCanvas([{ ...createNodeElement("note", { x: 0, y: 0 }), id: "n1" } as ExcalidrawElement]);
  const card = document.createElement("div");
  card.dataset.note = "n1";
  const field = document.createElement("textarea");
  card.append(field);
  const trap = document.createElement("button");
  document.body.append(card, trap);
  let steals = 2;
  field.addEventListener("focus", () => {
    if (steals-- > 0) trap.focus();
  });
  focusNote("n1");
  for (let i = 0; i < 4; i++) await frame();
  expect(document.activeElement).toBe(field);
});

describe("deleting, and closing a terminal", () => {
  it("deletes a note in one undo step, its removal allowed", () => {
    const host = terminal("batman");
    const canvas = fakeCanvas([host, noteBeside("n1", host, W + NOTE_GAP, 0)]);
    deleteNote("n1");
    expect(canvas.elements().find((e) => e.id === "n1")?.isDeleted).toBe(true);
    expect(last(canvas.updates)?.captureUpdate).toBe("IMMEDIATELY");
  });

  it("offers a deleted note with text back: Undo puts it where it was", async () => {
    const host = terminal("batman");
    await nodesStore.getState().create("n1", { workspaceId: "w1", kind: "note", payload: { text: "ask about the schema" } });
    await nodesStore.getState().create("n2", { workspaceId: "w1", kind: "note", payload: { text: "" } });
    const canvas = fakeCanvas([host, noteBeside("n1", host, W + NOTE_GAP, 0, { isDeleted: true }), noteBeside("n2", host, W + NOTE_GAP, 216, { isDeleted: true })]);
    onNodesGone("w1", ["n1", "n2"]);
    // The empty one goes without a word.
    expect(toast).toHaveBeenCalledOnce();
    const [text, options] = vi.mocked(toast).mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect([text, options.action.label]).toEqual(["Note deleted", "Undo"]);
    options.action.onClick();
    expect(canvas.elements().find((e) => e.id === "n1")).toMatchObject({ isDeleted: false, x: W + NOTE_GAP, y: 0 });
    expect(canvas.elements().find((e) => e.id === "n2")?.isDeleted).toBe(true);
  });

  it("takes a closed terminal's empty notes with it and keeps the written ones, alone", async () => {
    const host = terminal("batman");
    await nodesStore.getState().create("n1", { workspaceId: "w1", kind: "note", payload: { text: "" } });
    await nodesStore.getState().create("n2", { workspaceId: "w1", kind: "note", payload: { text: "keep me" } });
    const canvas = fakeCanvas([{ ...host, isDeleted: true }, noteBeside("n1", host, W + NOTE_GAP, 0), noteBeside("n2", host, W + NOTE_GAP, 216)]);
    onNodesGone("w1", ["batman"]);
    expect(toast).not.toHaveBeenCalled();
    await frame();
    const byId = (id: string) => canvas.elements().find((e) => e.id === id)!;
    expect([byId("n1").isDeleted, byId("n2").isDeleted]).toEqual([true, false]);
    // Out of the undo history: an undo of the close brings the terminal back, beside its written note.
    expect(last(canvas.updates)?.captureUpdate).toBe("NEVER");
    expect(noteLinkOf(byId("n2"))?.of).toBe("batman");
  });

  it("keeps the empty notes of a terminal an undo brought back meanwhile", async () => {
    const host = terminal("batman");
    await nodesStore.getState().create("n1", { workspaceId: "w1", kind: "note", payload: { text: "" } });
    const canvas = fakeCanvas([{ ...host, isDeleted: true }, noteBeside("n1", host, W + NOTE_GAP, 0)]);
    onNodesGone("w1", ["batman"]);
    canvas.set([host, ...canvas.elements().slice(1)]);
    await frame();
    expect(canvas.updates).toEqual([]);
  });
});

describe("the follow watch", () => {
  it("takes the notes along once the terminal's drag ends, outside the undo history", async () => {
    const host = terminal("batman");
    const note = noteBeside("n1", host, W + NOTE_GAP, 0);
    const canvas = fakeCanvas([host, note]);
    const watch = createNoteWatch();
    const idle = { selectedElementsAreBeingDragged: false, isResizing: false, isRotating: false };
    watch(canvas.elements(), idle, 1);
    // Dragged: nothing moves under the pointer.
    canvas.set([{ ...host, x: 300, y: 100, version: 2 }, note]);
    watch(canvas.elements(), { ...idle, selectedElementsAreBeingDragged: true }, 2);
    await frame();
    expect(canvas.updates).toEqual([]);
    // Dropped: the note joins it.
    watch(canvas.elements(), idle, 2);
    await frame();
    expect(canvas.elements().find((e) => e.id === "n1")).toMatchObject({ x: 300 + W + NOTE_GAP, y: 100 });
    expect(last(canvas.updates)?.captureUpdate).toBe("NEVER");
  });

  it("keeps a note where the user dropped it, and follows the terminal from there", async () => {
    const host = terminal("batman");
    const note = noteBeside("n1", host, W + NOTE_GAP, 0);
    const canvas = fakeCanvas([host, note]);
    const watch = createNoteWatch();
    const idle = { selectedElementsAreBeingDragged: false, isResizing: false, isRotating: false };
    watch(canvas.elements(), idle, 1);
    canvas.set([host, { ...note, x: W + 100, y: 300, version: 2 }]);
    watch(canvas.elements(), idle, 2);
    await frame();
    expect(noteLinkOf(canvas.elements()[1])).toEqual({ of: "batman", x: "right", dx: 100, y: "top", dy: 300 });
    canvas.set([{ ...canvas.elements()[0], x: 1000, version: 3 }, canvas.elements()[1]]);
    watch(canvas.elements(), idle, 4);
    await frame();
    expect(canvas.elements()[1]).toMatchObject({ x: 1000 + W + 100, y: 300 });
  });

  it("keeps a note being typed in active as it moves", async () => {
    const host = terminal("batman");
    const note = noteBeside("n1", host, W + NOTE_GAP, 0);
    const canvas = fakeCanvas([host, note]);
    canvas.setAppState({ activeEmbeddable: { element: note, state: "active" } });
    const watch = createNoteWatch();
    const idle = { selectedElementsAreBeingDragged: false, isResizing: false, isRotating: false };
    watch(canvas.elements(), idle, 1);
    canvas.set([{ ...host, x: 50, version: 2 }, note]);
    watch(canvas.elements(), idle, 2);
    await frame();
    const moved = canvas.elements()[1];
    expect(last(canvas.updates)?.appState?.activeEmbeddable).toEqual({ element: moved, state: "active" });
  });
});
