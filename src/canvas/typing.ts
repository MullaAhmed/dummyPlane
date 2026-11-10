/** How long after a key pressed in a field or a terminal the user still counts as typing. */
export const TYPING_MS = 3000;

const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

let lastKey = -Infinity;

const isField = (target: EventTarget | null): target is Element => target instanceof Element && target.matches(FIELD);

// Capture phase and for the page's life: a key is seen before the field or xterm handles it, and nothing needs to be asked for it.
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (event) => {
      if (isField(event.target)) lastKey = Date.now();
    },
    true,
  );
}

/** How long after the last key a focused field that holds an unsent draft still counts as being written in. */
export const DRAFT_MS = 10_000;

/** The inputs that hold no text: a focused checkbox or button has no draft. */
const NO_TEXT_INPUT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"]);

/** When the last key went to a field or a terminal, in ms; -Infinity when none has since the page loaded. */
export function lastKeyTime(): number {
  return lastKey;
}

/** The focused element is a text field (not a terminal) that holds some text: one that was sent or never written in is empty. */
function holdsDraft(active: Element | null): boolean {
  if (!active || !isField(active) || active.closest(".xterm")) return false;
  if (active instanceof HTMLInputElement) return !NO_TEXT_INPUT.has(active.type) && active.value.trim() !== "";
  if (active instanceof HTMLTextAreaElement) return active.value.trim() !== "";
  if (active instanceof HTMLSelectElement) return false;
  return (active.textContent ?? "").trim() !== "";
}

/**
 * The user is writing something, in the narrower sense of what must not be cut across by a jump the app makes
 * on its own: keys are flowing (the last one under 3 s ago), or a focused text field holds an unsent draft and
 * the last key is under 10 s old. A field that merely rests focused (the command bar after sending, an empty
 * name) does not count, nor does a draft left alone for 10 s: the user looked away from it.
 */
export function userIsWriting(now = Date.now()): boolean {
  const since = now - lastKey;
  return since < TYPING_MS || (since < DRAFT_MS && holdsDraft(document.activeElement));
}

/**
 * The user is typing: a key went to a field or a terminal a moment ago, or the keyboard sits in a field
 * (the command bar, a dialog, a name being edited). A terminal that merely holds the keyboard does not count:
 * it holds it for as long as nobody clicks elsewhere.
 */
export function userIsTyping(now = Date.now()): boolean {
  if (now - lastKey < TYPING_MS) return true;
  const active = document.activeElement;
  return isField(active) && !active.closest(".xterm");
}
