/** What the Tab key can stop on (a disabled control included: it is put back as it was). */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable=""], [contenteditable="true"]';
/** An element's own tabindex while it is withdrawn ("" when it had none), to put back. */
const SAVED = "data-dp-tabindex";

/** Takes one element out of the Tab order, if it is a stop, remembering its own tabindex. */
function withdraw(element: Element) {
  if (!(element instanceof HTMLElement) || !element.matches(FOCUSABLE) || element.tabIndex < 0) return;
  // A stop again while withdrawn (React set or removed a tabindex of its own): what it set is what goes back.
  element.setAttribute(SAVED, element.getAttribute("tabindex") ?? "");
  element.tabIndex = -1;
}

function withdrawAll(root: Element) {
  withdraw(root);
  for (const element of root.querySelectorAll(FOCUSABLE)) withdraw(element);
}

function restoreAll(root: Element) {
  for (const element of root.querySelectorAll(`[${SAVED}]`)) {
    const own = element.getAttribute(SAVED)!;
    element.removeAttribute(SAVED);
    if (own === "") element.removeAttribute("tabindex");
    else element.setAttribute("tabindex", own);
  }
}

/**
 * Keeps what `root` holds out of the Tab order: a node of the canvas that is not the active one (NodeHost).
 * Excalidraw draws the nodes inside its own box, ahead of the rails in the page, and lets the pointer into
 * the active one only: their header buttons and xterm fields were the first ~35 stops of the Tab order.
 * They still take the keyboard when the app gives it (an arrival, a click on a control): `tabindex="-1"`
 * keeps an element focusable. What mounts meanwhile is withdrawn as it comes. The function returned puts
 * every stop back as it was.
 */
export function keepOutOfTabOrder(root: Element): () => void {
  withdrawAll(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") {
        for (const added of record.addedNodes) if (added instanceof Element) withdrawAll(added);
        continue;
      }
      const element = record.target as Element;
      // The page set a tabindex of its own on a withdrawn element (a roving one moved): that one goes back.
      if (record.attributeName === "tabindex" && element.hasAttribute(SAVED)) element.setAttribute(SAVED, element.getAttribute("tabindex") ?? "");
      withdraw(element);
    }
    // What this handler wrote is not the page's.
    observer.takeRecords();
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["tabindex", "href", "contenteditable"] });
  return () => {
    observer.disconnect();
    restoreAll(root);
  };
}
