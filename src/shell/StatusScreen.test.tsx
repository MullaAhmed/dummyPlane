// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { StatusScreen } from "./StatusScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockWindows("main");
  mockIPC((cmd) => (cmd === "plugin:window|is_maximized" ? false : undefined), { shouldMockEvents: true });
});
afterEach(() => clearMocks());

it("keeps the window movable and closable while loading or failing", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<StatusScreen message="Loading…" />));
  expect(host.querySelector("[data-tauri-drag-region]")).not.toBeNull();
  expect(host.querySelector('[aria-label="Close OpenVibe"]')).not.toBeNull();
  expect(host.textContent).toContain("Loading…");
  await act(async () => root.unmount());
  host.remove();
});
