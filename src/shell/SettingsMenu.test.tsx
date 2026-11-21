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

it("marks its open content for the toasts to lift clear of, in a portal right under <body>, and leaves the padding to the menu", async () => {
  const trigger = host.querySelector("button")!;
  await act(async () => void trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" })));
  const content = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]')!;
  expect(content.hasAttribute("data-rail-overlay")).toBe(true);
  // shell/toastLift.ts watches <body>'s children: the portal it opens in is one.
  let portal: HTMLElement = content;
  while (portal.parentElement && portal.parentElement !== document.body) portal = portal.parentElement;
  expect(portal.parentElement).toBe(document.body);
  expect([...content.classList]).toContain("max-h-(--radix-dropdown-menu-content-available-height)");
});

/** Opens the menu as a click does. */
async function openMenu() {
  const trigger = host.querySelector("button")!;
  await act(async () => void trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" })));
}

it("groups its settings by what they change: alerts and the canvas layout are not agent settings", async () => {
  await openMenu();
  const groups = [...document.querySelectorAll('[role="group"][aria-labelledby]')].map((group) => ({
    label: document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent,
    rows: [...group.querySelectorAll('[role^="menuitem"]')].map((row) => row.textContent?.trim()),
  }));
  expect(groups.map((group) => group.label)).toEqual(["Theme", "Scene", "Agents", "Alerts", "Layout", "Updates"]);
  const by = Object.fromEntries(groups.map((group) => [group.label, group.rows]));
  expect(by.Alerts).toEqual(["Windows notifications", "Go to agents that ask", "Alert when an agent finishes"]);
  expect(by.Layout).toEqual(["Auto-arrange", expect.stringContaining("Arrange layout")]);
  for (const moved of [...by.Alerts, "Auto-arrange"]) expect(by.Agents, moved).not.toContain(moved);
  expect(by.Agents).toEqual(expect.arrayContaining(["Sub-agents as terminals", "Stop finished agents", "Model router"]));
});

it("keeps About out of Help: the version and what the app is stand at the head of Troubleshooting", async () => {
  await openMenu();
  const help = [...document.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]')].find((row) => row.textContent?.includes("Help"))!;
  await act(async () => void help.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  const rows = [...document.querySelectorAll('[data-slot="dropdown-menu-sub-content"] [role="menuitem"]')].map((row) => row.textContent?.trim());
  expect(rows).toEqual(["Troubleshooting…", "Open the logs folder"]);
  expect(document.body.textContent).not.toContain("About dummyPlane");
});
