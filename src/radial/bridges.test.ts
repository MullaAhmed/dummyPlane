// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import {
  CANVAS_KEYS,
  copyCanvasSelection,
  isCanvasKeyPress,
  isNativeMenu,
  openNativeMenuAt,
  pasteOnCanvasAt,
  pressCanvasKey,
  readClipboardText,
  startTextAt,
  ungroupDrawings,
} from "./bridges";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

let box: HTMLElement;
let canvas: HTMLCanvasElement;
const seen: Event[] = [];
const cleanups: (() => void)[] = [];
const listen = (target: EventTarget, type: string) => {
  const record = (event: Event) => seen.push(event);
  target.addEventListener(type, record);
  cleanups.push(() => target.removeEventListener(type, record));
};
const clipboard = (read: () => Promise<unknown>) =>
  Object.defineProperty(navigator, "clipboard", { value: { read }, configurable: true });
const textItem = (text: string) => ({ types: ["text/plain"], getType: async () => new Blob([text], { type: "text/plain" }) });

beforeEach(() => {
  document.body.innerHTML =
    '<div class="excalidraw"><div class="excalidraw-container" tabindex="0"><canvas class="excalidraw__canvas interactive"></canvas></div></div><input id="field" />';
  box = document.querySelector<HTMLElement>(".excalidraw-container")!;
  canvas = document.querySelector("canvas")!;
  seen.length = 0;
  listen(box, "keydown");
  listen(canvas, "dblclick");
  listen(canvas, "contextmenu");
  listen(document, "copy");
  listen(document, "paste");
  listen(document, "pointermove");
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("Excalidraw's own actions, driven from outside (spec menu radial §6.3)", () => {
  it("sends Excalidraw's own shortcut to its container, the canvas taking the keyboard", () => {
    document.getElementById("field")!.focus();
    pressCanvasKey(CANVAS_KEYS.front);
    const key = seen[0] as KeyboardEvent;
    expect([key.type, key.code, key.ctrlKey, key.shiftKey]).toEqual(["keydown", "BracketRight", true, true]);
    expect(document.activeElement).toBe(box);
  });

  it("copies through Excalidraw's copy listener, the canvas having the keyboard", () => {
    let focused: Element | null = null;
    document.addEventListener("copy", () => (focused = document.activeElement), { once: true });
    copyCanvasSelection();
    expect(seen.map((e) => e.type)).toEqual(["copy"]);
    expect((seen[0] as ClipboardEvent).clipboardData).not.toBeNull();
    expect(focused).toBe(box);
  });

  it("pastes at the point: the pointer moves there first, then the clipboard comes as a paste", async () => {
    clipboard(async () => [textItem("hello")]);
    await pasteOnCanvasAt({ x: 40, y: 50 });
    expect(seen.map((e) => e.type)).toEqual(["pointermove", "paste"]);
    expect([(seen[0] as PointerEvent).clientX, (seen[0] as PointerEvent).clientY]).toEqual([40, 50]);
    expect((seen[1] as ClipboardEvent).clipboardData!.getData("text/plain")).toBe("hello");
  });

  it("does not paste over a node and says so: Excalidraw would paste nothing (plan G1)", async () => {
    document.body.insertAdjacentHTML("beforeend", '<div data-terminal="batman"><span id="body"></span></div>');
    vi.spyOn(document, "elementFromPoint").mockReturnValue(document.getElementById("body"));
    clipboard(async () => [textItem("hello")]);
    await pasteOnCanvasAt({ x: 40, y: 50 });
    expect(seen).toEqual([]);
    expect(toast).toHaveBeenCalledWith("Cannot paste here: a node is under this point");
    vi.restoreAllMocks();
  });

  it("says when the clipboard is empty or cannot be read, and pastes nothing", async () => {
    clipboard(async () => []);
    await pasteOnCanvasAt({ x: 1, y: 1 });
    expect(toast).toHaveBeenCalledWith("The clipboard is empty");
    clipboard(() => Promise.reject(new Error("denied")));
    await pasteOnCanvasAt({ x: 1, y: 1 });
    expect(toast.error).toHaveBeenCalledWith("Could not read the clipboard");
    expect(seen).toEqual([]);
  });

  it("reads the clipboard's text, null when there is none", async () => {
    clipboard(async () => [textItem("echo hi")]);
    expect(await readClipboardText()).toBe("echo hi");
    clipboard(async () => [{ types: ["image/png"], getType: async () => new Blob([], { type: "image/png" }) }]);
    expect(await readClipboardText()).toBeNull();
    // An image is not an empty clipboard.
    expect(toast).toHaveBeenCalledWith("No text on the clipboard");
  });

  it("starts a text at the point by a double-click on the canvas, with the selection tool and nothing selected (final review)", async () => {
    // Excalidraw's double-click starts a text only with the selection tool; on a lone image it crops.
    const setActiveTool = vi.fn();
    const updateScene = vi.fn();
    canvasStore.setState({ api: { setActiveTool, updateScene } as unknown as ExcalidrawImperativeAPI });
    startTextAt({ x: 12, y: 34 });
    expect(setActiveTool).toHaveBeenCalledWith({ type: "selection" });
    expect(updateScene).toHaveBeenCalledWith({ appState: { selectedElementIds: {}, selectedGroupIds: {} } });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const click = seen[0] as MouseEvent;
    expect([click.type, click.clientX, click.clientY]).toEqual(["dblclick", 12, 34]);
  });

  it("presses Excalidraw's own Ungroup, Ctrl+Shift+G with the upper-case G its keyTest reads, marked as its own", () => {
    canvasStore.setState({ api: { getAppState: () => ({ selectedGroupIds: { s1: true } }), updateScene: vi.fn() } as unknown as ExcalidrawImperativeAPI });
    ungroupDrawings(["s1"]);
    const key = seen[0] as KeyboardEvent;
    expect([key.type, key.key, key.code, key.ctrlKey, key.shiftKey]).toEqual(["keydown", "G", "KeyG", true, true]);
    expect(isCanvasKeyPress(key)).toBe(true);
    expect(isCanvasKeyPress(new KeyboardEvent("keydown", { key: "G", ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it("selects the groups to take apart first when Excalidraw has not, then presses its key a frame later", async () => {
    const updateScene = vi.fn();
    canvasStore.setState({ api: { getAppState: () => ({ selectedGroupIds: {} }), updateScene } as unknown as ExcalidrawImperativeAPI });
    ungroupDrawings(["s1", "s2"]);
    expect(updateScene).toHaveBeenCalledWith({ appState: { selectedGroupIds: { s1: true, s2: true } } });
    expect(seen).toEqual([]);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect((seen[0] as KeyboardEvent).key).toBe("G");
  });

  it("opens Excalidraw's menu at the point with a contextmenu it marks as its own", () => {
    openNativeMenuAt({ x: 5, y: 6 });
    const menu = seen[0] as MouseEvent;
    expect([menu.type, menu.clientX, menu.clientY, menu.button]).toEqual(["contextmenu", 5, 6, 2]);
    expect(isNativeMenu(menu)).toBe(true);
    expect(isNativeMenu(new MouseEvent("contextmenu"))).toBe(false);
  });
});
