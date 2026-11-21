// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { launchAgent } from "@/agents/launchAgent";
import { agentsStore } from "@/agents/agentsStore";
import { requestUi } from "@/commands/uiRequests";
import { uiStore } from "@/store/ui";
import { ToolRail } from "./ToolRail";

// Excalidraw does not load under Vitest (roughjs); the rail drives it through the store's api only.
vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/kanban/place", () => ({ placeKanban: vi.fn() }));
vi.mock("@/agents/quickActions", () => ({ placeFleet: vi.fn() }));
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
  expect(labels).toEqual(["Select (V)", "Hand (H)", "Shapes", "Text (T)", "Pen (P)", "Eraser (E)", "Image", "Add to canvas", "Fit the view"]);
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

it("holds the catalog, Shell, Fleet, Kanban and Markdown in its ＋", async () => {
  const menuEntries = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[data-slot="popover-content"] button')].map((b) => b.textContent ?? "");
  await act(async () => byLabel("Add to canvas").click());
  const entries = menuEntries();
  // The launch folder comes first (its Change… button), then the agents.
  expect(entries[0]).toBe("Change…");
  expect(entries[1]).toContain("Claude");
  // After the agents: the one terminal row, the Shell, then the Fleet and the board, then the Markdown file.
  expect(entries.slice(-5, -1)).toEqual([
    expect.stringMatching(/^Shell/),
    expect.stringContaining("Fleet"),
    expect.stringContaining("Kanban"),
    expect.stringMatching(/^Markdown/),
  ]);
  expect(entries).not.toContain("New console");
  expect(entries).not.toContain("Launch 4 agents");
  // No shell known yet (none listed): Shell places a terminal in the default one at once.
  await act(async () => document.querySelector<HTMLButtonElement>('[data-agent-pick="shell"]')!.click());
  expect(uiStore.getState().placing).toMatchObject({ agent: "shell", options: { shell: "default" } });
  uiStore.getState().setPlacing(null);
});

it("opens the ＋ menu on request, on the custom command's options or on Ollama's models", async () => {
  await act(async () => requestUi({ kind: "agentMenu", view: "options" }));
  expect(document.querySelector('[data-slot="popover-content"]')!.textContent).toContain("Launch the custom command");
});

it("launches the agent chosen in the ＋ menu where a request pointed (the scene point of the radial menu's press)", async () => {
  await act(async () => requestUi({ kind: "agentMenu", view: "agents", at: { x: 10, y: 20 } }));
  await act(async () => agentsStore.setState({ agents: [{ id: "claude", available: true }] } as never));
  const menu = document.querySelector('[data-slot="popover-content"]')!;
  expect(menu.textContent).toContain("launched where you clicked");
  // The whole menu: the ring's "Other agent…" is its own list (src/agents/OtherAgentMenu.tsx), not this one.
  for (const part of ["Agents", "Terminals", "Fleet", "Kanban"]) expect(menu.textContent, part).toContain(part);
  expect(menu.textContent).not.toContain("Launch an agent");
  const claude = [...menu.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith("Claude"))!;
  await act(async () => claude.click());
  expect(launchAgent).toHaveBeenCalledWith("claude", expect.objectContaining({ shell: expect.any(String) }), { x: 10, y: 20 });
});
