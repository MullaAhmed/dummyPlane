import { commandFor, runCommand, type Command, type CommandContext } from "./command";
import { closeOpenMenus } from "./openMenus";
import { closePalette, paletteStore } from "./paletteState";
import { COMMANDS, commandContext } from "./registry";
import { isCanvasKeyPress } from "@/radial/bridges";
import { heldShortcutOf, isEyeDropperKey, isModalOpen, isTypedInto, SELECTION_SHORTCUTS, shortcutOf, type Shortcut } from "./shortcuts";

/** Where Excalidraw reads a key as its own: inside its container, but not typed into a field or a terminal's xterm. */
function onCanvas(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || !target.closest(".excalidraw")) return false;
  return !target.matches("input, textarea, select, [contenteditable='true'], [contenteditable='']");
}

/**
 * The application's single keydown listener: on the
 * window, in the capture phase, ahead of xterm, the fields, Excalidraw and
 * WebView2. A recognized shortcut whose command is available is consumed: it
 * reaches neither the terminal, nor its agent, nor Excalidraw.
 */
export function installShortcuts(
  target: Window,
  commands: readonly Command[] = COMMANDS,
  context: () => CommandContext = commandContext,
): () => void {
  const listener = (event: KeyboardEvent) => {
    // A key the app presses for Excalidraw (its Ungroup, Ctrl+Shift+G) is Excalidraw's.
    if (isCanvasKeyPress(event)) return;
    // Never Excalidraw's eyedropper (shortcuts.ts): stopped before its container hears it. Nothing else on the canvas reads these keys.
    if (isEyeDropperKey(event) && onCanvas(event.target)) {
      event.stopImmediatePropagation();
      return;
    }
    const shortcut = shortcutOf(event);
    if (isModalOpen(target.document)) return;
    // Ctrl+Shift+G in a terminal or a field is theirs, held or not: it never ungroups a group from there.
    const fieldKeeps = (s: Shortcut) => SELECTION_SHORTCUTS.has(s) && isTypedInto(event.target);
    if (!shortcut) {
      // A held Ctrl+P must not reach the palette's list (cmdk reads the repeats).
      const held = heldShortcutOf(event);
      if (held && !fieldKeeps(held) && commandFor(commands, held, context())) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (fieldKeeps(shortcut)) return;
    const ctx = context();
    const command = commandFor(commands, shortcut, ctx);
    if (!command) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // A command that moves the keyboard closes the palette first: an open
    // palette never shows while the keys go to a terminal (Esc included).
    if (paletteStore.getState().open && !command.id.startsWith("palette.")) closePalette();
    closeOpenMenus(target.document);
    runCommand(command, ctx);
  };
  target.addEventListener("keydown", listener, { capture: true });
  return () => target.removeEventListener("keydown", listener, { capture: true });
}
