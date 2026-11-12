// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  GESTURE_GAP_MS,
  keepTerminalWheel,
  routeWheel,
  sameGesture,
  startsSideways,
  takeWholeLines,
  wheelLines,
  type WheelFacts,
  type WheelTerminal,
} from "./terminalWheel";

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
      '<div class="excalidraw"><div id="root"><canvas id="inner"></canvas></div><canvas id="pixels" class="excalidraw__canvas interactive"></canvas><div id="xterm"></div></div>';
    const container = document.querySelector<HTMLElement>(".excalidraw")!;
    const root = document.getElementById("root")!;
    // Where the terminal's body is on screen; a pan moves it.
    const place = { left: 0, top: 0 };
    root.getBoundingClientRect = () => ({ left: place.left, top: place.top, right: place.left + 100, bottom: place.top + 100, width: 100, height: 100 }) as DOMRect;
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
      if (event.target instanceof HTMLCanvasElement) pan(event.target.id);
    });
    const stop = keepTerminalWheel(root, container, () => term);
    const wheel = (target: Element, init: WheelEventInit & { clientX?: number; clientY?: number; time?: number } = {}) => {
      const { clientX = 10, clientY = 10, ctrlKey = false, metaKey = false, shiftKey = false, time = 0, ...rest } = init;
      const event = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true, ...rest });
      // happy-dom's WheelEvent is a UIEvent and drops the pointer and modifier state: set them as a browser's MouseEvent would have.
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        ctrlKey: { value: ctrlKey },
        metaKey: { value: metaKey },
        shiftKey: { value: shiftKey },
        timeStamp: { value: time },
      });
      target.dispatchEvent(event);
      return event;
    };
    return { container, root, place, term, xtermWheel, pan, stop, wheel };
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

  it("keeps panning the canvas when a terminal slides under the still pointer mid-gesture (trackpad pan, momentum)", () => {
    const { term, place, pan, wheel } = setup();
    const pixels = document.getElementById("pixels")!;
    wheel(pixels, { clientX: 500, clientY: 500, time: 1000 });
    // The pan brought the terminal under the pointer: the rest of the gesture still pans.
    place.left = 450;
    place.top = 450;
    for (let i = 1; i <= 20; i++) wheel(pixels, { clientX: 500, clientY: 500, time: 1000 + i * 16 });
    expect(term.scrollLines).not.toHaveBeenCalled();
    expect(pan).toHaveBeenCalledTimes(21);
    // A new gesture, after a pause, is the terminal's.
    wheel(pixels, { clientX: 500, clientY: 500, time: 1000 + 20 * 16 + GESTURE_GAP_MS + 1 });
    expect(term.scrollLines).toHaveBeenCalledWith(1);
    expect(pan).toHaveBeenCalledTimes(21);
  });

  it("keeps scrolling the terminal for the rest of a gesture begun over it", () => {
    const { term, place, pan, wheel } = setup();
    const pixels = document.getElementById("pixels")!;
    wheel(pixels, { time: 1000 });
    place.left = 200;
    wheel(pixels, { time: 1016 });
    expect(term.scrollLines).toHaveBeenCalledTimes(2);
    expect(pan).not.toHaveBeenCalled();
  });

  it("decides again once the pointer moves: a mouse brought over the terminal scrolls it", () => {
    const { term, pan, wheel } = setup();
    const pixels = document.getElementById("pixels")!;
    wheel(pixels, { clientX: 500, clientY: 500, time: 1000 });
    wheel(pixels, { clientX: 10, clientY: 10, time: 1016 });
    expect(pan).toHaveBeenCalledTimes(1);
    expect(term.scrollLines).toHaveBeenCalledWith(1);
  });

  it("pans the canvas for a gesture that starts sideways over a terminal, all of it", () => {
    const { term, pan, wheel } = setup();
    const pixels = document.getElementById("pixels")!;
    const sideways = wheel(pixels, { deltaX: 30, deltaY: 4, time: 1000 });
    wheel(pixels, { deltaX: 2, deltaY: 40, time: 1016 });
    expect(term.scrollLines).not.toHaveBeenCalled();
    expect(pan).toHaveBeenCalledTimes(2);
    expect(sideways.defaultPrevented).toBe(false);
  });

  it("zooms the canvas on ctrl+wheel even in the middle of a terminal's gesture", () => {
    const { term, pan, wheel } = setup();
    const pixels = document.getElementById("pixels")!;
    wheel(pixels, { time: 1000 });
    const pinch = wheel(pixels, { ctrlKey: true, time: 1016 });
    expect(term.scrollLines).toHaveBeenCalledTimes(1);
    expect(pan).toHaveBeenCalledTimes(1);
    expect(pinch.defaultPrevented).toBe(false);
  });

  it("hands the canvas's gesture to Excalidraw's canvas when the active terminal comes under the pointer", () => {
    const { root, term, place, pan, wheel } = setup();
    const reachedTerminal = vi.fn();
    root.addEventListener("wheel", reachedTerminal);
    wheel(document.getElementById("pixels")!, { clientX: 500, clientY: 500, time: 1000 });
    place.left = 450;
    place.top = 450;
    // The active terminal takes the pointer: the wheel's target is now inside it.
    const over = wheel(document.getElementById("inner")!, { clientX: 500, clientY: 500, time: 1016 });
    expect(term.scrollLines).not.toHaveBeenCalled();
    expect(reachedTerminal).not.toHaveBeenCalled();
    expect(over.defaultPrevented).toBe(true);
    expect(pan.mock.calls).toEqual([["pixels"], ["pixels"]]);
  });

  it("listens once per canvas, whatever its number of terminals, and hands a gesture whose terminal left to the canvas", () => {
    document.body.innerHTML = '<div class="excalidraw"><div id="a"></div><div id="b"></div><canvas id="pixels"></canvas></div>';
    const container = document.querySelector<HTMLElement>(".excalidraw")!;
    const add = vi.spyOn(container, "addEventListener");
    const remove = vi.spyOn(container, "removeEventListener");
    const a = document.getElementById("a")!;
    const b = document.getElementById("b")!;
    a.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) as DOMRect;
    b.getBoundingClientRect = () => ({ left: 200, top: 0, right: 300, bottom: 100, width: 100, height: 100 }) as DOMRect;
    const terminal = () =>
      ({ rows: 24, element: null, buffer: { active: { type: "normal" } }, modes: { mouseTrackingMode: "none" }, scrollLines: vi.fn() }) as unknown as WheelTerminal;
    const termA = terminal();
    const stopA = keepTerminalWheel(a, container, () => termA);
    const stopB = keepTerminalWheel(b, container, terminal);
    expect(add.mock.calls.filter(([type]) => type === "wheel")).toHaveLength(1);
    const wheelAt = (time: number) => {
      const event = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true });
      Object.defineProperties(event, { clientX: { value: 10 }, clientY: { value: 10 }, timeStamp: { value: time } });
      document.getElementById("pixels")!.dispatchEvent(event);
      return event;
    };
    wheelAt(1000);
    expect(termA.scrollLines).toHaveBeenCalledTimes(1);
    // Its node leaves in the middle of the gesture: the rest of it is the canvas's.
    stopA();
    expect(wheelAt(1016).defaultPrevented).toBe(false);
    expect(termA.scrollLines).toHaveBeenCalledTimes(1);
    stopB();
    expect(remove.mock.calls.filter(([type]) => type === "wheel")).toHaveLength(1);
  });
});

describe("sameGesture", () => {
  const at = (time: number, x = 10, y = 10) => ({ time, x, y });

  it("goes on while the events follow each other, the pointer still", () => {
    expect(sameGesture(at(1000), at(1016))).toBe(true);
    expect(sameGesture(at(1000), at(1000 + GESTURE_GAP_MS))).toBe(true);
    expect(sameGesture(at(1000), at(1016, 13, 7))).toBe(true);
  });

  it("ends after a pause, once the pointer moves, or with no gesture before", () => {
    expect(sameGesture(at(1000), at(1001 + GESTURE_GAP_MS))).toBe(false);
    expect(sameGesture(at(1000), at(1016, 30, 10))).toBe(false);
    expect(sameGesture(undefined, at(1000))).toBe(false);
    // A clock that went back is no proof of a gesture going on.
    expect(sameGesture(at(1000), at(900))).toBe(false);
  });
});

describe("startsSideways", () => {
  it("tells a sideways swipe from a vertical one", () => {
    expect(startsSideways(30, 4)).toBe(true);
    expect(startsSideways(-30, 4)).toBe(true);
    expect(startsSideways(4, 30)).toBe(false);
    expect(startsSideways(0, 0)).toBe(false);
  });
});
