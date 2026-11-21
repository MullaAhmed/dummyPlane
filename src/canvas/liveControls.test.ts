// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { readSource } from "@/theme/cssBlocks";
import { activeTerminalStore } from "./activeTerminal";
import { canvasStore } from "./canvasStore";
import { activatedByPress, installLiveControls, LIVE_CONTROL, liveControlAt } from "./liveControls";
import { createNodeElement } from "./nodeElement";

vi.mock("@excalidraw/excalidraw", () => ({}));
// What hands a wheel on to Excalidraw's canvas (the link layer's too): its own tests say how.
const { forwardWheel } = vi.hoisted(() => ({ forwardWheel: vi.fn() }));
vi.mock("@/agents/linkOverlay", () => ({ forwardWheel }));

const terminal = () => createNodeElement("terminal", { x: 360, y: 220 });
const fleet = () => createNodeElement("fleet", { x: 1320, y: 380 });
const drawn = () => ({ ...terminal(), type: "rectangle", customData: undefined }) as unknown as ExcalidrawElement;

/** An Excalidraw whose app state is a plain object the calls merge into. */
function fakeApi(elements: ExcalidrawElement[], extra: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    activeTool: { type: "selection" },
    selectedElementIds: { other: true },
    selectedGroupIds: { g: true },
    activeEmbeddable: null,
    ...extra,
  };
  const updateScene = vi.fn((data: { appState?: Record<string, unknown> }) => {
    if (data.appState) Object.assign(state, data.appState);
  });
  const api = { getAppState: () => state, getSceneElements: () => elements, updateScene } as unknown as ExcalidrawImperativeAPI;
  canvasStore.setState({ api });
  return { state, updateScene };
}

/** A node as NodeHost renders it inside Excalidraw: its id on a wrapper, its chrome marked, its body not. */
function mountNode(nodeId: string) {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="excalidraw"><canvas class="interactive"></canvas><div class="excalidraw__embeddable-container"><div data-node-id="${nodeId}">
      <header data-node-chrome="">
        <span data-name>Batman</span>
        <button data-task-line>Fix the cart</button>
        <button data-close aria-label="Close"><svg><path></path></svg></button>
        <button data-off disabled>Off</button>
        <div role="switch" data-switch></div>
      </header>
      <div data-body><button data-in-body>Resume</button><textarea></textarea></div>
      <footer data-node-chrome=""><button data-link>Link</button></footer>
      <section data-node-chrome=""><input data-field /></section>
    </div></div></div>`,
  );
  const root = document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)!;
  return (selector: string) => root.querySelector<Element>(selector)!;
}

function press(target: Element, { button = 0, trusted = true } = {}) {
  const event = new PointerEvent("pointerdown", { button, bubbles: true, cancelable: true });
  Object.defineProperty(event, "isTrusted", { value: trusted });
  target.dispatchEvent(event);
  return event;
}

let stop: () => void;
beforeEach(() => {
  stop = installLiveControls();
  activeTerminalStore.setState({ id: null });
});
afterEach(() => {
  stop();
  // Whatever a test left of a press is not the next one's.
  activatedByPress("");
  canvasStore.setState({ api: null });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("liveControlAt", () => {
  it("finds the control of a node's chrome under a press, and the node it belongs to", () => {
    const at = mountNode("t1");
    expect(liveControlAt(at("[data-close]"))).toEqual({ nodeId: "t1", control: at("[data-close]") });
    // The glyph inside a button is the button's.
    expect(liveControlAt(at("[data-close] path"))?.control).toBe(at("[data-close]"));
    expect(liveControlAt(at("[data-switch]"))?.nodeId).toBe("t1");
    expect(liveControlAt(at("[data-link]"))?.nodeId).toBe("t1");
    expect(liveControlAt(at("[data-field]"))?.nodeId).toBe("t1");
  });

  it("leaves the rest to the canvas: the name, the task line, a disabled button, the body", () => {
    const at = mountNode("t1");
    expect(liveControlAt(at("[data-name]"))).toBeNull();
    expect(liveControlAt(at("[data-task-line]"))).toBeNull();
    expect(liveControlAt(at("[data-off]"))).toBeNull();
    expect(liveControlAt(at("header"))).toBeNull();
    // The body is the node's own once active (xterm, its resume card): a click in its middle activates it.
    expect(liveControlAt(at("[data-in-body]"))).toBeNull();
    expect(liveControlAt(at("textarea"))).toBeNull();
    expect(liveControlAt(null)).toBeNull();
  });

  it("knows no node outside the canvas", () => {
    document.body.innerHTML = '<div data-node-id="t1"><header data-node-chrome=""><button>Close</button></header></div>';
    expect(liveControlAt(document.querySelector("button"))).toBeNull();
  });
});

describe("a press on a control of an inactive node", () => {
  it("activates the node, without selecting it, and leaves the press to the control", () => {
    const node = terminal();
    const at = mountNode(node.id);
    const fake = fakeApi([node]);
    const heard = vi.fn();
    at("[data-close]").addEventListener("pointerdown", heard);
    const event = press(at("[data-close]"));
    expect(fake.updateScene).toHaveBeenCalledTimes(1);
    expect(fake.updateScene).toHaveBeenCalledWith({
      appState: { activeEmbeddable: { element: node, state: "active" }, selectedElementIds: {}, selectedGroupIds: {} },
    });
    // The control hears its press as ever: a menu opens on it, a button clicks on its release.
    expect(heard).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    // Send goes to it from now on.
    expect(activeTerminalStore.getState().id).toBe(node.id);
  });

  it("tells the canvas, once, that the press activated it: the view stays and the control keeps the keyboard", () => {
    const node = terminal();
    const at = mountNode(node.id);
    const fake = fakeApi([node]);
    press(at("[data-link]"));
    // Another node's activation is not this press's, and drops it.
    expect(activatedByPress("someone-else")).toBe(false);
    expect(activatedByPress(node.id)).toBe(false);
    fake.state.activeEmbeddable = null;
    press(at("[data-link]"));
    expect(activatedByPress(node.id)).toBe(true);
    expect(activatedByPress(node.id)).toBe(false);
  });

  it("forgets a press the canvas did not hear of in time", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const node = terminal();
    const at = mountNode(node.id);
    fakeApi([node]);
    press(at("[data-close]"));
    now.mockReturnValue(12_000);
    expect(activatedByPress(node.id)).toBe(false);
  });

  it("activates a Fleet from its mission panel, and leaves where Send goes alone", () => {
    const node = fleet();
    const at = mountNode(node.id);
    const fake = fakeApi([node]);
    press(at("[data-field]"));
    expect(fake.state.activeEmbeddable).toEqual({ element: node, state: "active" });
    expect(activeTerminalStore.getState().id).toBeNull();
  });

  it("does nothing more on the node already active", () => {
    const node = terminal();
    const at = mountNode(node.id);
    const fake = fakeApi([node], { activeEmbeddable: { element: node, state: "active" } });
    press(at("[data-close]"));
    expect(fake.updateScene).not.toHaveBeenCalled();
    expect(activatedByPress(node.id)).toBe(false);
  });

  it("activates a node Excalidraw only shows as hovered", () => {
    const node = terminal();
    const at = mountNode(node.id);
    const fake = fakeApi([node], { activeEmbeddable: { element: node, state: "hover" } });
    press(at("[data-close]"));
    expect(fake.state.activeEmbeddable).toEqual({ element: node, state: "active" });
  });

  it("moves the activation from the node that had it", () => {
    const node = terminal();
    const other = fleet();
    const at = mountNode(node.id);
    const fake = fakeApi([node, other], { activeEmbeddable: { element: other, state: "active" } });
    press(at("[data-close]"));
    expect(fake.state.activeEmbeddable).toEqual({ element: node, state: "active" });
  });

  it.each(["rectangle", "arrow", "freedraw", "text", "eraser", "hand", "laser"])("leaves a press with the %s tool to the tool", (tool) => {
    const node = terminal();
    const at = mountNode(node.id);
    const fake = fakeApi([node], { activeTool: { type: tool } });
    press(at("[data-close]"));
    expect(fake.updateScene).not.toHaveBeenCalled();
  });

  it("ignores a right press (the ring's), a script's press, and a press with no canvas", () => {
    const node = terminal();
    const at = mountNode(node.id);
    const fake = fakeApi([node]);
    press(at("[data-close]"), { button: 2 });
    press(at("[data-close]"), { trusted: false });
    expect(fake.updateScene).not.toHaveBeenCalled();
    canvasStore.setState({ api: null });
    expect(() => press(at("[data-close]"))).not.toThrow();
  });

  it("ignores a press on the rest of the node, and on a node gone from the scene or not a node", () => {
    const node = terminal();
    const at = mountNode(node.id);
    const fake = fakeApi([node]);
    press(at("[data-name]"));
    press(at("[data-in-body]"));
    expect(fake.updateScene).not.toHaveBeenCalled();
    const gone = mountNode("gone");
    press(gone("[data-close]"));
    expect(fake.updateScene).not.toHaveBeenCalled();
    const shape = drawn();
    const onShape = mountNode(shape.id);
    fakeApi([shape]);
    press(onShape("[data-close]"));
    expect(canvasStore.getState().api!.updateScene).not.toHaveBeenCalled();
  });

  it("stops listening when uninstalled", () => {
    const node = terminal();
    const at = mountNode(node.id);
    const fake = fakeApi([node]);
    stop();
    press(at("[data-close]"));
    expect(fake.updateScene).not.toHaveBeenCalled();
    stop = installLiveControls();
  });
});

describe("the wheel over a control of an inactive node", () => {
  function wheel(target: Element, { trusted = true, ctrlKey = false } = {}) {
    const event = new WheelEvent("wheel", { deltaX: 3, deltaY: 40, ctrlKey, clientX: 10, clientY: 20, bubbles: true, cancelable: true });
    Object.defineProperty(event, "isTrusted", { value: trusted });
    target.dispatchEvent(event);
    return event;
  }
  beforeEach(() => forwardWheel.mockClear());

  it("goes on to the canvas, which pans or zooms as over the rest of the node, and scrolls nothing else", () => {
    const node = terminal();
    const at = mountNode(node.id);
    fakeApi([node]);
    const event = wheel(at("[data-close]"), { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(forwardWheel).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("stays the control's on the active node, in a text field, and for a script's wheel", () => {
    const node = terminal();
    const at = mountNode(node.id);
    const fake = fakeApi([node], { activeEmbeddable: { element: node, state: "active" } });
    expect(wheel(at("[data-close]")).defaultPrevented).toBe(false);
    fake.state.activeEmbeddable = null;
    document.querySelector("footer")!.insertAdjacentHTML("beforeend", "<textarea data-task></textarea>");
    expect(wheel(at("[data-task]")).defaultPrevented).toBe(false);
    expect(wheel(at("[data-close]"), { trusted: false }).defaultPrevented).toBe(false);
    expect(wheel(at("[data-name]")).defaultPrevented).toBe(false);
    expect(forwardWheel).not.toHaveBeenCalled();
  });
});

describe("the stylesheet's part", () => {
  const css = readSource("theme/excalidraw.css");
  const rule = /\[data-live-controls\]\s+\.excalidraw__embeddable-container\s+\[data-node-chrome\]\s+:is\(([^)]*)\):not\(\s*\[data-task-line\],\s*:disabled\s*\)\s*\{\s*pointer-events: auto;\s*\}/;

  it("lets the pointer through to the same controls the handler takes, with the selection tool only", () => {
    const match = css.match(rule);
    expect(match).not.toBeNull();
    const listed = (match![1] ?? "").split(",").map((s) => s.trim());
    expect(listed).toEqual(LIVE_CONTROL.split(",").map((s) => s.trim()));
  });
});
