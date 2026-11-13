import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { createNodeElement, nodeKindOf } from "./nodeElement";
import { createSceneSync, liveNodeIds, liveNodeRects } from "./sceneSync";

// Listing the nodes reads each element's kind: the count of that work.
vi.mock("./nodeElement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nodeElement")>();
  return { ...actual, nodeKindOf: vi.fn(actual.nodeKindOf) };
});

const appState = (zoom = 1) => ({ scrollX: 0, scrollY: 0, zoom: { value: zoom } }) as unknown as AppState;
const noFiles = {} as BinaryFiles;

function setup(initial: readonly ExcalidrawElement[] = []) {
  const deps = {
    saveScene: vi.fn(() => Promise.resolve()),
    saveFiles: vi.fn(() => Promise.resolve()),
    onSceneChanged: vi.fn(),
    onNodesAdded: vi.fn(),
    onNodesRemoved: vi.fn(),
  };
  return { deps, sync: createSceneSync({ elements: initial, savedFileIds: ["known"] }, deps) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("saves the scene 500 ms after the last change, with only live elements and node ids", () => {
  const keep = createNodeElement("terminal", { x: 0, y: 0 });
  const gone = { ...createNodeElement("terminal", { x: 0, y: 0 }), isDeleted: true };
  const { deps, sync } = setup();
  sync.onChange([keep, gone], appState(), noFiles, 1);
  sync.onChange([keep, gone], appState(), noFiles, 2);
  vi.advanceTimersByTime(499);
  expect(deps.saveScene).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(deps.saveScene).toHaveBeenCalledTimes(1);
  const [elementsJson, appStateJson, nodeIds] = deps.saveScene.mock.calls[0] as unknown as [string, string, string[]];
  expect(JSON.parse(elementsJson).map((e: ExcalidrawElement) => e.id)).toEqual([keep.id]);
  expect(JSON.parse(appStateJson)).toEqual({ scrollX: 0, scrollY: 0, zoom: { value: 1 } });
  expect(nodeIds).toEqual([keep.id]);
});

it("ignores pointer moves (same version, same viewport)", () => {
  const { deps, sync } = setup();
  sync.onChange([], appState(), noFiles, 1);
  vi.advanceTimersByTime(500);
  sync.onChange([], appState(), noFiles, 1);
  vi.advanceTimersByTime(500);
  expect(deps.saveScene).toHaveBeenCalledTimes(1);
  expect(deps.onSceneChanged).toHaveBeenCalledTimes(1);
});

it("flush writes the pending save immediately", () => {
  const { deps, sync } = setup();
  sync.onChange([], appState(2), noFiles, 1);
  sync.flush();
  expect(deps.saveScene).toHaveBeenCalledTimes(1);
});

describe("a save that fails", () => {
  const failure = new Error("database is locked");
  const failing = () => {
    const saveFailed = vi.fn();
    const deps = {
      saveScene: vi.fn(() => Promise.reject(failure)),
      saveFiles: vi.fn(() => Promise.resolve()),
      onSceneChanged: vi.fn(),
      onNodesAdded: vi.fn(),
      onNodesRemoved: vi.fn(),
      saveFailed,
    };
    return { saveFailed, sync: createSceneSync({ elements: [], savedFileIds: [] }, deps) };
  };

  it("is told when it was the timed one, which nobody waits for: the canvas is not lost unknowingly", async () => {
    const { saveFailed, sync } = failing();
    sync.onChange([], appState(), noFiles, 1);
    await vi.advanceTimersByTimeAsync(500);
    expect(saveFailed).toHaveBeenCalledTimes(1);
    expect(saveFailed).toHaveBeenCalledWith(failure);
  });

  it("is told once when a flush wrote it, and the flush itself still ends", async () => {
    const { saveFailed, sync } = failing();
    sync.onChange([], appState(), noFiles, 1);
    await expect(sync.flush()).resolves.toBeUndefined();
    expect(saveFailed).toHaveBeenCalledTimes(1);
  });
});

it("reports nodes that appear and disappear, but not the ones it started with", () => {
  const first = createNodeElement("terminal", { x: 0, y: 0 });
  const second = createNodeElement("terminal", { x: 0, y: 0 });
  const { deps, sync } = setup([first]);
  sync.onChange([first, second], appState(), noFiles, 1);
  expect(deps.onNodesAdded).toHaveBeenCalledWith([second.id]);
  sync.onChange([{ ...first, isDeleted: true }, second], appState(), noFiles, 2);
  expect(deps.onNodesRemoved).toHaveBeenCalledWith([first.id]);
  sync.onChange([first, second], appState(), noFiles, 3); // undo
  expect(deps.onNodesAdded).toHaveBeenLastCalledWith([first.id]);
});

it("saves each new image once, as a data URL", () => {
  const { deps, sync } = setup();
  const files = {
    known: { id: "known", mimeType: "image/png", dataURL: "data:old", created: 1 },
    fresh: { id: "fresh", mimeType: "image/svg+xml", dataURL: "data:new", created: 2 },
  } as unknown as BinaryFiles;
  sync.onChange([], appState(), files, 1);
  sync.onChange([], appState(), files, 2);
  expect(deps.saveFiles).toHaveBeenCalledTimes(1);
  expect(deps.saveFiles).toHaveBeenCalledWith([
    { id: "fresh", mimeType: "image/svg+xml", dataUrl: "data:new", created: 2 },
  ]);
});

describe("an image that cannot be saved", () => {
  const failure = new Error("payload too large");
  const files = { fresh: { id: "fresh", mimeType: "image/png", dataURL: "data:new", created: 2 } } as unknown as BinaryFiles;
  const failing = () => {
    const imagesNotSaved = vi.fn();
    const deps = {
      saveScene: vi.fn(() => Promise.resolve()),
      saveFiles: vi.fn(() => Promise.reject(failure)),
      onSceneChanged: vi.fn(),
      onNodesAdded: vi.fn(),
      onNodesRemoved: vi.fn(),
      imagesNotSaved,
    };
    return { deps, imagesNotSaved, sync: createSceneSync({ elements: [], savedFileIds: [] }, deps) };
  };

  it("is told, not only written to the console", async () => {
    const { imagesNotSaved, sync } = failing();
    sync.onChange([], appState(), files, 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(imagesNotSaved).toHaveBeenCalledTimes(1);
    expect(imagesNotSaved).toHaveBeenCalledWith(failure);
  });

  it("is tried again at the next change, as before, and told only once while it keeps failing", async () => {
    const { deps, imagesNotSaved, sync } = failing();
    sync.onChange([], appState(), files, 1);
    await vi.advanceTimersByTimeAsync(0);
    sync.onChange([], appState(), files, 2);
    await vi.advanceTimersByTimeAsync(0);
    sync.onChange([], appState(), files, 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.saveFiles).toHaveBeenCalledTimes(3);
    expect(imagesNotSaved).toHaveBeenCalledTimes(1);
  });

  it("is told again once an image was saved and a later one fails", async () => {
    const { deps, imagesNotSaved, sync } = failing();
    const later = { later: { id: "later", mimeType: "image/png", dataURL: "data:later", created: 3 } } as unknown as BinaryFiles;
    sync.onChange([], appState(), files, 1);
    await vi.advanceTimersByTimeAsync(0);
    deps.saveFiles.mockImplementationOnce(() => Promise.resolve() as never);
    sync.onChange([], appState(), files, 2);
    await vi.advanceTimersByTimeAsync(0);
    deps.saveFiles.mockImplementation(() => Promise.reject(failure));
    sync.onChange([], appState(), later, 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(imagesNotSaved).toHaveBeenCalledTimes(2);
  });
});

it("liveNodeIds skips deleted nodes and plain drawings", () => {
  const node = createNodeElement("note", { x: 0, y: 0 });
  const drawing = { ...createNodeElement("note", { x: 0, y: 0 }), type: "rectangle" } as unknown as ExcalidrawElement;
  expect(liveNodeIds([node, drawing, { ...node, id: "x", isDeleted: true }])).toEqual([node.id]);
});

it("liveNodeRects gives the scene rectangle of each live node, the frieze's anchor", () => {
  const node = createNodeElement("terminal", { x: 0, y: 0 });
  const drawing = { ...node, id: "d", type: "rectangle" } as unknown as ExcalidrawElement;
  expect(liveNodeRects([node, drawing, { ...node, id: "x", isDeleted: true }])).toEqual({
    [node.id]: { x: node.x, y: node.y, width: node.width, height: node.height },
  });
});

it("lists the nodes of a scene once while only the view moves, and saves that view all the same: a pan's frames", () => {
  const keep = createNodeElement("terminal", { x: 0, y: 0 });
  const elements = [keep, { id: "r", type: "rectangle", version: 1, isDeleted: false } as unknown as ExcalidrawElement];
  const { deps, sync } = setup();
  sync.onChange(elements, appState(), noFiles, 2);
  expect(deps.onNodesAdded).toHaveBeenCalledWith([keep.id]);
  const listed = vi.mocked(nodeKindOf).mock.calls.length;
  expect(listed).toBeGreaterThan(0);
  // A pan: the same array and version, the view moving frame after frame.
  for (let frame = 1; frame <= 60; frame++) sync.onChange(elements, { ...appState(), scrollX: -frame * 10 } as AppState, noFiles, 2);
  expect(vi.mocked(nodeKindOf).mock.calls.length).toBe(listed);
  vi.advanceTimersByTime(500);
  expect(deps.saveScene).toHaveBeenCalledTimes(1);
  const [, appStateJson, nodeIds] = deps.saveScene.mock.calls[0] as unknown as [string, string, string[]];
  expect(JSON.parse(appStateJson).scrollX).toBe(-600);
  expect(nodeIds).toEqual([keep.id]);
  expect(deps.onNodesAdded).toHaveBeenCalledTimes(1);
});

it("lists them again when the scene changes: a node added, and one closed in place", () => {
  const keep = createNodeElement("terminal", { x: 0, y: 0 });
  const { deps, sync } = setup();
  const elements = [keep];
  sync.onChange(elements, appState(), noFiles, 1);
  const added = createNodeElement("fleet", { x: 900, y: 0 });
  const more = [keep, added];
  sync.onChange(more, appState(), noFiles, 2);
  expect(deps.onNodesAdded).toHaveBeenLastCalledWith([added.id]);
  // Closed in place: the same array, the element deleted and its version bumped.
  Object.assign(more[1], { isDeleted: true, version: added.version + 1 });
  sync.onChange(more, appState(), noFiles, 3);
  expect(deps.onNodesRemoved).toHaveBeenCalledWith([added.id]);
});
