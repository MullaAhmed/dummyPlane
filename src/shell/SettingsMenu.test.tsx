// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { ARRANGE_LAYOUTS } from "@/agents/arrangeLayout";
import { arrangeLayoutStore } from "@/app/arrangeLayoutSetting";
import { SettingsMenu } from "./SettingsMenu";

vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mockIPC(() => undefined);
  arrangeLayoutStore.setState({ layout: "grid" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<SettingsMenu trigger={<button type="button">Settings</button>} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

/** Opens the menu as a click does, then the "Arrange layout" submenu as the arrow key does. */
async function openArrangeLayout() {
  const trigger = host.querySelector("button")!;
  await act(async () => void trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" })));
  const row = document.querySelector("[data-arrange-layout]")!.closest('[data-slot="dropdown-menu-sub-trigger"]')!;
  await act(async () => void row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  return [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-content"] [role="menuitemradio"]')];
}

it("lists every Arrange layout, Grid and Tree among them, the current one ticked", async () => {
  const items = await openArrangeLayout();
  expect(items.map((item) => item.textContent)).toEqual(["Grid", "One row", "One column", "2 columns", "3 columns", "4 columns", "Tree"]);
  expect(items).toHaveLength(ARRANGE_LAYOUTS.length);
  expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false", "false", "false", "false"]);
});

it("takes the layout that is picked", async () => {
  const items = await openArrangeLayout();
  const tree = items.find((item) => item.textContent === "Tree")!;
  await act(async () => void tree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => void tree.click());
  expect(arrangeLayoutStore.getState().layout).toBe("tree");
});
