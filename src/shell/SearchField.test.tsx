// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { paletteStore } from "@/commands/paletteState";
import { projectsStore } from "@/store/projects";
import { readSource } from "@/theme/cssBlocks";
import { SearchField } from "./SearchField";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", () => ({ focusTerminal: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockIPC(() => undefined);
  paletteStore.setState({ open: false, query: "", context: null, returnFocus: null });
  projectsStore.setState({ view: "project", projects: [{ id: "p1", name: "mk-webapp", path: "C:/code/mk-webapp" }], activeId: "p1" } as never);
});
afterEach(() => {
  clearMocks();
  document.body.replaceChildren();
});

it("names the project and its shortcut, and opens \"Go to\"", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SearchField />));
  const field = host.querySelector("button")!;
  expect(field.textContent).toContain("Search in mk-webapp");
  expect(field.textContent).toContain("Ctrl+P");
  expect(field.className).toContain("w-[440px]");
  // A press does not take the keyboard: it goes back where it was when the palette closes.
  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  field.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);
  await act(async () => field.click());
  expect(paletteStore.getState()).toMatchObject({ open: true, query: "" });
  await act(async () => root.unmount());
});

it("reads \"Search for a project\" at home", async () => {
  projectsStore.setState({ view: "home" } as never);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SearchField />));
  expect(host.querySelector("button")!.textContent).toContain("Search for a project");
  await act(async () => root.unmount());
});

it("sits in the title bar of a project and of the home screen, the palette being mounted once for the whole app", () => {
  expect(readSource("shell/ProjectView.tsx")).toContain("center={<SearchField />}");
  expect(readSource("home/HomeScreen.tsx")).toContain("center={<SearchField />}");
  expect(readSource("App.tsx")).toContain("<Palette />");
});
