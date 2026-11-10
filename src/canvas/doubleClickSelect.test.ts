// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "./canvasStore";
import { installDoubleClickSelect } from "./doubleClickSelect";
import { eraserGuard } from "./eraserGuard";
import { createNodeElement } from "./nodeElement";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never" },
  newElementWith: (e: object, patch: object) => ({ ...e, ...patch }),
}));

// A terminal centered on (360, 220) spans x 0..720, y 0..440; the Fleet centered on (1320, 380), x 1000..1640, y 0..760.
const terminal = () => createNodeElement("terminal", { x: 360, y: 220 });
const fleet = () => createNodeElement("fleet", { x: 1320, y: 380 });
/** What a click of a drawing tool leaves: a dot (a freedraw of two points on one spot). */
const dot = (id: string, x: number, y: number) =>
  ({ ...createNodeElement("terminal", { x, y }), id, type: "freedraw", width: 0.1, height: 0.1, customData: undefined }) as unknown as ExcalidrawElement;

interface Fake {
  api: ExcalidrawImperativeAPI;
  state: Record<string, unknown>;
  updateScene: ReturnType<typeof vi.fn>;
  setActiveTool: ReturnType<typeof vi.fn>;
  elements: () => ExcalidrawElement[];
  draw: (element: ExcalidrawElement) => void;
  /** Excalidraw changing the scene by itself. */
  replace: (next: ExcalidrawElement[]) => void;
}

/** An Excalidraw whose scene and app state are plain objects the calls merge into. */
function fakeApi(initial: ExcalidrawElement[], tool = "selection", extra: Record<string, unknown> = {}): Fake {
  let elements = initial;
  const state: Record<string, unknown> = {
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 },
    offsetLeft: 0,
    offsetTop: 0,
    width: 1600,
    height: 900,
    activeTool: { type: tool },
    selectedElementIds: {},
    selectedGroupIds: {},
    activeEmbeddable: null,
    editingFrame: null,
    viewModeEnabled: false,
    zenModeEnabled: false,
    ...extra,
  };
  const updateScene = vi.fn((data: { elements?: ExcalidrawElement[]; appState?: Record<string, unknown> }) => {
    if (data.elements) elements = data.elements;
    if (data.appState) Object.assign(state, data.appState);
  });
  const setActiveTool = vi.fn((next: { type: string }) => {
    state.activeTool = { type: next.type };
  });
  const api = {
    getAppState: () => state,
    getSceneElements: () => elements.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    updateScene,
    setActiveTool,
  } as unknown as ExcalidrawImperativeAPI;
  return {
    api,
    state,
    updateScene,
    setActiveTool,
    elements: () => elements,
    draw: (element) => void (elements = [...elements, element]),
    replace: (next) => void (elements = next),
  };
}

/** The browser's events are trusted; the ones a script dispatches (the radial menu's text start) are not. */
function mouse(type: "dblclick", x: number, y: number, trusted = true) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(event, "isTrusted", { value: trusted });
  return event;
}
function press(target: Element, x: number, y: number) {
  const event = new PointerEvent("pointerdown", { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(event, "isTrusted", { value: true });
  target.dispatchEvent(event);
}

let canvas: HTMLCanvasElement;
let heard: Mock<(event: Event) => void>;
let stop: () => void;

beforeEach(() => {
  document.body.innerHTML = '<div class="excalidraw"><canvas class="interactive"></canvas></div>';
  canvas = document.querySelector<HTMLCanvasElement>("canvas.interactive")!;
  // Excalidraw's own React listener sits on the canvas, after the capture phase.
  heard = vi.fn<(event: Event) => void>();
  canvas.addEventListener("dblclick", heard);
  stop = installDoubleClickSelect();
});
afterEach(() => {
  stop();
  canvasStore.setState({ api: null });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const useApi = (fake: Fake) => canvasStore.setState({ api: fake.api });

describe("with a drawing tool", () => {
  it("selects the terminal under a real double-click and switches to the selection tool", () => {
    const node = terminal();
    const fake = fakeApi([node], "rectangle");
    useApi(fake);
    const event = mouse("dblclick", 100, 100);
    canvas.dispatchEvent(event);
    expect(fake.setActiveTool).toHaveBeenCalledWith({ type: "selection" });
    expect(fake.updateScene).toHaveBeenLastCalledWith({ appState: { selectedElementIds: { [node.id]: true }, selectedGroupIds: {} } });
    expect(event.defaultPrevented).toBe(true);
    // Excalidraw does not hear it: it would draw or start a text there.
    expect(heard).not.toHaveBeenCalled();
  });

  it.each(["rectangle", "ellipse", "diamond", "arrow", "line", "freedraw", "text", "eraser", "hand", "laser"])("works with the %s tool", (tool) => {
    const node = terminal();
    const fake = fakeApi([node], tool);
    useApi(fake);
    canvas.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.state.activeTool).toEqual({ type: "selection" });
    expect(fake.state.selectedElementIds).toEqual({ [node.id]: true });
  });

  it("selects the Fleet too, and exactly it: the old selection goes", () => {
    const manager = fleet();
    const other = terminal();
    const fake = fakeApi([other, manager], "arrow", { selectedElementIds: { [other.id]: true }, selectedGroupIds: { g: true } });
    useApi(fake);
    canvas.dispatchEvent(mouse("dblclick", 1100, 100));
    expect(fake.state.selectedElementIds).toEqual({ [manager.id]: true });
    expect(fake.state.selectedGroupIds).toEqual({});
  });

  it("takes the view's zoom and scroll into account", () => {
    const node = terminal();
    // Window (300, 200) is scene (300 / 0.5 - 400, 200 / 0.5 - 100) = (200, 300): inside the terminal.
    const fake = fakeApi([node], "rectangle", { zoom: { value: 0.5 }, scrollX: 400, scrollY: 100, offsetLeft: 0, offsetTop: 0 });
    useApi(fake);
    canvas.dispatchEvent(mouse("dblclick", 300, 200));
    expect(fake.state.selectedElementIds).toEqual({ [node.id]: true });
  });

  it("ignores a synthetic double-click: the radial menu's text start", () => {
    const fake = fakeApi([terminal()], "rectangle");
    useApi(fake);
    const event = mouse("dblclick", 100, 100, false);
    canvas.dispatchEvent(event);
    expect(fake.setActiveTool).not.toHaveBeenCalled();
    expect(fake.updateScene).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("leaves a double-click over empty canvas to Excalidraw", () => {
    const fake = fakeApi([terminal()], "rectangle");
    useApi(fake);
    const event = mouse("dblclick", 900, 600);
    canvas.dispatchEvent(event);
    expect(fake.setActiveTool).not.toHaveBeenCalled();
    expect(fake.updateScene).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("skips a terminal a folded group keeps hidden, and one that is gone", () => {
    const hidden = { ...terminal(), locked: true };
    const gone = { ...terminal(), isDeleted: true };
    const fake = fakeApi([gone, hidden], "rectangle");
    useApi(fake);
    canvas.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.setActiveTool).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("does nothing in reading mode, where nothing can be selected", () => {
    const fake = fakeApi([terminal()], "hand", { viewModeEnabled: true });
    useApi(fake);
    canvas.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.setActiveTool).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("leaves a minimized card to its own double-click", () => {
    const fake = fakeApi([terminal()], "rectangle");
    useApi(fake);
    const card = document.createElement("div");
    card.setAttribute("data-minimized", "t1");
    card.getBoundingClientRect = () => ({ left: 0, right: 720, top: 0, bottom: 68, width: 720, height: 68, x: 0, y: 0, toJSON: () => ({}) });
    document.querySelector(".excalidraw")!.append(card);
    const event = mouse("dblclick", 100, 30);
    canvas.dispatchEvent(event);
    expect(fake.setActiveTool).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    // Below the card, on the rest of the terminal's rectangle, it still selects.
    canvas.dispatchEvent(mouse("dblclick", 100, 300));
    expect(fake.setActiveTool).toHaveBeenCalledWith({ type: "selection" });
  });

  it("ignores a double-click that is not on the canvas: a panel over it", () => {
    const fake = fakeApi([terminal()], "rectangle");
    useApi(fake);
    const panel = document.createElement("div");
    document.body.append(panel);
    panel.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.setActiveTool).not.toHaveBeenCalled();
  });

  it("hears a double-click on the body of an active node too", () => {
    const node = terminal();
    const fake = fakeApi([node], "rectangle");
    useApi(fake);
    const body = document.createElement("div");
    body.setAttribute("data-terminal", node.id);
    document.querySelector(".excalidraw")!.append(body);
    body.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.state.selectedElementIds).toEqual({ [node.id]: true });
  });

  it("does nothing before the canvas is ready", () => {
    expect(() => canvas.dispatchEvent(mouse("dblclick", 100, 100))).not.toThrow();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("stops listening once uninstalled", () => {
    const fake = fakeApi([terminal()], "rectangle");
    useApi(fake);
    stop();
    canvas.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.setActiveTool).not.toHaveBeenCalled();
    stop = installDoubleClickSelect();
  });
});

// The eraser clicks do not erase a node (eraserGuard locks it, and Excalidraw's eraser skips what is locked): they leave nothing to undo, and the node is a double-click's like any other.
describe("with the eraser", () => {
  /** The scene as the guard leaves it with the eraser picked. */
  const guarded = (...elements: ExcalidrawElement[]) => eraserGuard(elements, true) ?? elements;

  it("selects a terminal and the Fleet, switches to the selection tool, and gives the nodes' locks back", () => {
    const [node, manager] = [terminal(), fleet()];
    const fake = fakeApi(guarded(node, manager), "eraser");
    useApi(fake);
    expect(fake.elements().every((e) => e.locked)).toBe(true);
    press(canvas, 100, 100);
    press(canvas, 100, 100);
    const event = mouse("dblclick", 100, 100);
    canvas.dispatchEvent(event);
    expect(fake.setActiveTool).toHaveBeenCalledWith({ type: "selection" });
    expect(fake.state.selectedElementIds).toEqual({ [node.id]: true });
    expect(event.defaultPrevented).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    // Unlocked before the selection: the nodes are back to what they were, drawn nothing.
    expect(fake.elements().map((e) => [e.id, e.locked, e.isDeleted])).toEqual([[node.id, false, false], [manager.id, false, false]]);
    expect(fake.elements()[0].customData).toEqual({ kind: "terminal" });
    canvas.dispatchEvent(mouse("dblclick", 1100, 100));
    expect(fake.state.selectedElementIds).toEqual({ [manager.id]: true });
  });

  it("leaves what was drawn alone", () => {
    const node = terminal();
    const drawn = dot("drawn", 900, 600);
    const fake = fakeApi(guarded(node, drawn), "eraser");
    useApi(fake);
    press(canvas, 100, 100);
    press(canvas, 100, 100);
    canvas.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.elements().filter((e) => e.isDeleted)).toEqual([]);
    expect(fake.elements()[1]).toBe(drawn);
  });

  it("still skips a terminal a folded group keeps hidden", () => {
    const hidden = { ...terminal(), locked: true };
    const fake = fakeApi(guarded(hidden), "eraser");
    useApi(fake);
    canvas.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.setActiveTool).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("leaves a double-click over empty canvas to Excalidraw, the locks as they are", () => {
    const fake = fakeApi(guarded(terminal()), "eraser");
    useApi(fake);
    const event = mouse("dblclick", 900, 600);
    canvas.dispatchEvent(event);
    expect(fake.setActiveTool).not.toHaveBeenCalled();
    expect(fake.updateScene).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("what the first click left behind", () => {
  it("removes the dots the two clicks drew, and drops the drawing in progress", () => {
    const node = terminal();
    const fake = fakeApi([node], "freedraw");
    useApi(fake);
    press(canvas, 100, 100);
    fake.draw(dot("d1", 100, 100));
    press(canvas, 101, 100);
    fake.draw(dot("d2", 100, 100));
    canvas.dispatchEvent(mouse("dblclick", 100, 100));
    const live = fake.elements().filter((e) => !e.isDeleted);
    expect(live).toEqual([node]);
    expect(fake.elements().map((e) => e.id)).toEqual([node.id, "d1", "d2"]);
    const cleanup = fake.updateScene.mock.calls[0][0];
    expect(cleanup.captureUpdate).toBe("never");
    expect(cleanup.appState).toEqual({ newElement: null, multiElement: null, selectedLinearElement: null, startBoundElement: null, suggestedBindings: [] });
  });

  it("removes dots and drops the drawing in progress, but keeps what was in the scene before, and the nodes", () => {
    const old = dot("old", 500, 500);
    const node = terminal();
    const fake = fakeApi([node, old], "arrow", { newElement: { id: "stray" }, multiElement: { id: "stray" }, selectedLinearElement: {} });
    useApi(fake);
    press(canvas, 100, 100);
    fake.draw(dot("stray", 100, 100));
    press(canvas, 100, 100);
    canvas.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.elements().filter((e) => e.isDeleted).map((e) => e.id)).toEqual(["stray"]);
    expect(fake.state.multiElement).toBeNull();
    expect(fake.state.newElement).toBeNull();
    expect(fake.state.selectedLinearElement).toBeNull();
  });

  // Excalidraw finishes an elbow arrow (the app default) on the second click: bound to the node, selected, the tool already the selection one.
  it("removes an elbow arrow Excalidraw finished by itself, and unbinds it from the node", () => {
    const node = terminal();
    const fake = fakeApi([node], "arrow");
    useApi(fake);
    press(canvas, 100, 100);
    // Routed around the node it is bound to: not tiny.
    const arrow = { ...dot("arrow", 100, 100), type: "arrow", width: 760, height: 480 } as unknown as ExcalidrawElement;
    fake.replace([{ ...node, boundElements: [{ id: "arrow", type: "arrow" }, { id: "wire", type: "arrow" }] }, arrow]);
    Object.assign(fake.state, { activeTool: { type: "selection" }, multiElement: null, selectedElementIds: { arrow: true }, selectedLinearElement: {} });
    press(canvas, 100, 100);
    const event = mouse("dblclick", 100, 100);
    canvas.dispatchEvent(event);
    const [kept, gone] = fake.elements();
    expect(gone.isDeleted).toBe(true);
    expect(kept.isDeleted).toBe(false);
    expect(kept.boundElements).toEqual([{ id: "wire", type: "arrow" }]);
    expect(fake.state.selectedElementIds).toEqual({ [node.id]: true });
    expect(fake.state.selectedLinearElement).toBeNull();
    // Excalidraw would have started a label on that arrow.
    expect(event.defaultPrevented).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    expect(fake.setActiveTool).not.toHaveBeenCalled();
  });

  // The text tool leaves itself on the first click; the second one lands in the editor the first opened.
  it("takes a double-click that lands in the text editor, and closes the editor", () => {
    const node = terminal();
    const fake = fakeApi([node], "text");
    useApi(fake);
    press(canvas, 100, 100);
    fake.state.activeTool = { type: "selection" };
    const editor = document.createElement("textarea");
    editor.className = "excalidraw-wysiwyg";
    document.querySelector(".excalidraw")!.append(editor);
    editor.focus();
    const blurred = vi.fn();
    editor.addEventListener("blur", blurred);
    // That press is the editor's: Excalidraw does not hear it as a canvas click.
    press(editor, 101, 100);
    const event = mouse("dblclick", 101, 100);
    editor.dispatchEvent(event);
    expect(blurred).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(fake.state.selectedElementIds).toEqual({ [node.id]: true });
  });

  it("ignores a double-click in the text editor when no drawing click came before it", () => {
    const fake = fakeApi([terminal()], "selection");
    useApi(fake);
    const editor = document.createElement("textarea");
    editor.className = "excalidraw-wysiwyg";
    document.querySelector(".excalidraw")!.append(editor);
    editor.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.updateScene).not.toHaveBeenCalled();
  });

  it("does not touch the scene when the press was not heard", () => {
    const fake = fakeApi([terminal(), dot("d1", 100, 100)], "freedraw");
    useApi(fake);
    canvas.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.elements().filter((e) => e.isDeleted)).toEqual([]);
    expect(fake.state.activeTool).toEqual({ type: "selection" });
  });

  it("does not touch a drawing that began long before the double-click", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fake = fakeApi([terminal()], "freedraw");
    useApi(fake);
    press(canvas, 100, 100);
    fake.draw(dot("d1", 100, 100));
    now.mockReturnValue(1_005_000);
    canvas.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.elements().filter((e) => e.isDeleted)).toEqual([]);
  });

  it("starts over on a press that is not the second click of a double-click", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fake = fakeApi([terminal()], "freedraw");
    useApi(fake);
    // A first stroke, finished and kept, then a double-click a while later.
    press(canvas, 100, 100);
    fake.draw({ ...dot("kept", 100, 100), width: 0.1, height: 0.1 });
    now.mockReturnValue(1_002_000);
    press(canvas, 300, 300);
    fake.draw(dot("d1", 300, 300));
    press(canvas, 300, 300);
    canvas.dispatchEvent(mouse("dblclick", 300, 300));
    expect(fake.elements().filter((e) => e.isDeleted).map((e) => e.id)).toEqual(["d1"]);
  });

  it("closes the text editor the first click opened", () => {
    const fake = fakeApi([terminal()], "text");
    useApi(fake);
    const editor = document.createElement("textarea");
    editor.className = "excalidraw-wysiwyg";
    document.body.append(editor);
    editor.focus();
    const blurred = vi.fn();
    editor.addEventListener("blur", blurred);
    canvas.dispatchEvent(mouse("dblclick", 100, 100));
    expect(blurred).toHaveBeenCalledTimes(1);
  });
});

describe("with the selection tool", () => {
  it("leaves an already selected terminal alone: Excalidraw activates it", () => {
    const node = terminal();
    const fake = fakeApi([node], "selection", { selectedElementIds: { [node.id]: true } });
    useApi(fake);
    const event = mouse("dblclick", 100, 100);
    canvas.dispatchEvent(event);
    expect(fake.updateScene).not.toHaveBeenCalled();
    expect(fake.setActiveTool).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("selects a terminal that is not selected yet, and still lets Excalidraw have the double-click", () => {
    const node = terminal();
    const fake = fakeApi([node, fleet()], "selection", { selectedElementIds: { other: true } });
    useApi(fake);
    const event = mouse("dblclick", 100, 100);
    canvas.dispatchEvent(event);
    expect(fake.updateScene).toHaveBeenCalledWith({ appState: { selectedElementIds: { [node.id]: true }, selectedGroupIds: {} } });
    expect(fake.setActiveTool).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("leaves the active node's body its double-click: a word in xterm, a rename in a header", () => {
    const node = terminal();
    const fake = fakeApi([node], "selection", { activeEmbeddable: { element: node, state: "active" } });
    useApi(fake);
    const body = document.createElement("div");
    body.setAttribute("data-terminal", node.id);
    document.querySelector(".excalidraw")!.append(body);
    const bodyHeard = vi.fn();
    body.addEventListener("dblclick", bodyHeard);
    body.dispatchEvent(mouse("dblclick", 100, 100));
    expect(fake.updateScene).not.toHaveBeenCalled();
    expect(bodyHeard).toHaveBeenCalledTimes(1);
  });

  it("has nothing to undo after a press of its own: the double-click stays Excalidraw's", () => {
    const node = terminal();
    const fake = fakeApi([node], "selection");
    useApi(fake);
    press(canvas, 100, 100);
    press(canvas, 100, 100);
    const event = mouse("dblclick", 100, 100);
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(fake.updateScene).toHaveBeenCalledTimes(1);
    expect(fake.updateScene).toHaveBeenCalledWith({ appState: { selectedElementIds: { [node.id]: true }, selectedGroupIds: {} } });
  });

  it("does not touch the selection over empty canvas", () => {
    const fake = fakeApi([terminal()], "selection");
    useApi(fake);
    canvas.dispatchEvent(mouse("dblclick", 900, 600));
    expect(fake.updateScene).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
