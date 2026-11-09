// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { canvasStore, EMPTY_VIEW } from "./canvasStore";
import { SelectionPanel } from "./SelectionPanel";

const { mutateElement } = vi.hoisted(() => ({ mutateElement: vi.fn() }));
vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "immediately" }, mutateElement }));
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
  // A change to a node is saved a moment later; the save has nowhere to go in a test.
  mockIPC(() => undefined);
  mutateElement.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  canvasStore.setState({ api: null, drawnSelection: [], view: EMPTY_VIEW });
  nodesStore.setState({ nodes: {} });
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
  expect(host.querySelectorAll(".dp-label")).toHaveLength(2);
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

// The sloppiness and arrow type of a connection stroke.
const stroke = (id: string, type: "arrow" | "line", extra: Record<string, unknown> = {}) =>
  ({
    ...box(id, type),
    roughness: 1,
    roundness: null,
    elbowed: false,
    points: [
      [0, 0],
      [100, 40],
    ],
    startBinding: null,
    endBinding: null,
    ...extra,
  }) as unknown as ExcalidrawElement;

const group = (label: string) => host.querySelector(`[role="group"][aria-label="${label}"]`);
const choice = (label: string, text: string) =>
  [...(group(label)?.querySelectorAll("button") ?? [])].find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const apiOf = (scene: ExcalidrawElement[], selected: Record<string, true>) => {
  const updateScene = vi.fn();
  const api = { updateScene, getSceneElementsIncludingDeleted: () => scene, getAppState: () => ({ selectedElementIds: selected }) };
  return { updateScene, api: api as unknown as Partial<ExcalidrawImperativeAPI> };
};

it("offers no sloppiness or arrow type for a plain shape", async () => {
  await mount({}, [box("a")]);
  expect(group("Sloppiness")).toBeNull();
  expect(group("Arrow type")).toBeNull();
});

it("offers sloppiness for a line, and the arrow type too for an arrow", async () => {
  await mount({}, [stroke("l", "line")]);
  expect(group("Sloppiness")?.querySelectorAll("button")).toHaveLength(3);
  expect(group("Arrow type")).toBeNull();
  await mount({}, [stroke("r", "arrow")]);
  expect(group("Arrow type")?.querySelectorAll("button")).toHaveLength(3);
  expect(choice("Sloppiness", "Sketchy")?.getAttribute("aria-pressed")).toBe("true");
  expect(choice("Arrow type", "Sharp")?.getAttribute("aria-pressed")).toBe("true");
});

it("sets the sloppiness of the selected connection strokes only", async () => {
  const scene = [stroke("a", "arrow"), box("b")];
  const { updateScene, api } = apiOf(scene, { a: true, b: true });
  await mount(api, scene);
  await act(async () => choice("Sloppiness", "Clean")!.click());
  const [{ elements, captureUpdate }] = updateScene.mock.calls[0];
  expect(captureUpdate).toBe("immediately");
  expect(elements[0].roughness).toBe(0);
  expect(elements[1]).toBe(scene[1]);
});

it("makes an arrow elbowed in one undoable update, then has Excalidraw route it", async () => {
  const scene = [
    stroke("a", "arrow", {
      points: [
        [0, 0],
        [50, 10],
        [100, 40],
      ],
    }),
  ];
  const { updateScene, api } = apiOf(scene, { a: true });
  await mount(api, scene);
  await act(async () => choice("Arrow type", "Elbow")!.click());
  const [{ elements }] = updateScene.mock.calls[0];
  expect(elements[0]).toMatchObject({
    elbowed: true,
    roundness: null,
    points: [
      [0, 0],
      [100, 40],
    ],
  });
  expect(mutateElement).toHaveBeenCalledWith(scene[0], {});
});

it("does not route anything for the other arrow types", async () => {
  const scene = [stroke("a", "arrow")];
  const { updateScene, api } = apiOf(scene, { a: true });
  await mount(api, scene);
  await act(async () => choice("Arrow type", "Round")!.click());
  expect(updateScene.mock.calls[0][0].elements[0]).toMatchObject({ elbowed: false, roundness: { type: 2 } });
  expect(mutateElement).not.toHaveBeenCalled();
});

// The Edit section of a terminal selected alone.
const terminal = (overrides: Partial<TerminalPayload> = {}): TerminalPayload => ({
  title: "Isis · api",
  name: "Isis",
  agent: "claude",
  cwd: "D:/work/api",
  shell: "default",
  command: "",
  ...overrides,
});

function mountTerminal(payload: TerminalPayload, selectedIds = ["t1"], mode: "reading" | null = null) {
  nodesStore.setState({
    nodes: {
      t1: { workspaceId: "w", kind: "terminal", payload },
      t2: { workspaceId: "w", kind: "terminal", payload: terminal({ name: "Thoth" }) },
      o1: { workspaceId: "w", kind: "orchestrator", payload: { name: "Orchestrator" } },
    },
  });
  canvasStore.setState({ drawnSelection: [], view: { ...EMPTY_VIEW, mode, selectedIds } });
  return act(async () => root.render(<SelectionPanel />));
}

const field = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const payloadOf = () => (nodesStore.getState().nodes.t1 as { payload: TerminalPayload }).payload;

/** Types into a field and leaves it, as a user does. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus();
    input.value = value;
    input.blur();
  });
}

it("shows a short Edit section for a terminal selected alone, with no colours and no Duplicate or Delete", async () => {
  await mountTerminal(terminal());
  expect(host.querySelector("section[aria-label='Edit']")).not.toBeNull();
  expect(host.textContent).toContain("Edit Isis");
  expect(field("Name")!.value).toBe("Isis");
  expect(field("Folder")!.value).toBe("D:/work/api");
  expect(field("Command")).toBeNull();
  expect(host.querySelector("button[aria-label='Browse']")).not.toBeNull();
  expect(host.querySelector("button[aria-label^='Stroke: ']")).toBeNull();
  expect(button("Duplicate")).toBeNull();
  expect(button("Delete")).toBeNull();
});

it("stays hidden for several selected terminals, an orchestrator, and in reading mode", async () => {
  await mountTerminal(terminal(), ["t1", "t2"]);
  expect(host.innerHTML).toBe("");
  await mountTerminal(terminal(), ["o1"]);
  expect(host.innerHTML).toBe("");
  await mountTerminal(terminal(), ["t1"], "reading");
  expect(host.innerHTML).toBe("");
});

it("renames the terminal when the Name field is left, and ignores an empty name", async () => {
  await mountTerminal(terminal());
  await typeInto(field("Name")!, "  Horus ");
  expect(payloadOf().name).toBe("Horus");
  await typeInto(field("Name")!, "   ");
  expect(payloadOf().name).toBe("Horus");
});

it("keeps the stored value when Escape ends the edit", async () => {
  await mountTerminal(terminal());
  const name = field("Name")!;
  await act(async () => {
    name.focus();
    name.value = "Seth";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(payloadOf().name).toBe("Isis");
  expect(name.value).toBe("Isis");
});

it("changes the folder, kept for the next launch", async () => {
  await mountTerminal(terminal());
  await typeInto(field("Folder")!, "D:/work/web");
  expect(payloadOf().cwd).toBe("D:/work/web");
  expect(host.textContent).toContain("Folder and command apply at the next launch.");
});

it("edits the command of a custom agent only", async () => {
  await mountTerminal(terminal({ agent: "custom", command: "npm run dev" }));
  expect(field("Command")!.value).toBe("npm run dev");
  await typeInto(field("Command")!, "npm test");
  expect(payloadOf().command).toBe("npm test");
});

it("lets a model a mission chose go back to the default", async () => {
  await mountTerminal(terminal({ model: "claude-haiku-5-5" }));
  expect(host.textContent).toContain("Model");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Default")!.click());
  expect(payloadOf().model).toBeUndefined();
});
