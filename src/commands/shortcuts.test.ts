// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { isEyeDropperKey, isModalOpen, isTypedInto, SELECTION_SHORTCUTS, shortcutOf, type KeyLike } from "./shortcuts";

const key = (fields: Partial<KeyLike>): KeyLike => ({
  key: "",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
  ...fields,
});

describe("shortcutOf (spec fenêtre §6.1, §6.2)", () => {
  it("recognizes each shortcut of the application", () => {
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true }))).toBe("Ctrl+Tab");
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Tab");
    expect(shortcutOf(key({ key: "p", ctrlKey: true }))).toBe("Ctrl+P");
    expect(shortcutOf(key({ key: "P", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+P");
    expect(shortcutOf(key({ key: "Escape", shiftKey: true }))).toBe("Shift+Escape");
    expect(shortcutOf(key({ key: "A", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+A");
    expect(shortcutOf(key({ key: "g", ctrlKey: true }))).toBe("Ctrl+G");
    // Ungroup: taken only when the app's Ungroup can act (dispatch.test.ts); else it still reaches Excalidraw.
    expect(shortcutOf(key({ key: "G", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+G");
    expect(shortcutOf(key({ key: "g", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+G");
  });

  it("leaves Ctrl+Shift+G to a text field or a terminal, never to the canvas's selection", () => {
    expect(SELECTION_SHORTCUTS.has("Ctrl+Shift+G")).toBe(true);
    const terminal = document.createElement("div");
    terminal.className = "xterm";
    terminal.innerHTML = "<textarea></textarea>";
    expect(isTypedInto(terminal.querySelector("textarea"))).toBe(true);
    expect(isTypedInto(document.createElement("input"))).toBe(true);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isTypedInto(editable)).toBe(true);
    const canvas = document.createElement("div");
    canvas.className = "excalidraw-container";
    expect(isTypedInto(canvas)).toBe(false);
    expect(isTypedInto(document.body)).toBe(false);
  });

  it("reads the letter as printed: P on an AZERTY keyboard, whatever the case", () => {
    expect(shortcutOf({ ...key({ key: "p", ctrlKey: true }), code: "KeyP" } as KeyLike)).toBe("Ctrl+P");
    expect(shortcutOf(key({ key: "P", ctrlKey: true }))).toBe("Ctrl+P");
  });

  it("never makes a shortcut with Alt or AltGr, nor during an IME composition", () => {
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutOf(key({ key: "p", ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, isComposing: true }))).toBeNull();
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, metaKey: true }))).toBeNull();
  });

  it("lets a held key repeat Ctrl+Tab and Ctrl+Shift+Tab only", () => {
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, repeat: true }))).toBe("Ctrl+Tab");
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, shiftKey: true, repeat: true }))).toBe("Ctrl+Shift+Tab");
    expect(shortcutOf(key({ key: "A", ctrlKey: true, shiftKey: true, repeat: true }))).toBeNull();
    expect(shortcutOf(key({ key: "Escape", shiftKey: true, repeat: true }))).toBeNull();
  });

  it("ignores everything else: plain Tab, Escape alone, Ctrl+A, Ctrl+Échap", () => {
    for (const fields of [{ key: "Tab" }, { key: "Escape" }, { key: "a", ctrlKey: true }, { key: "Escape", ctrlKey: true, shiftKey: true }, { key: "r" }]) {
      expect(shortcutOf(key(fields))).toBeNull();
    }
  });
});

describe("isModalOpen", () => {
  afterEach(() => document.body.replaceChildren());

  it("sees an open dialog of ours or of Excalidraw, not a menu or a popover", () => {
    expect(isModalOpen()).toBe(false);
    document.body.innerHTML = '<div data-slot="dropdown-menu-content"></div><div data-slot="popover-content" role="dialog"></div>';
    expect(isModalOpen()).toBe(false);
    document.body.innerHTML = '<div data-slot="dialog-content"></div>';
    expect(isModalOpen()).toBe(true);
    document.body.innerHTML = '<div class="excalidraw excalidraw-modal-container"></div>';
    expect(isModalOpen()).toBe(true);
  });
});

describe("isEyeDropperKey", () => {
  it("is I, Shift+G and Shift+S, whatever Caps Lock does to the letter", () => {
    for (const fields of [{ key: "i" }, { key: "I" }, { key: "G", shiftKey: true }, { key: "g", shiftKey: true }, { key: "S", shiftKey: true }]) {
      expect(isEyeDropperKey(key(fields))).toBe(true);
    }
  });

  it("is not Shift+I, plain G or S, a combination with Ctrl, Alt or Meta, nor a key typed in a composition", () => {
    for (const fields of [
      { key: "I", shiftKey: true },
      { key: "g" },
      { key: "s" },
      { key: "i", ctrlKey: true },
      { key: "i", altKey: true },
      { key: "i", metaKey: true },
      { key: "G", shiftKey: true, ctrlKey: true },
      { key: "i", isComposing: true },
    ]) {
      expect(isEyeDropperKey(key(fields))).toBe(false);
    }
  });
});
