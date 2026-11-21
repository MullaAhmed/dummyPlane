// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { requestUi } from "@/commands/uiRequests";
import { projectsStore, type Project } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { arrive } from "@/canvas/arrive";
import { ComposeGroup } from "./ComposeGroup";
import { launchGroup } from "./groups";
import { launchFolderStore } from "./launchFolder";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./groups", () => ({ launchGroup: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@/canvas/arrive", () => ({ arrive: vi.fn(() => true) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mockIPC((cmd) => (cmd.startsWith("list_") ? [] : undefined));
  vi.mocked(launchGroup).mockClear();
  projectsStore.setState({ projects: [], activeId: null });
  workspacesStore.setState({
    projectId: "p1",
    workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder: null }],
    activeId: "w1",
    status: "ready",
  });
  launchFolderStore.setState({ projectId: null, recent: [], loaded: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ComposeGroup answersRequests trigger={<button type="button">+</button>} />));
  await act(async () => requestUi({ kind: "composeGroup" }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  clearMocks();
});

const field = () => document.querySelector<HTMLInputElement>('input[aria-label="Group name"], input[aria-label="Group name"]')!;

it("launches the group on Enter in the name field", async () => {
  await act(async () => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  expect(launchGroup).toHaveBeenCalledWith(expect.objectContaining({ role: "general" }), expect.objectContaining({ cwd: "" }));
});

it("gives the keyboard to the group's first terminal once it is placed, and not back to the trigger", async () => {
  vi.mocked(launchGroup).mockResolvedValueOnce({ frameId: "g", nodeIds: ["batman", "robin"] });
  vi.mocked(arrive).mockClear();
  await act(async () => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(arrive).toHaveBeenCalledExactlyOnceWith("batman", { moveView: false });
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  expect(document.activeElement).not.toBe(host.querySelector("button"));
});

it("places nothing, gives nothing: a launch that made no group leaves the keyboard alone", async () => {
  vi.mocked(arrive).mockClear();
  await act(async () => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(arrive).not.toHaveBeenCalled();
});

it("starts the group's agents in the workspace's folder, shown in its window", async () => {
  projectsStore.setState({ projects: [{ id: "p1", name: "api", path: "D:\\code\\api", lastOpenedAt: 0, missing: false } as Project], activeId: "p1" });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  await act(async () => launchFolderStore.getState().choose("D:\\work\\lib"));
  expect(document.querySelector("[data-launch-folder-name]")!.textContent).toBe("lib");
  // The window shows the folder and its button, not the list of recent ones.
  expect(document.querySelector("[data-recent-folder]")).toBeNull();
  await act(async () => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  expect(launchGroup).toHaveBeenCalledWith(expect.objectContaining({ role: "general" }), expect.objectContaining({ cwd: "D:\\work\\lib" }));
});

it("does not launch on the Enter that ends an IME composition", async () => {
  await act(async () => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true })));
  expect(launchGroup).not.toHaveBeenCalled();
});

it("shows the role's name until the user types one (R5a)", () => {
  expect(field().value).toBe("General");
});

it("shows at once when a request (the palette, a shortcut) opens it, and grows from its trigger when clicked", async () => {
  const content = () => document.body.querySelector('[data-slot="popover-content"]');
  expect(content()?.hasAttribute("data-instant")).toBe(true);
  // Closed, then opened by its trigger: the popover's own entrance plays again.
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => host.querySelector("button")!.click());
  expect(content()).not.toBeNull();
  expect(content()!.hasAttribute("data-instant")).toBe(false);
});
