// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { pendingUiRequest } from "@/commands/uiRequests";
import { agentsStore } from "@/agents/agentsStore";
import { arrangeAs } from "@/agents/arrangeAs";
import { launchAt } from "@/agents/quickActions";
import { arrangeLayoutStore } from "@/app/arrangeLayoutSetting";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { ARC_INNER, arcAngle, arcPosition, arcWedgePath, HIT_RADIUS, OUTER_RADIUS, POP, slotDirection, slotPosition, wedgePath } from "./gesture";
import { ARC_INTENT_MS, openArc } from "./arc";
import { reviewStore } from "@/review/reviewStore";
import { openRadial, radialStore, updateRadial } from "./radialState";
import { RadialMenu } from "./RadialMenu";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/agents/arrangeAs", () => ({ arrangeAs: vi.fn() }));
vi.mock("@/agents/quickActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/agents/quickActions")>()),
  launchAt: vi.fn(),
}));
vi.mock("@/nodes/terminal/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/nodes/terminal/registry")>()),
  terminalSelection: vi.fn(() => ""),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
/** What the machine answers a look for its agents: null, the look fails. */
let found: { id: string; available: boolean }[] | null = [{ id: "claude", available: true }];
/** The looks made. */
let looks = 0;

beforeAll(async () => {
  mockIPC((cmd) => {
    if (cmd === "list_agents") {
      looks++;
      if (!found) throw new Error("the PATH could not be read");
      return found;
    }
    if (cmd === "list_shells") return [];
  });
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
});
beforeEach(async () => {
  radialStore.setState({ ring: null });
  workspacesStore.setState({ activeId: "w1" } as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<RadialMenu />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const open = () =>
  act(async () =>
    openRadial({
      kind: "terminal",
      client: { x: 300, y: 300 },
      center: { x: 300, y: 300 },
      context: { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "batman", at: { x: 300, y: 300 } },
      pressed: false,
      sliding: false,
      hovered: null,
    }),
  );
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("[data-radial-slot]")];
const hub = () => document.querySelector<HTMLButtonElement>('[aria-label="Close the menu"]')!;
const hit = () => document.querySelector<HTMLElement>("[data-radial-hit]")!;
/** Where a wedge's icon and name sit, from the ring's center: its box is the wheel's, centered on it. */
const labelAt = (button: HTMLButtonElement) => {
  const box = -parseFloat(button.style.left);
  const label = button.querySelector<HTMLElement>(":scope > span")!;
  return { x: parseFloat(label.style.left) - box, y: parseFloat(label.style.top) - box };
};
const pointer = (target: Element, type: string, x: number, y: number) =>
  act(async () => {
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
  });

it("draws the wheel around the click, a wedge per command clockwise from the top", async () => {
  await open();
  expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Quick note on this terminal", "Pause", "More"]);
  expect(buttons().map((b, slot) => b.querySelector("path")!.getAttribute("d") === wedgePath(slot, 8))).toEqual(Array(8).fill(true));
  expect([labelAt(buttons()[0]), labelAt(buttons()[2])]).toEqual([slotPosition(0), slotPosition(2)]);
  expect(document.querySelector<HTMLElement>("[data-radial]")!.style.left).toBe("300px");
});

it("names each wedge under its icon in a word or two; the full name stays the button's", async () => {
  await open();
  expect(buttons().map((b) => b.textContent)).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Note", "Pause", "More"]);
  expect(buttons()[5].getAttribute("aria-label")).toBe("Quick note on this terminal");
});

it("shows the close button in the hub, then the full name of the wedge pointed at", async () => {
  await open();
  expect(hub().textContent).toBe("");
  expect(hub().querySelector("svg")).not.toBeNull();
  await act(async () => updateRadial({ hovered: 3 }));
  expect(hub().textContent).toBe("Restart");
  // Its own name does not change: a click there still closes the menu.
  expect(hub().getAttribute("aria-label")).toBe("Close the menu");
});

it("greys what cannot run; the hub tells the name and why; a click on it does nothing", async () => {
  await open();
  const copy = buttons()[0];
  expect([copy.getAttribute("aria-disabled"), copy.getAttribute("aria-description")]).toEqual(["true", "nothing selected"]);
  await act(async () => updateRadial({ hovered: 0 }));
  expect([...hub().querySelectorAll("span span")].map((s) => s.textContent)).toEqual(["Copy", "Nothing selected"]);
  // Pointed at, it never takes the fill of a wedge that runs.
  expect(copy.querySelector("path")!.getAttribute("class")).not.toMatch(/fill-dp-accent/);
  await act(async () => copy.click());
  expect(radialStore.getState().ring).not.toBeNull();
  await pointer(hit(), "click", 300, 300 - 100);
  expect(radialStore.getState().ring).not.toBeNull();
});

it("points with the mouse by the pointer's place on the wheel, not by the element under it", async () => {
  await open();
  await pointer(hit(), "pointermove", 300 + 100, 300);
  expect(radialStore.getState().ring!.hovered).toBe(2);
  expect(buttons()[2].style.translate).toBe("4px 0px");
  // A gap and the slack past the rim belong to the wedge whose share they are in; the hub to none.
  await pointer(hit(), "pointermove", 300 + 43, 300 - 100);
  expect(radialStore.getState().ring!.hovered).toBe(1);
  await pointer(hit(), "pointermove", 300, 300 + 150);
  expect(radialStore.getState().ring!.hovered).toBe(4);
  await pointer(hub(), "pointermove", 300 + 10, 300);
  expect(radialStore.getState().ring!.hovered).toBeNull();
  await pointer(hit(), "pointermove", 300 - 100, 300);
  await act(async () => {
    hit().dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
  });
  expect(radialStore.getState().ring!.hovered).toBeNull();
});

it("leaves the pointing to the slide while the right button is held", async () => {
  await open();
  await act(async () => updateRadial({ pressed: true, hovered: 5 }));
  await pointer(hit(), "pointermove", 300 + 100, 300);
  expect(radialStore.getState().ring!.hovered).toBe(5);
});

it("runs the wedge a click on the wheel points at, a gap included; the hub closes", async () => {
  await open();
  // In the gap between « Rename » and « Restart », on Rename's side of it.
  const angle = (22 * Math.PI) / 180;
  await pointer(hit(), "click", 300 + 100 * Math.cos(angle), 300 + 100 * Math.sin(angle));
  expect(radialStore.getState().ring).toBeNull();
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(pendingUiRequest()).toEqual({ kind: "renameTerminal", id: "batman" });
  await open();
  await act(async () => hub().click());
  expect(radialStore.getState().ring).toBeNull();
});

it("catches the pointer in a circle, so a click in the corners of its box falls through and closes the ring", async () => {
  await open();
  expect(document.querySelector("[data-radial]")!.className).toContain("pointer-events-none");
  expect(buttons().every((b) => b.className.includes("pointer-events-none"))).toBe(true);
  expect([hit().style.clipPath, hit().style.width]).toEqual(["circle(50%)", `${2 * HIT_RADIUS}px`]);
});

it("closes, then runs the chosen function on the next frame (« Rename » opens the header's name editor)", async () => {
  await open();
  await act(async () => buttons()[2].click());
  expect(radialStore.getState().ring).toBeNull();
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(pendingUiRequest()).toEqual({ kind: "renameTerminal", id: "batman" });
});

it("leaves the keyboard where it was: a press on its buttons or the wheel never takes it (final review)", async () => {
  await open();
  for (const button of [...buttons(), hub(), hit()]) {
    const press = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    button.dispatchEvent(press);
    expect(press.defaultPrevented, button.getAttribute("aria-label") ?? "hit").toBe(true);
  }
});

it("points at a wedge the keyboard focuses, and at none when it leaves", async () => {
  await open();
  await act(async () => buttons()[3].focus());
  expect(radialStore.getState().ring!.hovered).toBe(3);
  await act(async () => hub().focus());
  expect(radialStore.getState().ring!.hovered).toBeNull();
});

it("closes on its ×, and when the workspace changes or a dialog opens", async () => {
  await open();
  await act(async () => hub().click());
  expect(radialStore.getState().ring).toBeNull();
  await open();
  await act(async () => workspacesStore.setState({ activeId: "w2" } as never));
  expect(radialStore.getState().ring).toBeNull();
  await open();
  await act(async () => uiStore.getState().setClosing({ agents: ["batman"], remove: ["batman"] }));
  expect(radialStore.getState().ring).toBeNull();
  uiStore.getState().setClosing(null);
});

it("opens at once, and moves its wedges with no easing while the keyboard turns it; the pointer brings the easing back", async () => {
  await open();
  const wheel = () => document.querySelector<HTMLElement>("[data-radial]")!;
  // No entrance: opened tens of times a day, and the wedge under a sliding pointer must not move.
  expect(wheel().className).not.toMatch(/dp-radial-in|animate/);
  expect(wheel().hasAttribute("data-keyboard")).toBe(false);
  await act(async () => buttons()[2].focus());
  expect(wheel().hasAttribute("data-keyboard")).toBe(true);
  for (const button of buttons()) expect(button.className).toContain("[[data-keyboard]_&]:transition-none");
  await pointer(hit(), "pointermove", 300 + 100, 300);
  expect(wheel().hasAttribute("data-keyboard")).toBe(false);
});

it("lets go of a press the window lost: no wedge stays sunk", async () => {
  await open();
  // « Rename », at the right: one that runs (Copy, at the top, has nothing to copy).
  await pointer(hit(), "pointermove", 300 + 100, 300);
  await pointer(hit(), "pointerdown", 300 + 100, 300);
  const sunk = () => buttons().filter((b) => b.className.split(/\s+/).includes("scale-[0.97]"));
  expect(sunk()).toHaveLength(1);
  await act(async () => window.dispatchEvent(new Event("blur")));
  expect(sunk()).toHaveLength(0);
});

describe("the More arc", () => {
  /** A point at `radius` from the ring's center (300, 300), in direction `angle` (radians, 0 at the right, clockwise). */
  const toward = (angle: number, radius: number) => ({ x: 300 + radius * Math.cos(angle), y: 300 + radius * Math.sin(angle) });
  /** More, the terminal ring's last wedge: ↖. */
  const MORE = toward((-135 * Math.PI) / 180, 100);
  const items = () => [...document.querySelectorAll<HTMLButtonElement>("[data-radial-item]")];
  const arcOf = () => radialStore.getState().ring!.arc!;
  const arcHit = () => document.querySelector<SVGPathElement>("[data-radial-arc-hit]")!;
  const more = () => document.querySelector<HTMLButtonElement>("[data-radial-more]")!;
  afterEach(() => vi.useRealTimers());

  it("opens once the pointer rests on More, never while it sweeps across it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await open();
    await pointer(hit(), "pointermove", MORE.x, MORE.y);
    expect(radialStore.getState().ring!.hovered).toBe(7);
    await act(async () => vi.advanceTimersByTime(ARC_INTENT_MS - 40));
    // On to « Pause » before the delay is over: nothing opens.
    await pointer(hit(), "pointermove", 300 - 100, 300);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(radialStore.getState().ring!.arc ?? null).toBeNull();
    expect(items()).toHaveLength(0);
    await pointer(hit(), "pointermove", MORE.x, MORE.y);
    await act(async () => vi.advanceTimersByTime(ARC_INTENT_MS));
    expect(radialStore.getState().ring!.arc).not.toBeNull();
    expect(more().getAttribute("aria-expanded")).toBe("true");
  });

  it("opens at once on a click on More, and the ring stays", async () => {
    await open();
    expect(more().getAttribute("aria-expanded")).toBe("false");
    await pointer(hit(), "click", MORE.x, MORE.y);
    expect(radialStore.getState().ring).not.toBeNull();
    expect(items().map((b) => b.getAttribute("aria-label"))).toEqual(["Stop the process", "Duplicate", "Review changes", "Remove from group", "Arrange"]);
    expect(items().map((b) => b.textContent)).toEqual(["Stop", "Duplicate", "Review", "Leave group", "Arrange"]);
    expect(document.querySelector("[data-radial-arc]")!.getAttribute("role")).toBe("group");
    expect(document.querySelector("[data-radial-arc]")!.getAttribute("aria-label")).toBe("More");
  });

  it("draws its wedges as the ring's, outside it, fanned out from More along its curve", async () => {
    await open();
    await pointer(hit(), "click", MORE.x, MORE.y);
    const arc = arcOf();
    // Centred on More: the window has room for it whole.
    expect(arc.count).toBe(5);
    expect(arc.middle).toBeCloseTo((-135 * Math.PI) / 180, 9);
    expect(items().map((b, i) => b.querySelector("path")!.getAttribute("d") === arcWedgePath(arc, i))).toEqual(Array(5).fill(true));
    expect(labelAt(items()[2])).toEqual(arcPosition(arc, 2));
    // The same look: the same classes on the outline as a wedge of the ring.
    expect(items()[0].querySelector("path")!.getAttribute("class")).toBe(buttons()[0].querySelector("path")!.getAttribute("class"));
    expect(ARC_INNER).toBeGreaterThan(OUTER_RADIUS + POP);
  });

  it("points within the arc, keeps it open over the ring's slack, and closes it once the pointer rests on another wedge of the ring", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await open();
    await pointer(hit(), "click", MORE.x, MORE.y);
    const arc = arcOf();
    const second = toward(arcAngle(arc, 1), 188);
    await pointer(arcHit(), "pointermove", second.x, second.y);
    expect([radialStore.getState().ring!.item, radialStore.getState().ring!.hovered]).toEqual([1, 7]);
    expect(hub().textContent).toBe("Duplicate");
    expect(items()[1].style.translate).not.toBe("");
    // Past the rim beside another wedge: the ring's slack, the arc's no longer, and nothing closes.
    const slack = toward(Math.PI * 0.6, 150);
    await pointer(hit(), "pointermove", slack.x, slack.y);
    expect([radialStore.getState().ring!.item, radialStore.getState().ring!.arc, radialStore.getState().ring!.hovered]).toEqual([null, arc, 7]);
    // On « Pause », the ring's: pointed at once, the arc gone once the pointer rests there.
    await pointer(hit(), "pointermove", 300 - 100, 300);
    expect([radialStore.getState().ring!.arc, radialStore.getState().ring!.hovered]).toEqual([arc, 6]);
    await act(async () => vi.advanceTimersByTime(ARC_INTENT_MS));
    expect([radialStore.getState().ring!.arc, radialStore.getState().ring!.hovered]).toEqual([null, 6]);
  });

  it("can be reached across the ring when the window's corner turned it away from More (flip)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () =>
      openRadial({
        kind: "terminal",
        client: { x: 152, y: 152 },
        center: { x: 152, y: 152 },
        context: { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "batman", at: { x: 152, y: 152 } },
        pressed: false,
        sliding: false,
        hovered: null,
      }),
    );
    const from = (angle: number, radius: number) => ({ x: 152 + radius * Math.cos(angle), y: 152 + radius * Math.sin(angle) });
    const more = from((-135 * Math.PI) / 180, 100);
    await pointer(hit(), "click", more.x, more.y);
    const arc = arcOf();
    // Turned round to the side with room, away from More.
    expect(Math.abs(arcAngle(arc, 2) - (-135 * Math.PI) / 180)).toBeGreaterThan(Math.PI / 2);
    // Straight across the ring: over the wedge opposite More, then into the arc's middle wedge.
    const across = from(arcAngle(arc, 2), 100);
    await pointer(hit(), "pointermove", across.x, across.y);
    await act(async () => vi.advanceTimersByTime(ARC_INTENT_MS - 40));
    const target = from(arcAngle(arc, 2), 190);
    await pointer(arcHit(), "pointermove", target.x, target.y);
    await act(async () => vi.advanceTimersByTime(1000));
    expect([radialStore.getState().ring!.arc, radialStore.getState().ring!.item]).toEqual([arc, 2]);
  });

  it("stays open when the pointer leaves the wheel", async () => {
    await open();
    await pointer(hit(), "click", MORE.x, MORE.y);
    await act(async () => {
      document.querySelector("[data-radial]")!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    });
    expect(radialStore.getState().ring!.arc).not.toBeNull();
  });

  it("runs the wedge a click in the arc points at, once the menu has gone; a greyed one does nothing", async () => {
    await open();
    await pointer(hit(), "click", MORE.x, MORE.y);
    const arc = arcOf();
    // « Stop the process »: nothing runs.
    const first = toward(arcAngle(arc, 0), 188);
    await pointer(arcHit(), "click", first.x, first.y);
    expect(radialStore.getState().ring).not.toBeNull();
    const review = toward(arcAngle(arc, 2), 200);
    await pointer(arcHit(), "click", review.x, review.y);
    expect(radialStore.getState().ring).toBeNull();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(reviewStore.getState().nodeId).toBe("batman");
  });

  it("points at an arc wedge the keyboard focuses, and is there at once from the keyboard, a fade alone when motion is reduced", async () => {
    await open();
    await pointer(hit(), "click", MORE.x, MORE.y);
    const group = document.querySelector<HTMLElement>("[data-radial-arc]")!;
    expect(group.className).toContain("motion-reduce:[--tw-enter-scale:1]");
    expect(group.className).toContain("fade-in-0");
    expect(group.hasAttribute("data-instant")).toBe(false);
    await act(async () => items()[3].focus());
    expect([radialStore.getState().ring!.item, radialStore.getState().ring!.keyboard]).toEqual([3, true]);
    // Opened by the pointer, it stays as it opened: no second entrance.
    expect(document.querySelector("[data-radial-arc]")!.hasAttribute("data-instant")).toBe(false);
  });

  it("is there at once when the keyboard opens it, and stays unanimated once the pointer moves", async () => {
    await open();
    await act(async () => {
      updateRadial({ hovered: 7, keyboard: true });
      openArc({ keyboard: true });
    });
    expect(document.querySelector("[data-radial-arc]")!.hasAttribute("data-instant")).toBe(true);
    const second = toward(arcAngle(arcOf(), 1), 188);
    await pointer(arcHit(), "pointermove", second.x, second.y);
    expect(radialStore.getState().ring!.keyboard).toBe(false);
    expect(document.querySelector("[data-radial-arc]")!.hasAttribute("data-instant")).toBe(true);
  });
});

describe("the arcs of Arrange and Other agent", () => {
  /** A point at `radius` from the ring's center (300, 300), in direction `angle` (radians, 0 at the right, clockwise). */
  const toward = (angle: number, radius: number) => ({ x: 300 + radius * Math.cos(angle), y: 300 + radius * Math.sin(angle) });
  const items = () => [...document.querySelectorAll<HTMLButtonElement>("[data-radial-item]")];
  const arcOf = () => radialStore.getState().ring!.arc!;
  const arcHit = () => document.querySelector<SVGPathElement>("[data-radial-arc-hit]")!;
  const group = () => document.querySelector<HTMLElement>("[data-radial-arc]");
  const nextFrame = () => act(async () => void (await new Promise((resolve) => requestAnimationFrame(resolve))));
  /** The canvas ring: Arrange ↙ (5), Other agent ← (6). */
  const ARRANGE = toward(slotDirection(5, 8), 100);
  const OTHER = toward(slotDirection(6, 8), 100);
  const openCanvas = () =>
    act(async () =>
      openRadial({
        kind: "canvas",
        client: { x: 300, y: 300 },
        center: { x: 300, y: 300 },
        context: { project: true, workspaceId: "w1", terminalCount: 1, terminalId: null, at: { x: 40, y: 60 } },
        pressed: false,
        sliding: false,
        hovered: null,
      }),
    );
  const LAYOUTS = ["Grid", "One row", "One column", "2 columns", "3 columns", "4 columns", "Tree"];
  beforeEach(() => {
    vi.mocked(arrangeAs).mockClear();
    vi.mocked(launchAt).mockClear();
    found = [{ id: "claude", available: true }];
    agentsStore.setState({ agents: found, loaded: true } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    arrangeLayoutStore.setState({ layout: "grid" });
  });

  it("opens the canvas ring's Arrange as an arc of the seven layouts, the saved one marked, as More's arc is drawn", async () => {
    arrangeLayoutStore.setState({ layout: "tree" });
    await openCanvas();
    const arrange = buttons()[5];
    expect([arrange.getAttribute("aria-label"), arrange.getAttribute("aria-expanded")]).toEqual(["Arrange", "false"]);
    await pointer(hit(), "click", ARRANGE.x, ARRANGE.y);
    expect(radialStore.getState().ring).toMatchObject({ hovered: 5 });
    expect(arrange.getAttribute("aria-expanded")).toBe("true");
    expect(group()!.getAttribute("aria-label")).toBe("Arrange");
    expect(items().map((b) => b.getAttribute("aria-label"))).toEqual(LAYOUTS);
    expect(items().map((b) => b.textContent)).toEqual(LAYOUTS);
    // Fanned out from Arrange, the window having room; drawn as More's wedges are.
    const arc = arcOf();
    expect([arc.count, arc.step]).toEqual([7, undefined]);
    expect(arc.middle).toBeCloseTo(slotDirection(5, 8), 9);
    expect(items().map((b, i) => b.querySelector("path")!.getAttribute("d") === arcWedgePath(arc, i))).toEqual(Array(7).fill(true));
    expect(items()[0].querySelector("path")!.getAttribute("class")).toBe(buttons()[0].querySelector("path")!.getAttribute("class"));
    // The saved layout: a tick by its icon, as its list has, and the hub and assistive technology say so.
    expect(items().map((b) => b.querySelector("[data-radial-marked]") !== null)).toEqual([false, false, false, false, false, false, true]);
    expect(items()[6].getAttribute("aria-description")).toBe("the saved layout");
    const tree = toward(arcAngle(arc, 6), 188);
    await pointer(arcHit(), "pointermove", tree.x, tree.y);
    expect(hub().textContent).toBe("TreeThe saved layout");
    // Nothing was arranged while it opened.
    expect(arrangeAs).not.toHaveBeenCalled();
  });

  it("arranges in the layout a click picks, once the menu has gone", async () => {
    await openCanvas();
    await pointer(hit(), "click", ARRANGE.x, ARRANGE.y);
    const columns = toward(arcAngle(arcOf(), 4), 188);
    await pointer(arcHit(), "click", columns.x, columns.y);
    expect(radialStore.getState().ring).toBeNull();
    await nextFrame();
    expect(arrangeAs).toHaveBeenCalledTimes(1);
    expect(arrangeAs).toHaveBeenLastCalledWith("w1", { kind: "scene", only: [] }, "columns-3");
  });

  it("opens Arrange's arc once the pointer rests on it, and Other agent's in its place once it rests there", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await openCanvas();
    await pointer(hit(), "pointermove", ARRANGE.x, ARRANGE.y);
    await act(async () => vi.advanceTimersByTime(ARC_INTENT_MS - 40));
    expect(group()).toBeNull();
    await act(async () => vi.advanceTimersByTime(40));
    expect(group()!.getAttribute("aria-label")).toBe("Arrange");
    await pointer(hit(), "pointermove", OTHER.x, OTHER.y);
    await act(async () => vi.advanceTimersByTime(ARC_INTENT_MS));
    expect(group()!.getAttribute("aria-label")).toBe("Other agent…");
    expect(radialStore.getState().ring!.hovered).toBe(6);
  });

  it("opens Other agent as an arc of the agents found, the default one marked, and starts the one picked at the ring's press", async () => {
    found = [
      { id: "claude", available: true },
      { id: "codex", available: true },
      { id: "gemini", available: true },
      { id: "aider", available: false },
      { id: "shell", available: true },
      { id: "custom", available: true },
    ];
    agentsStore.setState({ agents: found, loaded: true } as never);
    await openCanvas();
    await pointer(hit(), "click", OTHER.x, OTHER.y);
    expect(items().map((b) => b.getAttribute("aria-label"))).toEqual(["Claude", "Codex", "Gemini", "Custom"]);
    expect(items().map((b) => b.querySelector("[data-radial-marked]") !== null)).toEqual([true, false, false, false]);
    // The list's word under Gemini, whose deletes nothing guards.
    expect(items()[2].getAttribute("aria-description")).toMatch(/^Not guarded/);
    const codex = toward(arcAngle(arcOf(), 1), 188);
    await pointer(arcHit(), "click", codex.x, codex.y);
    await nextFrame();
    expect(launchAt).toHaveBeenCalledTimes(1);
    expect(launchAt).toHaveBeenLastCalledWith("codex", { x: 40, y: 60 });
  });

  it("waits for the first look at the machine's agents before opening Other agent's arc, never saying none were found meanwhile", async () => {
    agentsStore.setState({ agents: [], loaded: false } as never);
    found = [
      { id: "claude", available: true },
      { id: "codex", available: true },
    ];
    await openCanvas();
    await pointer(hit(), "click", OTHER.x, OTHER.y);
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(items().map((b) => b.getAttribute("aria-label"))).toEqual(["Claude", "Codex"]);
  });

  it("opens Other agent's arc all the same when the first look fails, saying no agent was found, and looks no more", async () => {
    agentsStore.setState({ agents: [], loaded: false } as never);
    found = null;
    looks = 0;
    await openCanvas();
    await pointer(hit(), "click", OTHER.x, OTHER.y);
    for (let i = 0; i < 3; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(items().map((b) => [b.getAttribute("aria-label"), b.getAttribute("aria-disabled")])).toEqual([["No agent found", "true"]]);
    expect(looks).toBe(1);
  });

  describe("a terminal's More, then its Arrange", () => {
    const MORE = toward((-135 * Math.PI) / 180, 100);

    it("opens the layouts in the place of More's arc, fanned out from Arrange; resting on More brings More's arc back", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await open();
      await pointer(hit(), "click", MORE.x, MORE.y);
      const more = arcOf();
      const arrangeAt = toward(arcAngle(more, 4), 188);
      await pointer(arcHit(), "pointermove", arrangeAt.x, arrangeAt.y);
      expect(radialStore.getState().ring!.item).toBe(4);
      await act(async () => vi.advanceTimersByTime(ARC_INTENT_MS));
      const layouts = arcOf();
      expect(layouts.parent).toEqual({ arc: more, item: 4 });
      expect(layouts.middle).toBeCloseTo(arcAngle(more, 4), 9);
      expect(group()!.getAttribute("aria-label")).toBe("Arrange");
      expect(items().map((b) => b.getAttribute("aria-label"))).toEqual(LAYOUTS);
      // More stays the ring's wedge pointed at, its arc taken over.
      expect([radialStore.getState().ring!.hovered, document.querySelector("[data-radial-more]")!.getAttribute("aria-expanded")]).toEqual([7, "true"]);
      await pointer(hit(), "pointermove", MORE.x, MORE.y);
      await act(async () => vi.advanceTimersByTime(ARC_INTENT_MS));
      expect(group()!.getAttribute("aria-label")).toBe("More");
      expect(arcOf().parent ?? null).toBeNull();
      expect(items()).toHaveLength(5);
    });

    it("chooses nothing for a click where the layouts came under the pointer, nor for a second one at once; it moves, then picks", async () => {
      await open();
      await pointer(hit(), "click", MORE.x, MORE.y);
      const arrangeAt = toward(arcAngle(arcOf(), 4), 188);
      await pointer(arcHit(), "click", arrangeAt.x, arrangeAt.y);
      expect(items()).toHaveLength(7);
      // Its middle layout lies under the pointer, unlit: the second click of a double click picks nothing.
      expect(radialStore.getState().ring!.item ?? null).toBeNull();
      await pointer(arcHit(), "click", arrangeAt.x + 2, arrangeAt.y);
      await nextFrame();
      expect([radialStore.getState().ring === null, vi.mocked(arrangeAs).mock.calls.length]).toEqual([false, 0]);
      const row = toward(arcAngle(arcOf(), 1), 188);
      await pointer(arcHit(), "pointermove", row.x, row.y);
      expect(radialStore.getState().ring!.item).toBe(1);
      await pointer(arcHit(), "click", row.x, row.y);
      await nextFrame();
      // Batman stands in no group: the whole canvas.
      expect(arrangeAs).toHaveBeenLastCalledWith("w1", { kind: "scene", only: [] }, "row");
    });
  });
});
