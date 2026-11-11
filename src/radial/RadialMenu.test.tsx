// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { pendingUiRequest } from "@/commands/uiRequests";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { ARC_INNER, arcAngle, arcPosition, arcWedgePath, HIT_RADIUS, OUTER_RADIUS, POP, slotPosition, wedgePath } from "./gesture";
import { ARC_INTENT_MS, openArc } from "./arc";
import { reviewStore } from "@/review/reviewStore";
import { openRadial, radialStore, updateRadial } from "./radialState";
import { RadialMenu } from "./RadialMenu";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/nodes/terminal/registry")>()),
  terminalSelection: vi.fn(() => ""),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  mockIPC(() => undefined);
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

it("draws the wheel around the click, a wedge per command clockwise from the top (spec menu radial §4.2, §5.1)", async () => {
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

it("closes on its ×, and when the workspace changes or a dialog opens (spec menu radial §7)", async () => {
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

  it("points within the arc, keeps it open over the ring's slack, and closes it on another wedge of the ring", async () => {
    await open();
    await pointer(hit(), "click", MORE.x, MORE.y);
    const arc = arcOf();
    const second = toward(arcAngle(arc, 1), 188);
    await pointer(arcHit(), "pointermove", second.x, second.y);
    expect([radialStore.getState().ring!.item, radialStore.getState().ring!.hovered]).toEqual([1, 7]);
    expect(hub().textContent).toBe("Duplicate");
    expect(items()[1].style.translate).not.toBe("");
    // Past the rim beside « Pause »: the ring's slack, the arc's no longer, and nothing closes.
    const slack = toward(Math.PI * 0.6, 150);
    await pointer(hit(), "pointermove", slack.x, slack.y);
    expect([radialStore.getState().ring!.item, radialStore.getState().ring!.arc]).toEqual([null, arc]);
    // On « Pause », the ring's: back to the ring.
    await pointer(hit(), "pointermove", 300 - 100, 300);
    expect([radialStore.getState().ring!.arc, radialStore.getState().ring!.hovered]).toEqual([null, 6]);
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
