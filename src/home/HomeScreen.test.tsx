// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { HomeScreen } from "./HomeScreen";

// Excalidraw does not load under Vitest (roughjs); the search field reaches it through the command registry.
vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockWindows("main");
  mockIPC(
    (cmd) => {
      if (cmd === "list_projects") return [];
      if (cmd === "list_agents" || cmd === "list_shells") return [];
      if (cmd === "plugin:window|is_maximized") return false;
    },
    { shouldMockEvents: true },
  );
});
afterEach(() => clearMocks());

it("puts the title bar on top and scrolls the projects under it, never into it (spec identité §5.9)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<HomeScreen />));
  const bar = host.querySelector("[data-tauri-drag-region]")!;
  expect(bar.querySelector("svg rect")!.getAttribute("fill")).toBe("currentColor");
  expect(bar.textContent).toContain("OpenVibe");
  const header = host.querySelector("header")!;
  expect(header.textContent).toContain("Projects");
  expect(header.textContent).toContain("Add a project");
  let scroller = header.parentElement;
  while (scroller && !scroller.className.includes("overflow-auto")) scroller = scroller.parentElement;
  expect(bar.compareDocumentPosition(scroller!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(scroller!.contains(bar)).toBe(false);
  expect(host.innerHTML).not.toContain("var(--ov-dot)");
  await act(async () => root.unmount());
  host.remove();
});
