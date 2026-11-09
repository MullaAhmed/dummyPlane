// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore, EMPTY_VIEW } from "./canvasStore";
import { SelectionPanel } from "./SelectionPanel";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "immediately" } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const box = (id: string, type = "rectangle") =>
  ({
    id,
    type,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: "#29261B",
    backgroundColor: "transparent",
    groupIds: [],
    frameId: null,
    boundElements: null,
    version: 1,
    versionNonce: 1,
    updated: 1,
    index: "a0",
    isDeleted: false,
  }) as unknown as ExcalidrawElement;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  canvasStore.setState({ api: null, drawnSelection: [], view: EMPTY_VIEW });
});

function mount(api: Partial<ExcalidrawImperativeAPI>, elements: ExcalidrawElement[], mode: "reading" | null = null) {
  canvasStore.setState({ api: api as ExcalidrawImperativeAPI, drawnSelection: elements, view: { ...EMPTY_VIEW, mode } });
  return act(async () => root.render(<SelectionPanel />));
}

const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

it("stays hidden when nothing drawn is selected", async () => {
  await mount({}, []);
  expect(host.innerHTML).toBe("");
});

it("stays hidden in reading mode, where nothing can change", async () => {
  await mount({}, [box("a")], "reading");
  expect(host.innerHTML).toBe("");
});

it("shows only the stroke and background colours and the Duplicate and Delete actions", async () => {
  await mount({}, [box("a")]);
  expect(host.querySelectorAll(".ov-label")).toHaveLength(2);
  expect(host.querySelector("button[aria-label='Stroke: Ink']")).not.toBeNull();
  expect(host.querySelector("button[aria-label='Background: Transparent']")).not.toBeNull();
  expect(host.querySelectorAll("button[aria-label^='Stroke: ']")).toHaveLength(8);
  expect(host.querySelectorAll("button[aria-label^='Background: ']")).toHaveLength(9);
  expect(host.textContent).toContain("Duplicate");
  expect(host.textContent).toContain("Delete");
});

it("restyles the selected drawn elements' stroke colour in one undoable update", async () => {
  const updateScene = vi.fn();
  const scene = [box("a"), box("b")];
  await mount({ updateScene, getSceneElementsIncludingDeleted: () => scene, getAppState: () => ({ selectedElementIds: { a: true } }) } as unknown as Partial<ExcalidrawImperativeAPI>, [scene[0]]);
  await act(async () => button("Stroke: Red")!.click());
  expect(updateScene).toHaveBeenCalledTimes(1);
  const [{ elements, captureUpdate }] = updateScene.mock.calls[0];
  expect(captureUpdate).toBe("immediately");
  expect(elements[0].strokeColor).toBe("#C93C37");
  expect(elements[1]).toBe(scene[1]);
});

it("sets the background colour, transparent included", async () => {
  const updateScene = vi.fn();
  const scene = [box("a")];
  await mount({ updateScene, getSceneElementsIncludingDeleted: () => scene, getAppState: () => ({ selectedElementIds: { a: true } }) } as unknown as Partial<ExcalidrawImperativeAPI>, scene);
  await act(async () => button("Background: Transparent")!.click());
  expect(updateScene.mock.calls[0][0].elements[0].backgroundColor).toBe("transparent");
});

it("duplicates the selection and selects the copy", async () => {
  const updateScene = vi.fn();
  const scene = [box("a")];
  await mount({ updateScene, getSceneElementsIncludingDeleted: () => scene, getAppState: () => ({ selectedElementIds: { a: true } }) } as unknown as Partial<ExcalidrawImperativeAPI>, scene);
  await act(async () => button("Duplicate")!.click());
  const [{ elements, appState }] = updateScene.mock.calls[0];
  expect(elements).toHaveLength(2);
  expect(Object.keys(appState.selectedElementIds)).toEqual([elements[1].id]);
});

it("deletes the selected drawn elements and clears the selection", async () => {
  const updateScene = vi.fn();
  const scene = [box("a")];
  await mount({ updateScene, getSceneElementsIncludingDeleted: () => scene, getAppState: () => ({ selectedElementIds: { a: true } }) } as unknown as Partial<ExcalidrawImperativeAPI>, scene);
  await act(async () => button("Delete")!.click());
  const [{ elements, appState }] = updateScene.mock.calls[0];
  expect(elements[0].isDeleted).toBe(true);
  expect(appState).toEqual({ selectedElementIds: {}, selectedGroupIds: {} });
});

it("keeps the keyboard on the canvas when a button is pressed", async () => {
  await mount({}, [box("a")]);
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    button("Stroke: Ink")!.dispatchEvent(down);
  });
  expect(down.defaultPrevented).toBe(true);
});
