export type KeyAction = "copy" | "paste" | "newline" | "default";

type KeyInfo = Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

/**
 * Windows Terminal conventions: Ctrl+C copies when text is selected
 * and interrupts otherwise, Ctrl+V pastes, Shift+Enter inserts a newline in
 * Claude Code instead of sending the message. The same answer is given for
 * keydown, keypress and keyup so xterm never handles half of a combination.
 */
export function keyAction(event: KeyInfo, hasSelection: boolean): KeyAction {
  const { key, ctrlKey, shiftKey, altKey, metaKey } = event;
  if (altKey || metaKey) return "default";
  const letter = key.toLowerCase();
  if (ctrlKey && letter === "c" && (shiftKey || hasSelection)) return "copy";
  if (ctrlKey && letter === "v") return "paste";
  if (!ctrlKey && shiftKey && key === "Enter") return "newline";
  return "default";
}

/** ESC + CR is what Claude Code reads as "newline" (like Alt+Enter). */
export const NEWLINE_SEQUENCE = "\x1b\r";
