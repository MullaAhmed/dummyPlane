/** The application's shortcuts (spec window §6.1), as the interface writes them. */
export type Shortcut = "Ctrl+Tab" | "Ctrl+Shift+Tab" | "Ctrl+P" | "Ctrl+Shift+P" | "Shift+Escape" | "Ctrl+Shift+A" | "Ctrl+G" | "Ctrl+Shift+G";

/**
 * Shortcuts of the canvas's selection: typed into a text field or a terminal (xterm's input is a
 * textarea), they are the field's or the agent's, never the canvas's.
 */
export const SELECTION_SHORTCUTS: ReadonlySet<Shortcut> = new Set<Shortcut>(["Ctrl+Shift+G"]);

/** A text field or a terminal's input: what is typed there is theirs. */
export function isTypedInto(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
}

/** The part of a keydown event the shortcuts read. */
export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "repeat" | "isComposing">;

/** A held key repeats these only (spec window §6.2). */
const REPEATABLE: ReadonlySet<Shortcut> = new Set<Shortcut>(["Ctrl+Tab", "Ctrl+Shift+Tab"]);

function match(key: string, ctrl: boolean, shift: boolean): Shortcut | null {
  if (ctrl && key === "Tab") return shift ? "Ctrl+Shift+Tab" : "Ctrl+Tab";
  if (ctrl && key === "p") return shift ? "Ctrl+Shift+P" : "Ctrl+P";
  if (ctrl && shift && key === "a") return "Ctrl+Shift+A";
  if (ctrl && key === "g") return shift ? "Ctrl+Shift+G" : "Ctrl+G";
  if (!ctrl && shift && key === "Escape") return "Shift+Escape";
  return null;
}

/**
 * The shortcut a keydown makes, if any (spec window §6.2). Letters are read
 * as printed (`key`, any case: P is P in AZERTY as in QWERTY); Alt, hence
 * AltGr, never makes a shortcut, nor does a key typed during an IME composition.
 */
export function shortcutOf(event: KeyLike): Shortcut | null {
  const shortcut = recognized(event);
  if (!shortcut || (event.repeat && !REPEATABLE.has(shortcut))) return null;
  return shortcut;
}

function recognized(event: KeyLike): Shortcut | null {
  if (event.isComposing || event.altKey || event.metaKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return match(key, event.ctrlKey, event.shiftKey);
}

/**
 * Excalidraw's eyedropper keys: I, Shift+G (fill) and Shift+S (stroke). The
 * canvas is transparent (the dot grid and its colour are painted under it), so
 * the dropper reads black there, shows it as a pale square that follows the
 * pointer, and a click sets that black as the fill, outside the pen's inks:
 * Excalidraw is never handed these keys. Compared as lowercase, as Excalidraw
 * folds Caps Lock: Caps Lock + I opens it too, Shift+I does not.
 */
export function isEyeDropperKey(event: KeyLike): boolean {
  if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return false;
  const key = event.key.toLowerCase();
  return event.shiftKey ? key === "g" || key === "s" : key === "i";
}

/** The shortcut a held key repeats while it does not repeat: consumed, not run (plan F1). */
export function heldShortcutOf(event: KeyLike): Shortcut | null {
  const shortcut = recognized(event);
  return shortcut && event.repeat && !REPEATABLE.has(shortcut) ? shortcut : null;
}

/**
 * A modal dialog takes every key (spec window §6.2): ours (closing a node,
 * terminal options) and Excalidraw's, whose container only exists while open.
 */
export function isModalOpen(root: ParentNode = document): boolean {
  return root.querySelector('[data-slot="dialog-content"], .excalidraw-modal-container') !== null;
}
