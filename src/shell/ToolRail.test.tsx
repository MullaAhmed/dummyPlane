// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { newConsole } from "@/agents/quickActions";
import { launchAgent } from "@/agents/launchAgent";
import { agentsStore } from "@/agents/agentsStore";
import { requestUi } from "@/commands/uiRequests";
import { ToolRail } from "./ToolRail";

// Excalidraw does not load under Vitest (roughjs); the rail drives it through the store's api only.
vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/kanban/place", () => ({ placeKanban: vi.fn() }));
vi.mock("@/agents/quickActions", () => ({ newConsole: vi.fn(), placeFleet: vi.fn() }));
vi.mock("@/agents/launchAgent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/agents/launchAgent")>()),
  launchAgent: vi.fn(() => Promise.resolve()),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const setActiveTool = vi.fn();

beforeEach(async () => {
  mockIPC((cmd) => (cmd.startsWith("list_") ? [] : undefined));
  setActiveTool.mockClear();
  canvasStore.setState({ api: { setActiveTool } as unknown as ExcalidrawImperativeAPI });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ToolRail />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

const byLabel = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

it("offers the canvas tools in their fixed order, each setting its Excalidraw tool", async () => {
  const labels = [...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  expect(labels).toEqual(["Select (V)", "Hand (H)", "Shapes", "Text (T)", "Pen (P)", "Eraser (E)", "Image", "Launch an agent", "Fit the view"]);
  const tools: [string, string][] = [
    ["Select (V)", "selection"],
    ["Hand (H)", "hand"],
    ["Text (T)", "text"],
    ["Eraser (E)", "eraser"],
    ["Image", "image"],
  ];
  for (const [label, type] of tools) {
    await act(async () => byLabel(label).click());
    expect(setActiveTool).toHaveBeenLastCalledWith({ type });
  }
});

it("holds the catalog, New console, Fleet and Kanban in its ＋", async () => {
  const menuEntries = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[data-slot="popover-content"] button')].map((b) => b.textContent ?? "");
  await act(async () => byLabel("Launch an agent").click());
  const entries = menuEntries();
  // The launch folder comes first (its Change… button), then the agents.
  expect(entries[0]).toBe("Change…");
  expect(entries[1]).toContain("Claude");
  expect(entries.slice(-4, -1)).toEqual(["New console", expect.stringContaining("Fleet"), expect.stringContaining("Kanban")]);
  expect(entries).not.toContain("Launch 4 agents");
  const click = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[data-slot="popover-content"] button')].find((b) => b.textContent === text)!.click();
  await act(async () => click("New console"));
  expect(newConsole).toHaveBeenCalledTimes(1);
});

it("opens the ＋ menu on request, on the custom command's options or on Ollama's models", async () => {
  await act(async () => requestUi({ kind: "agentMenu", view: "options" }));
  expect(document.querySelector('[data-slot="popover-content"]')!.textContent).toContain("Launch the custom command");
});

it("launches the agent chosen in the ＋ menu where the radial menu was opened (Other agent…)", async () => {
  await act(async () => requestUi({ kind: "agentMenu", view: "agents", at: { x: 10, y: 20 } }));
  await act(async () => agentsStore.setState({ agents: [{ id: "claude", available: true }] } as never));
  const menu = document.querySelector('[data-slot="popover-content"]')!;
  expect(menu.textContent).toContain("launched where you clicked");
  const claude = [...menu.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith("Claude"))!;
  await act(async () => claude.click());
  expect(launchAgent).toHaveBeenCalledWith("claude", expect.objectContaining({ shell: expect.any(String) }), { x: 10, y: 20 });
});
