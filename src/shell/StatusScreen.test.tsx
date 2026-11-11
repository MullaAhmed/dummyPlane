// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { StatusScreen } from "./StatusScreen";
import { troubleshootStore } from "./troubleshoot";

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
  expect(host.querySelector('[aria-label="Close dummyPlane"]')).not.toBeNull();
  expect(host.textContent).toContain("Loading…");
  await act(async () => root.unmount());
  host.remove();
});

it("is no dead end when the start failed: it tries again, opens the logs, offers troubleshooting", async () => {
  const commands: string[] = [];
  mockIPC((cmd) => {
    commands.push(cmd);
    return cmd === "plugin:window|is_maximized" ? false : cmd === "diagnostics" ? null : undefined;
  }, { shouldMockEvents: true });
  const retry = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<StatusScreen failed message="dummyPlane could not start: refused" retry={retry} />));
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("dummyPlane could not start: refused");
  const button = (label: string) => [...alert.querySelectorAll("button")].find((b) => b.textContent === label)!;
  await act(async () => button("Try again").click());
  expect(retry).toHaveBeenCalledTimes(1);
  await act(async () => button("Open the logs folder").click());
  expect(commands).toContain("open_log_dir");
  await act(async () => button("Troubleshooting…").click());
  expect(troubleshootStore.getState().open).toBe(true);
  await act(async () => root.unmount());
  host.remove();
});

it("says it is loading in a status region, with no actions", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<StatusScreen message="Loading…" />));
  expect(host.querySelector('[role="status"]')!.textContent).toBe("Loading…");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => root.unmount());
  host.remove();
});
