// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { PlacementGhost } from "./PlacementGhost";

vi.mock("@excalidraw/excalidraw", () => ({}));
const { launchAgent } = vi.hoisted(() => ({ launchAgent: vi.fn(async () => null) }));
vi.mock("./launchAgent", () => ({ launchAgent }));
const { addFleet } = vi.hoisted(() => ({ addFleet: vi.fn(async () => undefined) }));
vi.mock("@/fleet/fleets", () => ({ addFleet }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = { cwd: "C:/", shell: "default", command: "" };
// A 1000 × 600 canvas at (0, 40) in the window, scrolled by (100, 50), at 100 %: its middle is the scene's (400, 250).
const VIEW = { ...EMPTY_VIEW, width: 1000, height: 600, offsetTop: 40, scrollX: 100, scrollY: 50 };

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  launchAgent.mockClear();
  addFleet.mockClear();
  canvasStore.setState({ view: VIEW, frames: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  uiStore.getState().setPlacing(null);
  await act(async () => root.unmount());
  canvasStore.setState({ view: EMPTY_VIEW, frames: [] });
  document.body.replaceChildren();
});

async function place(placing: Parameters<ReturnType<typeof uiStore.getState>["setPlacing"]>[0]) {
  await act(async () => uiStore.getState().setPlacing(placing));
  await act(async () => root.render(<PlacementGhost />));
}

const press = (target: EventTarget, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

it("lets the wheel through to the canvas while an agent is being placed: the layer covers the canvas, not the gesture", async () => {
  document.body.insertAdjacentHTML("afterbegin", '<div class="excalidraw"><canvas class="interactive"></canvas></div>');
  const seen: WheelEvent[] = [];
  document.querySelector("canvas")!.addEventListener("wheel", (e) => seen.push(e));
  await place({ agent: "shell", options: OPTIONS } as never);
  const layer = host.querySelector<HTMLElement>(".cursor-crosshair")!;
  expect(layer).not.toBeNull();
  await act(async () => {
    layer.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, ctrlKey: true, clientX: 10, clientY: 20, bubbles: true, cancelable: true }));
  });
  expect(seen).toHaveLength(1);
  expect(seen[0].deltaY).toBe(-40);
});

it("ends by the keyboard too: Enter places the agent in the middle of the canvas, where its ghost waits (P2 #4)", async () => {
  // Where the menu gives the focus back when it closes: Enter must not open it again (its default is prevented).
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const heard = vi.fn();
  document.addEventListener("keydown", heard);
  await place({ agent: "claude", options: OPTIONS } as never);
  // Before the pointer moves, the ghost stands in the middle (500, 340), and the hint says Enter, to screen readers too.
  const ghost = host.querySelector<HTMLElement>("[data-ghost]")!;
  expect(parseFloat(ghost.style.left) + parseFloat(ghost.style.width) / 2).toBe(500);
  expect(parseFloat(ghost.style.top) + parseFloat(ghost.style.height) / 2).toBe(340);
  const hint = host.querySelector("[role='status']")!;
  expect(hint.textContent).toBe("Click or press Enter to place the agent · Esc to cancel");
  const enter = press(trigger);
  expect(enter.defaultPrevented).toBe(true);
  // Nothing else hears it: not the focused button, not Excalidraw.
  expect(heard).not.toHaveBeenCalled();
  expect(launchAgent).toHaveBeenCalledWith("claude", OPTIONS, { x: 400, y: 250 });
  expect(uiStore.getState().placing).toBeNull();
  document.removeEventListener("keydown", heard);
  // Done: Enter is the page's again.
  expect(press(trigger).defaultPrevented).toBe(false);
  expect(launchAgent).toHaveBeenCalledTimes(1);
});

it("places with Enter where the ghost is once the pointer has moved over the canvas, and a fleet too", async () => {
  workspacesStore.setState({ activeId: "w1" });
  await place({ fleet: true });
  expect(host.querySelector("[role='status']")!.textContent).toBe("Click or press Enter to place the fleet · Esc to cancel");
  const layer = host.querySelector<HTMLElement>(".cursor-crosshair")!;
  await act(async () => layer.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 140, bubbles: true })));
  press(document.body);
  // (200, 140) in the window: (200 - 0) / 1 - 100, (140 - 40) / 1 - 50.
  expect(addFleet).toHaveBeenCalledWith("w1", { x: 100, y: 50 });
  // The next placement starts from the middle again.
  await place({ agent: "claude", options: OPTIONS } as never);
  press(document.body);
  expect(launchAgent).toHaveBeenLastCalledWith("claude", OPTIONS, { x: 400, y: 250 });
  workspacesStore.setState({ activeId: null });
});

it("leaves alone an Enter held down, composing, with a modifier, or typed into a field or a terminal", async () => {
  await place({ agent: "claude", options: OPTIONS } as never);
  const field = document.createElement("input");
  const xterm = document.createElement("div");
  xterm.className = "xterm";
  const textarea = document.createElement("textarea");
  xterm.append(textarea);
  document.body.append(field, xterm);
  for (const [target, init] of [
    [document.body, { repeat: true }],
    [document.body, { isComposing: true }],
    [document.body, { ctrlKey: true }],
    [document.body, { shiftKey: true }],
    [field, {}],
    [textarea, {}],
  ] as const) {
    expect(press(target, init).defaultPrevented, JSON.stringify(init)).toBe(false);
  }
  expect(launchAgent).not.toHaveBeenCalled();
  expect(uiStore.getState().placing).not.toBeNull();
  // Escape still cancels.
  press(document.body, { key: "Escape" });
  expect(uiStore.getState().placing).toBeNull();
});
