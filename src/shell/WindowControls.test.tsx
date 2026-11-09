// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { WindowControls } from "./WindowControls";
import { windowStore } from "./windowState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let calls: string[];
let maximized: boolean;
let host: HTMLDivElement;
let root: Root;

/** Lets the isMaximized() round trip and React's update finish. */
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

beforeEach(async () => {
  calls = [];
  maximized = false;
  mockWindows("main");
  mockIPC(
    (cmd) => {
      if (cmd === "plugin:window|is_maximized") return maximized;
      if (cmd.startsWith("plugin:window|")) calls.push(cmd.slice("plugin:window|".length));
    },
    { shouldMockEvents: true },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<WindowControls />));
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

it("minimizes, maximizes and asks to close the window", async () => {
  await act(async () => button("Minimize")!.click());
  await act(async () => button("Maximize")!.click());
  await act(async () => button("Close dummyPlane")!.click());
  // close, never destroy: the save before closing (onCloseRequested) runs.
  expect(calls).toEqual(["minimize", "toggle_maximize", "close"]);
});

it("closes from a Windows-style corner button that turns red on hover", () => {
  const close = button("Close dummyPlane")!;
  expect(close.className).toContain("w-[46px]");
  expect(close.className).toContain("hover:bg-[#C42B1C]");
});

it("follows the maximized state, however it changed", async () => {
  expect(button("Maximize")).not.toBeNull();
  maximized = true; // double-click on the strip, Win+Up, snapping…
  await act(async () => emit("tauri://resize", { width: 1920, height: 1080 }));
  await settle();
  expect(button("Restore")).not.toBeNull();
  // Published for the palette's "Maximize" / "Restore".
  expect(windowStore.getState().maximized).toBe(true);
  expect(button("Maximize")).toBeNull();
  maximized = false;
  await act(async () => emit("tauri://resize", { width: 1440, height: 900 }));
  await settle();
  expect(button("Maximize")).not.toBeNull();
  expect(windowStore.getState().maximized).toBe(false);
});
