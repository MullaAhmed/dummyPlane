// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSource } from "@/theme/cssBlocks";
import type { Command, CommandContext } from "./command";
import { installShortcuts } from "./dispatch";
import { openPalette, paletteStore } from "./paletteState";
import { CANVAS_KEYS, pressCanvasKey } from "@/radial/bridges";

vi.mock("./registry", () => ({ COMMANDS: [], commandContext: () => ({}) }));

const ctx: CommandContext = { project: true, workspaceId: "w1", terminalCount: 2, terminalId: "batman" };
let available: boolean;
const run = vi.fn();
const next: Command = { id: "terminal.next", label: "Next terminal", section: "Navigation", keywords: [], shortcut: "Ctrl+Tab", available: () => available, run };
let uninstall: () => void;
let xterm: HTMLTextAreaElement;
const reachedXterm = vi.fn();

beforeEach(() => {
  available = true;
  run.mockClear();
  reachedXterm.mockClear();
  document.body.innerHTML = '<div data-terminal="batman"><textarea></textarea></div>';
  xterm = document.querySelector("textarea")!;
  xterm.addEventListener("keydown", reachedXterm);
  uninstall = installShortcuts(window, [next], () => ctx);
});
afterEach(() => {
  uninstall();
  document.body.replaceChildren();
});

const press = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  xterm.dispatchEvent(event);
  return event;
};

it("runs the shortcut's command and keeps the key from the terminal and its agent (spec fenêtre §6.2)", () => {
  const event = press({ key: "Tab", ctrlKey: true });
  expect(run).toHaveBeenCalledWith(ctx);
  expect(event.defaultPrevented).toBe(true);
  expect(reachedXterm).not.toHaveBeenCalled();
});

it("lets a key through when its command is unavailable, or when it is no shortcut", () => {
  available = false;
  expect(press({ key: "Tab", ctrlKey: true }).defaultPrevented).toBe(false);
  available = true;
  expect(press({ key: "Tab" }).defaultPrevented).toBe(false);
  expect(press({ key: "p", ctrlKey: true }).defaultPrevented).toBe(false);
  expect(run).not.toHaveBeenCalled();
  expect(reachedXterm).toHaveBeenCalledTimes(3);
});

it("lets every key through while a modal dialog is open", () => {
  const dialog = document.createElement("div");
  dialog.dataset.slot = "dialog-content";
  document.body.append(dialog);
  expect(press({ key: "Tab", ctrlKey: true }).defaultPrevented).toBe(false);
  expect(run).not.toHaveBeenCalled();
  expect(reachedXterm).toHaveBeenCalled();
});

it("closes the palette before a command that moves the keyboard: no key typed after it reaches an agent", () => {
  openPalette("goTo", ctx);
  press({ key: "Tab", ctrlKey: true });
  expect(run).toHaveBeenCalled();
  expect(paletteStore.getState().open).toBe(false);
});

it("stops listening once uninstalled", () => {
  uninstall();
  press({ key: "Tab", ctrlKey: true });
  expect(run).not.toHaveBeenCalled();
  uninstall = () => undefined;
});

it("is installed once, at startup, for the app's whole life, with the focus tracking", () => {
  const main = readSource("main.tsx");
  expect(main).toContain("installShortcuts(window);");
  expect(main).toContain("trackTerminalFocus(document);");
});

it("consumes the repeats of a held shortcut that does not repeat, without running it again", () => {
  const p: Command = { ...next, id: "palette.goTo", shortcut: "Ctrl+P" };
  uninstall();
  uninstall = installShortcuts(window, [p], () => ctx);
  const event = press({ key: "p", ctrlKey: true, repeat: true });
  expect(run).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(true);
  expect(reachedXterm).not.toHaveBeenCalled();
});

it("closes an open dropdown menu before the command runs: the menu would take the keyboard back", () => {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.dataset.state = "open";
  document.body.append(menu);
  const escapes: string[] = [];
  document.addEventListener("keydown", (e) => e.key === "Escape" && escapes.push(e.key), { once: true });
  press({ key: "Tab", ctrlKey: true });
  expect(escapes).toEqual(["Escape"]);
  expect(run).toHaveBeenCalled();
});

describe("Excalidraw's eyedropper keys", () => {
  const reachedCanvas = vi.fn();
  let canvas: HTMLElement;
  let field: HTMLInputElement;
  beforeEach(() => {
    reachedCanvas.mockClear();
    document.body.insertAdjacentHTML("beforeend", '<div class="excalidraw"><div class="excalidraw-container" tabindex="0"><input /></div></div>');
    canvas = document.querySelector<HTMLElement>(".excalidraw-container")!;
    field = canvas.querySelector("input")!;
    canvas.addEventListener("keydown", reachedCanvas);
  });
  const pressOn = (target: HTMLElement, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

  it("never reach Excalidraw from the canvas: I, Shift+G, Shift+S", () => {
    pressOn(canvas, { key: "i" });
    pressOn(canvas, { key: "G", shiftKey: true });
    pressOn(canvas, { key: "S", shiftKey: true });
    expect(reachedCanvas).not.toHaveBeenCalled();
  });

  it("let Excalidraw's other keys through, and an I typed into a field or a terminal", () => {
    pressOn(canvas, { key: "r" });
    pressOn(field, { key: "i" });
    press({ key: "i" });
    expect(reachedCanvas).toHaveBeenCalledTimes(2);
    expect(reachedXterm).toHaveBeenCalledTimes(1);
  });
});

describe("Ctrl+Shift+G, Ungroup of the canvas's selection", () => {
  const reachedCanvas = vi.fn();
  let canvas: HTMLElement;
  let ungroupAvailable: boolean;
  let greyed: string | null;
  const ungroupRun = vi.fn(() => pressCanvasKey(CANVAS_KEYS.ungroup));
  const ungroupCommand: Command = {
    id: "selection.ungroup",
    label: "Ungroup selection",
    section: "Drawing",
    keywords: [],
    shortcut: "Ctrl+Shift+G",
    available: () => ungroupAvailable,
    disabled: () => greyed,
    run: ungroupRun,
  };
  beforeEach(() => {
    ungroupAvailable = true;
    greyed = null;
    reachedCanvas.mockClear();
    ungroupRun.mockClear();
    document.body.insertAdjacentHTML("beforeend", '<div class="excalidraw"><div class="excalidraw-container" tabindex="0"><input /></div></div>');
    canvas = document.querySelector<HTMLElement>(".excalidraw-container")!;
    canvas.addEventListener("keydown", reachedCanvas);
    uninstall();
    uninstall = installShortcuts(window, [ungroupCommand], () => ctx);
  });
  const chord = (target: HTMLElement) => {
    const event = new KeyboardEvent("keydown", { key: "G", code: "KeyG", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  it("ungroups from the canvas: the command runs once, and only its own press of Excalidraw's key reaches the canvas", () => {
    const event = chord(canvas);
    expect(event.defaultPrevented).toBe(true);
    expect(ungroupRun).toHaveBeenCalledTimes(1);
    // The user's key is consumed; the command's press goes through to Excalidraw, never caught again.
    expect(reachedCanvas).toHaveBeenCalledTimes(1);
    expect(reachedCanvas.mock.calls[0][0]).not.toBe(event);
  });

  it("is a terminal's or a field's when typed there: it never ungroups from inside a terminal", () => {
    chord(xterm);
    chord(canvas.querySelector("input")!);
    expect(ungroupRun).not.toHaveBeenCalled();
    expect(reachedXterm).toHaveBeenCalledTimes(1);
    expect(reachedCanvas).toHaveBeenCalledTimes(1);
  });

  it("goes on to Excalidraw when Ungroup cannot act, unavailable or greyed: Excalidraw's own Ctrl+Shift+G answers", () => {
    ungroupAvailable = false;
    expect(chord(canvas).defaultPrevented).toBe(false);
    ungroupAvailable = true;
    greyed = "the selection spans several groups";
    expect(chord(canvas).defaultPrevented).toBe(false);
    expect(ungroupRun).not.toHaveBeenCalled();
    expect(reachedCanvas).toHaveBeenCalledTimes(2);
  });
});

it("leaves the repeats of a Ctrl+Shift+G held in a terminal to the terminal, as its first press", () => {
  const ungroupCommand: Command = { id: "selection.ungroup", label: "Ungroup selection", section: "Drawing", keywords: [], shortcut: "Ctrl+Shift+G", available: () => true, run };
  uninstall();
  uninstall = installShortcuts(window, [ungroupCommand], () => ctx);
  expect(press({ key: "G", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
  expect(press({ key: "G", ctrlKey: true, shiftKey: true, repeat: true }).defaultPrevented).toBe(false);
  expect(run).not.toHaveBeenCalled();
  expect(reachedXterm).toHaveBeenCalledTimes(2);
});
