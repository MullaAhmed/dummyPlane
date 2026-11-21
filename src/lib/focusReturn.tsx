import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * What has the keyboard now, where a surface that opens gives it back when it closes. A menu's item stands for
 * the menu's trigger (Radix labels a menu by its trigger, a submenu by the item that opened it): the item goes with
 * its menu, the trigger stays. Null when the page itself has it.
 */
export function focusOpener(doc: Document = document): HTMLElement | null {
  let element = doc.activeElement;
  for (let hops = 0; hops < 4 && element; hops++) {
    const menu = element.closest('[role="menu"][aria-labelledby]');
    const trigger = menu ? doc.getElementById(menu.getAttribute("aria-labelledby") ?? "") : null;
    if (!trigger || trigger === element) break;
    element = trigger;
  }
  return element instanceof HTMLElement && element !== doc.body ? element : null;
}

/** Nothing holds the keyboard: the page has it, an element gone had it, or the surface that closes has it. */
function keyboardLost(surface: Element | null, doc: Document): boolean {
  const active = doc.activeElement;
  return !active || active === doc.body || !active.isConnected || (surface?.contains(active) ?? false);
}

/**
 * Gives the keyboard back to `opener` as `surface` closes, without scrolling (an xterm's textarea can sit below the
 * window's edge), unless something else took it meanwhile: a terminal a launch gave it to, a field, a click
 * elsewhere. True when the keyboard is where it belongs, back on the opener or kept by what took it; false when the
 * opener is gone or cannot take it, for the caller's fallback.
 */
export function returnFocus(opener: HTMLElement | null, surface: Element | null = null, doc: Document = document): boolean {
  if (!keyboardLost(surface, doc)) return true;
  if (!opener?.isConnected) return false;
  opener.focus({ preventScroll: true });
  return doc.activeElement === opener;
}

/**
 * Remembers, as a surface's content mounts, what had the keyboard: read while rendering, before a field of the
 * content takes it (`autoFocus`, or the content's own first focus). Rendered first in the content, it draws nothing.
 */
export function RememberOpener({ into }: { into: RefObject<HTMLElement | null> }) {
  const [opener] = useState(() => focusOpener());
  useLayoutEffect(() => {
    into.current = opener;
  }, [into, opener]);
  return null;
}

/**
 * A Radix `onCloseAutoFocus` that gives the keyboard back to the opener `RememberOpener` kept, after the surface's own
 * handler, which may take the matter in hand (`preventDefault`). An opener gone leaves Radix's default: its trigger.
 */
export function closeAutoFocusTo(opener: RefObject<HTMLElement | null>, own?: (event: Event) => void) {
  return (event: Event) => {
    own?.(event);
    if (event.defaultPrevented) return;
    if (returnFocus(opener.current)) event.preventDefault();
  };
}

/** The opener of a surface that mounts with this hook (the git window, the review panel): read once, at its first render. */
export function useOpener(): HTMLElement | null {
  const [opener] = useState(() => focusOpener());
  return opener;
}
