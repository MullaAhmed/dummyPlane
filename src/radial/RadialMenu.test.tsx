// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { pendingUiRequest } from "@/commands/uiRequests";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { HIT_RADIUS, slotPosition, wedgePath } from "./gesture";
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
  expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Duplicate", "Pause", "Stop the process"]);
  expect(buttons().map((b, slot) => b.querySelector("path")!.getAttribute("d") === wedgePath(slot, 8))).toEqual(Array(8).fill(true));
  expect([labelAt(buttons()[0]), labelAt(buttons()[2])]).toEqual([slotPosition(0), slotPosition(2)]);
  expect(document.querySelector<HTMLElement>("[data-radial]")!.style.left).toBe("300px");
});

it("names each wedge under its icon in a word or two; the full name stays the button's", async () => {
  await open();
  expect(buttons().map((b) => b.textContent)).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Duplicate", "Pause", "Stop"]);
  expect(buttons()[7].getAttribute("aria-label")).toBe("Stop the process");
});

it("shows the close button in the hub, then the full name of the wedge pointed at", async () => {
  await open();
  expect(hub().textContent).toBe("");
  expect(hub().querySelector("svg")).not.toBeNull();
  await act(async () => updateRadial({ hovered: 7 }));
  expect(hub().textContent).toBe("Stop the process");
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
