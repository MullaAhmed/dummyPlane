// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { agentsStore } from "@/agents/agentsStore";
import { arrangeAs } from "@/agents/arrangeAs";
import { launchAt } from "@/agents/quickActions";
import { requestClose } from "@/agents/terminals";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { openNativeMenuAt } from "./bridges";
import { installRadial } from "./install";
import { radialStore } from "./radialState";
import { ARC_INTENT_MS } from "./arc";
import { arcAngle } from "./gesture";
import { reviewStore } from "@/review/reviewStore";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/agents/arrangeAs", () => ({ arrangeAs: vi.fn() }));
vi.mock("@/agents/quickActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/agents/quickActions")>()),
  launchAt: vi.fn(),
}));
vi.mock("@/agents/terminals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/agents/terminals")>()),
  requestClose: vi.fn(),
}));

const rect = { id: "r1", type: "rectangle", x: 100, y: 100, width: 100, height: 80, angle: 0, strokeWidth: 2, isDeleted: false, frameId: null, groupIds: [], containerId: null } as unknown as ExcalidrawElement;
const updateScene = vi.fn();
let uninstall: () => void;

/** The agents a look finds on this machine. */
const FOUND = [
  { id: "claude", available: true },
  { id: "codex", available: true },
  { id: "shell", available: true },
];

beforeAll(async () => {
  mockIPC((cmd) => {
    if (cmd === "list_agents") return FOUND;
    if (cmd === "list_shells") return [];
  });
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
});
beforeEach(() => {
  document.body.innerHTML =
    '<div class="excalidraw"><div class="excalidraw-container" tabindex="0"><canvas class="excalidraw__canvas interactive"></canvas><div id="ex-frame-name-g1"><span id="dot"></span></div><div class="excalidraw__embeddable-container"><div data-terminal="batman"><div class="xterm"><span id="text">PS C:\\&gt;</span></div><input id="name" /></div></div></div></div>';
  updateScene.mockClear();
  canvasStore.setState({
    api: { getSceneElements: () => [rect], getAppState: () => ({ selectedElementIds: {} }), updateScene } as unknown as ExcalidrawImperativeAPI,
    view: { scrollX: 0, scrollY: 0, zoom: 1, width: 1000, height: 800, offsetLeft: 0, offsetTop: 0, tool: "selection", selectedIds: [], editingFrame: null, mode: null },
    frames: [],
    nodeIds: ["batman"],
  });
  projectsStore.setState({ view: "project" } as never);
  workspacesStore.setState({ status: "ready", activeId: "w1" } as never);
  radialStore.setState({ ring: null });
  uninstall = installRadial(window);
});
afterEach(() => uninstall());

const pointer = (target: Element, type: string, x: number, y: number, button = 2) => {
  const event = new PointerEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
const canvas = () => document.querySelector("canvas")!;
const text = () => document.getElementById("text")!;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

describe("opening the ring", () => {
  it("opens the terminal's ring on a right press in its text, the press kept from xterm", () => {
    const xterm = vi.fn();
    text().addEventListener("pointerdown", xterm);
    const press = pointer(text(), "pointerdown", 300, 300);
    expect(xterm).not.toHaveBeenCalled();
    expect(press.defaultPrevented).toBe(true);
    expect(radialStore.getState().ring).toMatchObject({ kind: "terminal", client: { x: 300, y: 300 }, context: { terminalId: "batman", at: { x: 300, y: 300 } } });
  });

  describe("a terminal of a multi-selection", () => {
    const selecting = (selected: Record<string, boolean>) =>
      canvasStore.setState({ api: { getSceneElements: () => [rect], getAppState: () => ({ selectedElementIds: selected }), updateScene } as unknown as ExcalidrawImperativeAPI });

    it("opens the selection's ring, not its own, and keeps the selection (so Group takes them all)", () => {
      selecting({ batman: true, r1: true });
      pointer(text(), "pointerdown", 300, 300);
      expect(radialStore.getState().ring).toMatchObject({ kind: "selection", context: { selectionIds: ["batman", "r1"], at: { x: 300, y: 300 } } });
      expect(updateScene).toHaveBeenCalledTimes(2);
      expect(updateScene).toHaveBeenCalledWith({ appState: { activeEmbeddable: null } });
      expect(updateScene).not.toHaveBeenCalledWith(expect.objectContaining({ appState: expect.objectContaining({ selectedElementIds: expect.anything() }) }));
    });

    it("keeps the terminal's own ring when it is the only one selected, or is not in the selection", () => {
      selecting({ batman: true });
      pointer(text(), "pointerdown", 300, 300);
      expect(radialStore.getState().ring).toMatchObject({ kind: "terminal", context: { terminalId: "batman" } });
      radialStore.setState({ ring: null });
      selecting({ r1: true, other: true });
      pointer(text(), "pointerdown", 300, 300);
      expect(radialStore.getState().ring).toMatchObject({ kind: "terminal", context: { terminalId: "batman" } });
    });
  });

  it("closes Excalidraw's own menu and the open dropdowns when the ring opens", () => {
    document.body.insertAdjacentHTML("beforeend", '<div role="menu" data-state="open"></div>');
    const escapes: string[] = [];
    document.addEventListener("keydown", (e) => escapes.push(e.key), { once: true });
    pointer(canvas(), "pointerdown", 500, 400);
    expect(escapes).toEqual(["Escape"]);
    expect(updateScene).toHaveBeenCalledWith({ appState: { contextMenu: null } });
    expect(radialStore.getState().ring).not.toBeNull();
    document.querySelector('[role="menu"]')!.remove();
  });

  it("opens the canvas ring on the empty canvas, at the scene point of the click", () => {
    pointer(canvas(), "pointerdown", 500, 400);
    expect(radialStore.getState().ring).toMatchObject({ kind: "canvas", context: { at: { x: 500, y: 400 } } });
  });

  it("selects a drawing alone before opening its ring", () => {
    pointer(canvas(), "pointerdown", 150, 140);
    expect(radialStore.getState().ring!.kind).toBe("selection");
    expect(updateScene).toHaveBeenCalledWith({ appState: { selectedElementIds: { r1: true }, selectedGroupIds: {}, activeEmbeddable: null } });
  });

  it("selects a group of drawings whole, as Excalidraw does (final review)", () => {
    const a = { ...rect, id: "a", groupIds: ["g"] };
    const b = { ...rect, id: "b", x: 400, groupIds: ["g"] };
    canvasStore.setState({ api: { getSceneElements: () => [a, b], getAppState: () => ({ selectedElementIds: {} }), updateScene } as unknown as ExcalidrawImperativeAPI });
    pointer(canvas(), "pointerdown", 150, 140);
    expect(updateScene).toHaveBeenCalledWith({ appState: { selectedElementIds: { a: true, b: true }, selectedGroupIds: { g: true }, activeEmbeddable: null } });
  });

  it("opens a group's ring on Excalidraw's name of its frame, whose own menu never opens (final review)", () => {
    canvasStore.setState({ frames: [{ id: "g1", name: "Serveurs", x: 0, y: 0, width: 10, height: 10, group: { role: "backend", pantheon: "egypt" }, memberIds: [] }] });
    pointer(document.getElementById("dot")!, "pointerdown", 20, 20);
    expect(radialStore.getState().ring).toMatchObject({ kind: "group", context: { groupId: "g1" } });
    radialStore.setState({ ring: null });
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.getElementById("dot")!.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it("keeps the native behavior in a text field", () => {
    const name = document.getElementById("name")!;
    pointer(name, "pointerdown", 10, 10);
    expect(radialStore.getState().ring).toBeNull();
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    name.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  });

  it("blocks the native menu on the canvas, lets More… through", () => {
    const excalidraw = vi.fn();
    canvas().addEventListener("contextmenu", excalidraw);
    const blocked = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    canvas().dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);
    expect(excalidraw).not.toHaveBeenCalled();
    openNativeMenuAt({ x: 1, y: 1 });
    expect(excalidraw).toHaveBeenCalledTimes(1);
  });
});

describe("choosing in the ring", () => {
  it("runs the slot a slide points at when the right button comes up, a frame after the ring left (Fermer, below)", async () => {
    pointer(text(), "pointerdown", 300, 300);
    pointer(text(), "pointermove", 300, 380);
    expect(radialStore.getState().ring!.hovered).toBe(4);
    pointer(text(), "pointerup", 300, 380);
    expect(radialStore.getState().ring).toBeNull();
    expect(requestClose).not.toHaveBeenCalled();
    await nextFrame();
    expect(requestClose).toHaveBeenCalledWith("batman");
  });

  it("points at nothing for a jitter when the ring moved off the window's edge (final review)", () => {
    pointer(canvas(), "pointerdown", window.innerWidth - 14, 400);
    pointer(canvas(), "pointermove", window.innerWidth - 14, 412);
    expect(radialStore.getState().ring).toMatchObject({ sliding: true, hovered: null });
  });

  it("swallows the one contextmenu that follows a slide, wherever the slide ends (final review)", async () => {
    const outside = document.createElement("div");
    document.body.append(outside);
    pointer(text(), "pointerdown", 300, 300);
    pointer(text(), "pointermove", 300, 380);
    pointer(text(), "pointerup", 300, 380);
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    outside.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    const later = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    outside.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
    await nextFrame();
  });

  it("chooses nothing when a slide comes back over the hub", () => {
    pointer(text(), "pointerdown", 300, 300);
    pointer(text(), "pointermove", 300, 380);
    pointer(text(), "pointermove", 300, 340);
    expect(radialStore.getState().ring).toMatchObject({ sliding: true, hovered: null });
    pointer(text(), "pointerup", 300, 340);
    expect(radialStore.getState().ring).toBeNull();
  });

  it("turns the wedge pointed at with the arrows, runs it on Enter, the keys kept from the terminal (Tangerine's keys)", async () => {
    vi.mocked(requestClose).mockClear();
    pointer(text(), "pointerdown", 300, 300);
    pointer(text(), "pointerup", 300, 300);
    const xterm = vi.fn();
    text().addEventListener("keydown", xterm);
    const key = (name: string) => {
      const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
      text().dispatchEvent(event);
      return event;
    };
    expect(key("ArrowRight").defaultPrevented).toBe(true);
    expect(radialStore.getState().ring!.hovered).toBe(0);
    key("ArrowLeft");
    expect(radialStore.getState().ring!.hovered).toBe(7);
    key("ArrowLeft");
    key("ArrowLeft");
    key("ArrowUp");
    key("ArrowDown");
    expect(radialStore.getState().ring!.hovered).toBe(5);
    key("ArrowLeft");
    // « Close », clockwise at the bottom.
    expect(radialStore.getState().ring!.hovered).toBe(4);
    expect(xterm).not.toHaveBeenCalled();
    key("Enter");
    expect(radialStore.getState().ring).toBeNull();
    await nextFrame();
    expect(requestClose).toHaveBeenCalledWith("batman");
    // Closed, the ring lets the keys go by again.
    expect(key("ArrowRight").defaultPrevented).toBe(false);
    expect(xterm).toHaveBeenCalledTimes(1);
  });

  it("keeps Enter on a greyed wedge from running or going to the terminal; lets it go when nothing is pointed at", () => {
    pointer(text(), "pointerdown", 300, 300);
    pointer(text(), "pointerup", 300, 300);
    const enter = () => {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      text().dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(enter()).toBe(false);
    // « Copy », at the top: nothing is selected in the terminal.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(enter()).toBe(true);
    expect(radialStore.getState().ring).toMatchObject({ hovered: 0 });
  });

  it("stays open after a short right click; Escape, the wheel or a press outside close it", () => {
    const open = () => {
      pointer(canvas(), "pointerdown", 500, 400);
      pointer(canvas(), "pointerup", 502, 401);
    };
    open();
    expect(radialStore.getState().ring).toMatchObject({ pressed: false, sliding: false });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(radialStore.getState().ring).toBeNull();
    open();
    window.dispatchEvent(new WheelEvent("wheel"));
    expect(radialStore.getState().ring).toBeNull();
    open();
    pointer(canvas(), "pointerdown", 700, 100, 0);
    expect(radialStore.getState().ring).toBeNull();
  });

  it("marks the wheel as turned by the keyboard when the arrows turn it, so its wedges move at once", () => {
    pointer(text(), "pointerdown", 300, 300);
    pointer(text(), "pointerup", 300, 300);
    expect(radialStore.getState().ring!.keyboard).toBeFalsy();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(radialStore.getState().ring).toMatchObject({ hovered: 0, keyboard: true });
  });

  it("ends a press the system took away (pointercancel, the window losing focus): the ring stays, as after a click", () => {
    pointer(canvas(), "pointerdown", 500, 400);
    pointer(canvas(), "pointermove", 560, 400);
    expect(radialStore.getState().ring).toMatchObject({ pressed: true, sliding: true });
    pointer(canvas(), "pointercancel", 560, 400);
    expect(radialStore.getState().ring).toMatchObject({ pressed: false, sliding: false });
    pointer(canvas(), "pointerdown", 500, 400);
    expect(radialStore.getState().ring).toMatchObject({ pressed: true });
    // An element's blur reaches the window's capture listener too: only the window's own counts.
    document.getElementById("name")!.dispatchEvent(new FocusEvent("blur"));
    expect(radialStore.getState().ring).toMatchObject({ pressed: true });
    window.dispatchEvent(new FocusEvent("blur"));
    expect(radialStore.getState().ring).toMatchObject({ pressed: false, sliding: false });
  });
});

describe("the More arc, from the keyboard and by a slide", () => {
  /** A point `radius` from the terminal ring's center (300, 300), toward `degrees` (0 at the right, clockwise). */
  const toward = (degrees: number, radius: number) => ({ x: 300 + radius * Math.cos((degrees * Math.PI) / 180), y: 300 + radius * Math.sin((degrees * Math.PI) / 180) });
  const key = (name: string) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    text().dispatchEvent(event);
    return event;
  };
  const ring = () => radialStore.getState().ring!;
  const openByClick = () => {
    pointer(text(), "pointerdown", 300, 300);
    pointer(text(), "pointerup", 300, 300);
  };
  afterEach(() => vi.useRealTimers());

  it("opens on Enter on More, its first wedge pointed; the arrows move along it, Left or Escape go back to the ring", () => {
    openByClick();
    key("ArrowLeft");
    expect(ring().hovered).toBe(7);
    expect(key("Enter").defaultPrevented).toBe(true);
    expect([ring().arc?.count, ring().item, ring().keyboard]).toEqual([5, 0, true]);
    key("ArrowRight");
    key("ArrowDown");
    expect(ring().item).toBe(2);
    key("ArrowUp");
    expect(ring().item).toBe(1);
    key("ArrowUp");
    key("ArrowUp");
    // Round from the first to the last.
    expect(ring().item).toBe(4);
    key("ArrowLeft");
    expect([ring().arc, ring().item, ring().hovered]).toEqual([null, null, 7]);
    key("Enter");
    expect(key("Escape").defaultPrevented).toBe(true);
    expect([ring().arc, ring().hovered]).toEqual([null, 7]);
    key("Escape");
    expect(radialStore.getState().ring).toBeNull();
  });

  it("runs the arc's wedge on Enter, once the menu has gone; a greyed one keeps the Enter and does nothing", async () => {
    openByClick();
    key("ArrowLeft");
    key("Enter");
    // « Stop the process »: nothing runs.
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(radialStore.getState().ring).not.toBeNull();
    key("ArrowRight");
    key("ArrowRight");
    key("Enter");
    expect(radialStore.getState().ring).toBeNull();
    await nextFrame();
    expect(reviewStore.getState().nodeId).toBe("batman");
  });

  it("opens under a slide that rests on More, then runs the wedge the slide is released on", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    pointer(text(), "pointerdown", 300, 300);
    const more = toward(-135, 100);
    pointer(text(), "pointermove", more.x, more.y);
    expect([ring().hovered, ring().arc ?? null]).toEqual([7, null]);
    vi.advanceTimersByTime(ARC_INTENT_MS);
    const arc = ring().arc!;
    expect(arc.count).toBe(5);
    // On to « Review changes », across the ring's slack.
    const review = toward((arcAngle(arc, 2) * 180) / Math.PI, 190);
    pointer(text(), "pointermove", review.x, review.y);
    expect([ring().item, ring().hovered]).toEqual([2, 7]);
    pointer(text(), "pointerup", review.x, review.y);
    expect(radialStore.getState().ring).toBeNull();
    vi.useRealTimers();
    await nextFrame();
    expect(reviewStore.getState().nodeId).toBe("batman");
  });

  it("opens at once when a slide is released on More, and stays for a click; released on nothing, it closes", () => {
    pointer(text(), "pointerdown", 300, 300);
    const more = toward(-135, 100);
    pointer(text(), "pointermove", more.x, more.y);
    pointer(text(), "pointerup", more.x, more.y);
    expect(ring()).toMatchObject({ pressed: false, sliding: false, hovered: 7 });
    expect(ring().arc).not.toBeNull();
    // A new slide, released past the arc and the ring: nothing chosen, the ring closes.
    pointer(text(), "pointerdown", 300, 300);
    pointer(text(), "pointermove", 300, 300 + 260);
    pointer(text(), "pointerup", 300, 300 + 260);
    expect(radialStore.getState().ring).toBeNull();
  });
});

describe("the arcs of Arrange and Other agent, from the keyboard and by a slide", () => {
  /** A point `radius` from the ring's center (300, 300), toward `degrees` (0 at the right, clockwise). */
  const toward = (degrees: number, radius: number) => ({ x: 300 + radius * Math.cos((degrees * Math.PI) / 180), y: 300 + radius * Math.sin((degrees * Math.PI) / 180) });
  const degreesOf = (radians: number) => (radians * 180) / Math.PI;
  const key = (name: string) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    text().dispatchEvent(event);
    return event;
  };
  const ring = () => radialStore.getState().ring!;
  const click = (target: Element, x: number, y: number) => {
    pointer(target, "pointerdown", x, y);
    pointer(target, "pointerup", x, y);
  };
  beforeEach(() => {
    vi.mocked(arrangeAs).mockClear();
    vi.mocked(launchAt).mockClear();
    agentsStore.setState({ agents: FOUND, loaded: true } as never);
  });
  afterEach(() => vi.useRealTimers());

  it("opens the canvas ring's Arrange on Enter, its first layout pointed; the arrows move along it; Enter arranges once the menu has gone", async () => {
    click(canvas(), 300, 300);
    expect(ring().kind).toBe("canvas");
    key("ArrowLeft");
    key("ArrowLeft");
    key("ArrowLeft");
    expect(ring().hovered).toBe(5);
    expect(key("Enter").defaultPrevented).toBe(true);
    expect([ring().arc?.label, ring().arc?.count, ring().item, ring().arcInstant]).toEqual(["Arrange", 7, 0, true]);
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowUp");
    expect(ring().item).toBe(1);
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(radialStore.getState().ring).toBeNull();
    expect(arrangeAs).not.toHaveBeenCalled();
    await nextFrame();
    expect(arrangeAs).toHaveBeenLastCalledWith("w1", { kind: "scene", only: [] }, "row");
  });

  it("goes back one step on each Escape: from a terminal's layouts to More's arc at Arrange, to the ring at More, then closes", () => {
    click(text(), 300, 300);
    key("ArrowLeft");
    key("Enter");
    // From « Stop the process », round to « Arrange », More's last.
    key("ArrowUp");
    expect([ring().arc?.label, ring().item]).toEqual(["More", 4]);
    key("Enter");
    expect([ring().arc?.label, ring().arc?.count, ring().item, ring().arc?.parent?.item, ring().hovered]).toEqual(["Arrange", 7, 0, 4, 7]);
    expect(key("Escape").defaultPrevented).toBe(true);
    expect([ring().arc?.label, ring().item, ring().hovered]).toEqual(["More", 4, 7]);
    key("Escape");
    expect([ring().arc ?? null, ring().item ?? null, ring().hovered]).toEqual([null, null, 7]);
    key("Escape");
    expect(radialStore.getState().ring).toBeNull();
    expect(arrangeAs).not.toHaveBeenCalled();
  });

  it("keeps Enter on the selection's greyed Arrange: no arc of layouts opens for drawings alone", () => {
    click(canvas(), 150, 140);
    expect(ring().kind).toBe("selection");
    key("ArrowLeft");
    key("ArrowLeft");
    expect(ring().hovered).toBe(6);
    expect(key("Enter").defaultPrevented).toBe(true);
    expect([radialStore.getState().ring !== null, ring().arc ?? null]).toEqual([true, null]);
  });

  it("opens Other agent's arc on Enter and starts the agent picked at the ring's press point", async () => {
    click(canvas(), 300, 300);
    const at = ring().context.at;
    key("ArrowLeft");
    key("ArrowLeft");
    expect(ring().hovered).toBe(6);
    key("Enter");
    expect([ring().arc?.label, ring().arc?.count, ring().item]).toEqual(["Other agent…", 2, 0]);
    key("ArrowRight");
    key("Enter");
    await nextFrame();
    expect(launchAt).toHaveBeenCalledTimes(1);
    expect(launchAt).toHaveBeenLastCalledWith("codex", at);
  });

  it("goes on into a terminal's layouts under a slide, chooses nothing released where they came under it, and arranges in the one the slide moves on to", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const slideToLayouts = () => {
      pointer(text(), "pointerdown", 300, 300);
      const more = toward(-135, 100);
      pointer(text(), "pointermove", more.x, more.y);
      vi.advanceTimersByTime(ARC_INTENT_MS);
      const arrange = toward(degreesOf(arcAngle(ring().arc!, 4)), 190);
      pointer(text(), "pointermove", arrange.x, arrange.y);
      expect(ring().item).toBe(4);
      vi.advanceTimersByTime(ARC_INTENT_MS);
      expect([ring().arc?.label, ring().arc?.parent?.item, ring().item ?? null]).toEqual(["Arrange", 4, null]);
      return arrange;
    };
    const arrange = slideToLayouts();
    // Released where the layouts came under it: nothing chosen, the ring stays for a click.
    pointer(text(), "pointerup", arrange.x + 1, arrange.y);
    expect(ring()).toMatchObject({ pressed: false, sliding: false });
    expect(ring().arc?.label).toBe("Arrange");
    expect(arrangeAs).not.toHaveBeenCalled();
    // A new slide, on to « Tree », the last layout: it arranges.
    slideToLayouts();
    const tree = toward(degreesOf(arcAngle(ring().arc!, 6)), 190);
    pointer(text(), "pointermove", tree.x, tree.y);
    expect(ring().item).toBe(6);
    pointer(text(), "pointerup", tree.x, tree.y);
    expect(radialStore.getState().ring).toBeNull();
    vi.useRealTimers();
    await nextFrame();
    expect(arrangeAs).toHaveBeenLastCalledWith("w1", { kind: "scene", only: [] }, "tree");
  });
});
