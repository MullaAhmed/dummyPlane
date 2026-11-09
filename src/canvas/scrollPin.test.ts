// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinCanvasScroll } from "./scrollPin";

// The shell: an `overflow: hidden` root that fills the window, Excalidraw's container in it.
let root: HTMLDivElement;
let container: HTMLDivElement;
let viewport: HTMLDivElement;
const refresh = vi.fn();
let stop: () => void;

beforeEach(() => {
  refresh.mockClear();
  document.body.innerHTML =
    '<div id="root" style="overflow:hidden"><div class="excalidraw excalidraw-container"><div class="xterm-viewport"></div></div></div>';
  root = document.querySelector<HTMLDivElement>("#root")!;
  container = document.querySelector<HTMLDivElement>(".excalidraw-container")!;
  viewport = document.querySelector<HTMLDivElement>(".xterm-viewport")!;
  stop = pinCanvasScroll(refresh);
});
afterEach(() => {
  stop();
  document.body.replaceChildren();
});

/** What the browser does to reveal a focused or edited field: scrolls the box, then fires a non-bubbling `scroll`. */
function scrollBy(element: Element, top: number, left = 0) {
  element.scrollTop = top;
  element.scrollLeft = left;
  element.dispatchEvent(new Event("scroll"));
}

describe("pinCanvasScroll", () => {
  it("puts a hidden-overflow box holding the canvas back at 0 and has Excalidraw re-read its offsets", () => {
    // An xterm textarea at a cursor below the window's edge (after a resize): revealing it scrolls the root.
    scrollBy(root, 40, 12);
    expect(root.scrollTop).toBe(0);
    expect(root.scrollLeft).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("also unscrolls Excalidraw's own container, whose canvas would no longer match its hit tests", () => {
    scrollBy(container, 30);
    expect(container.scrollTop).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("leaves the boxes inside the canvas that scroll for real (a terminal's scrollback)", () => {
    scrollBy(viewport, 200);
    expect(viewport.scrollTop).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores a scroll that already sits at 0", () => {
    scrollBy(root, 0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops once released", () => {
    stop();
    scrollBy(root, 40);
    expect(root.scrollTop).toBe(40);
    expect(refresh).not.toHaveBeenCalled();
  });
});
