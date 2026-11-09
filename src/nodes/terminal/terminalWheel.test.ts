// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { keepTerminalWheel, routeWheel, takeWholeLines, wheelLines, type WheelFacts, type WheelTerminal } from "./terminalWheel";

const plain: WheelFacts = {
  overTerminal: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  onViewport: false,
  interactive: false,
};

describe("routeWheel", () => {
  it("scrolls the scrollback for a plain wheel over a terminal, active or not", () => {
    expect(routeWheel(plain)).toBe("scrollback");
  });

  it("lets the native viewport scroll when the wheel lands on it", () => {
    expect(routeWheel({ ...plain, onViewport: true })).toBe("native");
  });

  it("hands the wheel to xterm on the alternate screen or with mouse tracking", () => {
    expect(routeWheel({ ...plain, interactive: true })).toBe("forward");
    expect(routeWheel({ ...plain, interactive: true, onViewport: true })).toBe("forward");
  });

  it("keeps ctrl, meta and shift wheels for the canvas (zoom, horizontal pan)", () => {
    expect(routeWheel({ ...plain, ctrlKey: true })).toBe("ignore");
    expect(routeWheel({ ...plain, metaKey: true })).toBe("ignore");
    expect(routeWheel({ ...plain, shiftKey: true })).toBe("ignore");
    expect(routeWheel({ ...plain, ctrlKey: true, interactive: true })).toBe("ignore");
  });

  it("leaves wheels that are not over a terminal to the canvas", () => {
    expect(routeWheel({ ...plain, overTerminal: false })).toBe("ignore");
  });
});

describe("wheelLines", () => {
  it("converts pixels at xterm's 40px per line, lines and pages as they are", () => {
    expect(wheelLines(40, 0, 24)).toBe(1);
    expect(wheelLines(-80, 0, 24)).toBe(-2);
    expect(wheelLines(3, 1, 24)).toBe(3);
    expect(wheelLines(1, 2, 24)).toBe(24);
  });
});

describe("takeWholeLines", () => {
  it("keeps the fraction of small trackpad deltas for the next event", () => {
    const first = takeWholeLines(0, 0.5);
    expect(first).toEqual({ lines: 0, carry: 0.5 });
    const second = takeWholeLines(first.carry, 0.5);
    expect(second.lines).toBe(1);
    expect(second.carry).toBeCloseTo(0);
  });
});

describe("keepTerminalWheel", () => {
  function setup(interactive = false) {
    // #pixels stands for the canvas Excalidraw paints under an inactive embeddable; #inner for xterm's canvas inside the terminal.
    document.body.innerHTML =
      '<div class="excalidraw"><div id="root"><canvas id="inner"></canvas></div><canvas id="pixels"></canvas><div id="xterm"></div></div>';
    const container = document.querySelector<HTMLElement>(".excalidraw")!;
    const root = document.getElementById("root")!;
    root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100 }) as DOMRect;
    const xtermElement = document.getElementById("xterm")!;
    const xtermWheel = vi.fn();
    xtermElement.addEventListener("wheel", xtermWheel);
    const term = {
      rows: 24,
      element: xtermElement,
      buffer: { active: { type: interactive ? "alternate" : "normal" } },
      modes: { mouseTrackingMode: "none" },
      scrollLines: vi.fn(),
    } as unknown as WheelTerminal & { scrollLines: ReturnType<typeof vi.fn> };
    // Stands in for Excalidraw's own handler: it pans when the target is its canvas.
    const pan = vi.fn();
    container.addEventListener("wheel", (event) => {
      if (event.target instanceof HTMLCanvasElement) pan();
    });
    const stop = keepTerminalWheel(root, container, () => term);
    const wheel = (target: Element, init: WheelEventInit & { clientX?: number; clientY?: number } = {}) => {
      const { clientX = 10, clientY = 10, ctrlKey = false, metaKey = false, shiftKey = false, ...rest } = init;
      const event = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true, ...rest });
      // happy-dom's WheelEvent is a UIEvent and drops the pointer and modifier state: set them as a browser's MouseEvent would have.
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        ctrlKey: { value: ctrlKey },
        metaKey: { value: metaKey },
        shiftKey: { value: shiftKey },
      });
      target.dispatchEvent(event);
      return event;
    };
    return { container, root, term, xtermWheel, pan, stop, wheel };
  }

  it("scrolls the scrollback, and the canvas does not pan, for a plain wheel over an inactive terminal", () => {
    const { term, pan, wheel } = setup();
    const event = wheel(document.getElementById("pixels")!);
    expect(term.scrollLines).toHaveBeenCalledWith(1);
    expect(pan).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("scrolls the scrollback for a plain wheel over an active terminal's own canvas", () => {
    const { term, pan, wheel } = setup();
    wheel(document.getElementById("inner")!);
    expect(term.scrollLines).toHaveBeenCalledWith(1);
    expect(pan).not.toHaveBeenCalled();
  });

  it("lets the canvas pan for a wheel outside the terminal", () => {
    const { term, pan, wheel } = setup();
    wheel(document.getElementById("pixels")!, { clientX: 500, clientY: 500 });
    expect(term.scrollLines).not.toHaveBeenCalled();
    expect(pan).toHaveBeenCalledTimes(1);
  });

  it("keeps ctrl+wheel over the terminal for the canvas zoom", () => {
    const { term, pan, wheel } = setup();
    const event = wheel(document.getElementById("pixels")!, { ctrlKey: true });
    expect(term.scrollLines).not.toHaveBeenCalled();
    expect(pan).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("forwards to xterm once on the alternate screen, without the canvas panning or the event looping", () => {
    const { term, xtermWheel, pan, wheel } = setup(true);
    wheel(document.getElementById("pixels")!);
    expect(xtermWheel).toHaveBeenCalledTimes(1);
    expect(term.scrollLines).not.toHaveBeenCalled();
    expect(pan).not.toHaveBeenCalled();
  });

  it("stops listening after cleanup", () => {
    const { term, pan, stop, wheel } = setup();
    stop();
    wheel(document.getElementById("pixels")!);
    expect(term.scrollLines).not.toHaveBeenCalled();
    expect(pan).toHaveBeenCalledTimes(1);
  });
});
