// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { cachedElements, editStoredScene, forgetScene, rememberScene } from "@/canvas/sceneCache";
import { liveNodeIds } from "@/canvas/sceneSync";
import { createNodeElement, fromStoredKind, isDummyPlaneLink, NODE_SIZE } from "@/canvas/nodeElement";
import { MAX_NOTE_TEXT, readNotePayload } from "@/nodes/types";
import { createNodesStore } from "@/store/nodes";
import { linkFor, NOTE_GAP, withNoteLink } from "./link";

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

/** A note survives a reload: its text in its node's row, its place and its host in the scene. */

afterEach(() => clearMocks());

function terminal(id: string, x = 0, y = 0): ExcalidrawElement {
  return { ...createNodeElement("terminal", { x: 0, y: 0 }), id, x, y } as ExcalidrawElement;
}

function noteBeside(id: string, host: ExcalidrawElement, x: number, y: number): ExcalidrawElement {
  const note = { ...createNodeElement("note", { x: 0, y: 0 }), id, x, y } as ExcalidrawElement;
  return { ...note, customData: withNoteLink(note.customData, linkFor(host.id, note, host)) } as ExcalidrawElement;
}

describe("its row", () => {
  it("reads its text back, and an unreadable payload as an empty note", () => {
    expect(readNotePayload({ text: "ask about the schema" })).toEqual({ text: "ask about the schema" });
    expect(readNotePayload({ text: 3 })).toEqual({ text: "" });
    expect(readNotePayload(null)).toEqual({ text: "" });
    expect(readNotePayload({ text: "x".repeat(MAX_NOTE_TEXT + 10) }).text).toHaveLength(MAX_NOTE_TEXT);
  });

  it("is saved under the kind the database already accepts, and read back on load", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "save_node") saved.push(args);
    });
    const { store, flushPending } = createNodesStore();
    await store.getState().create("n1", { workspaceId: "w1", kind: "note", payload: { text: "" } });
    store.getState().update("n1", { text: "first line" });
    await flushPending();
    expect(last(saved)).toEqual({ id: "n1", workspaceId: "w1", kind: "note", payloadJson: JSON.stringify({ text: "first line" }) });
    const reloaded = createNodesStore().store;
    reloaded.getState().hydrate("w1", [{ id: "n1", kind: "note", payloadJson: JSON.stringify({ text: "first line" }) } as never]);
    expect(reloaded.getState().nodes.n1).toEqual({ workspaceId: "w1", kind: "note", payload: { text: "first line" } });
    expect(fromStoredKind("note")).toBe("note");
    expect(isDummyPlaneLink(createNodeElement("note", { x: 0, y: 0 }).link!)).toBe(true);
  });
});

describe("its element", () => {
  it("counts as a node of the scene: the scene's save keeps its row", () => {
    const host = terminal("batman");
    expect(liveNodeIds([host, noteBeside("n1", host, NODE_SIZE.terminal.width + NOTE_GAP, 0)])).toEqual(["batman", "n1"]);
  });

  it("follows its terminal in a scene off screen, laid out or minimized by a mission", () => {
    mockIPC(() => undefined);
    const host = terminal("batman");
    const note = noteBeside("n1", host, NODE_SIZE.terminal.width + NOTE_GAP, 0);
    rememberScene("w2", [host, note], { scrollX: 0, scrollY: 0, zoom: { value: 1 } } as never, {}, []);
    editStoredScene("w2", [{ ...host, x: 400, y: 200, version: 2 } as ExcalidrawElement, note]);
    expect(cachedElements("w2")?.find((e) => e.id === "n1")).toMatchObject({ x: 400 + NODE_SIZE.terminal.width + NOTE_GAP, y: 200 });
    forgetScene("w2");
  });
});
