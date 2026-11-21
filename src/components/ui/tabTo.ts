/**
 * For the tests: gives `element` the keyboard as Tab does, the key first. A hint opens on a focus only when
 * Tab, Shift+Tab or an arrow brought it (TooltipTrigger), never on a bare `focus()`, which is a focus handed back.
 */
export function tabTo(element: HTMLElement) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  element.focus();
}
