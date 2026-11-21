// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { readClipboardText } from "./bridges";
import { openRadial, radialStore, updateRadial } from "./radialState";
import { RadialMenu } from "./RadialMenu";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/nodes/terminal/registry")>()),
  terminalSelection: vi.fn(() => ""),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

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

it("names the ring's buttons, their wedges, the reason and the close button", async () => {
  await open();
  expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Quick note on this terminal", "Pause", "More"]);
  expect(buttons().map((b) => b.textContent)).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Note", "Pause", "More"]);
  // Its arc: the group's name, its wedges' full names and short ones.
  await act(async () => updateRadial({ arc: { middle: -2.356, count: 5 } }));
  expect(document.querySelector("[data-radial-arc]")!.getAttribute("aria-label")).toBe("More");
  expect([...document.querySelectorAll("[data-radial-item]")].map((b) => b.getAttribute("aria-label"))).toEqual(["Stop the process", "Duplicate", "Review changes", "Remove from group", "Arrange"]);
  expect([...document.querySelectorAll("[data-radial-item]")].map((b) => b.textContent)).toEqual(["Stop", "Duplicate", "Review", "Leave group", "Arrange"]);
  await act(async () => updateRadial({ arc: null }));
  await act(async () => updateRadial({ hovered: 0 }));
  expect(document.querySelector("[data-radial-hub]")!.textContent).toBe("CopyNothing selected");
  expect(document.querySelector('[aria-label="Close the menu"]')).not.toBeNull();
});

it("tells when the clipboard is empty or unreadable", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: async () => [] } });
  expect(await readClipboardText()).toBeNull();
  expect(toast).toHaveBeenCalledWith("The clipboard is empty");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: () => Promise.reject(new Error("denied")) } });
  expect(await readClipboardText()).toBeNull();
  expect(toast.error).toHaveBeenCalledWith("Could not read the clipboard");
});
