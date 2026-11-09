/**
 * Keeps the canvas where Excalidraw believes it is.
 *
 * The canvas fills the window under `overflow: hidden` boxes (the project
 * view, Excalidraw's own container). A browser still scrolls such a box to
 * reveal a focused or edited field: an xterm's helper textarea sits at the
 * terminal's cursor, below the window's edge once the window got smaller, and
 * focusing it, pasting or composing (IME) there scrolls the box. Excalidraw
 * re-reads its offsets only on a resize and on the scroll of an `overflow:
 * auto` box, so its hit tests then miss by the scrolled distance: a click on
 * a terminal no longer activates nor selects it (no input, Send stays grey).
 *
 * Puts every scrolled box that holds the canvas back at 0, then has
 * Excalidraw re-read its offsets (`refresh`). The boxes inside the canvas
 * that scroll for real (a terminal's scrollback, a list) are left alone.
 * Returns a function that stops watching.
 */
export function pinCanvasScroll(refresh: () => void, doc: Document = document): () => void {
  const listener = (event: Event) => {
    // A scroll of the page itself fires on the document.
    const box = event.target === doc ? doc.scrollingElement : event.target;
    const canvas = doc.querySelector(".excalidraw-container");
    if (!(box instanceof Element) || !canvas || !box.contains(canvas)) return;
    if (box.scrollTop === 0 && box.scrollLeft === 0) return;
    box.scrollTop = 0;
    box.scrollLeft = 0;
    refresh();
  };
  // `scroll` does not bubble: only the capture phase hears every box.
  doc.addEventListener("scroll", listener, { capture: true, passive: true });
  return () => doc.removeEventListener("scroll", listener, { capture: true });
}
