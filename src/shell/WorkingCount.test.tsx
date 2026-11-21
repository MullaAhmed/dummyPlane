// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { agentsPanelStore } from "@/agents/agentsPanelState";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { WorkingCount } from "./WorkingCount";

// Excalidraw does not load under Vitest (roughjs); the count only reaches it through the panel's actions.
vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockIPC(() => undefined);
  nodesStore.setState({ nodes: {} });
  terminalStatusStore.setState({ statuses: {} });
  agentActivityStore.setState({ activities: {} });
  agentsPanelStore.setState({ open: false, filter: "all" });
  canvasStore.getState().setNodeIds([]);
});
afterEach(() => clearMocks());

async function agent(id: string, activity: "working" | "waiting" | "idle", kind: "claude" | "shell" = "claude") {
  await nodesStore.getState().create(id, {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: id, name: id, agent: kind, cwd: "C:/code", shell: "default", command: "" },
  });
  terminalStatusStore.getState().set(id, { state: "running" });
  agentActivityStore.getState().apply({ nodeId: id, activity, since: 1 });
}

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<WorkingCount />));
  return {
    host,
    count: () => host.querySelector<HTMLButtonElement>("[data-working-count]"),
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("shows nothing while no agent works: waiting, resting and plain consoles do not count", async () => {
  await agent("ada", "waiting");
  await agent("bob", "idle");
  await agent("console", "working", "shell");
  canvasStore.getState().setNodeIds(["ada", "bob", "console"]);
  const bar = await mount();
  expect(bar.count()).toBeNull();
  await bar.unmount();
});

it("shows the number of agents working on the canvas, named with that number first", async () => {
  await agent("ada", "working");
  canvasStore.getState().setNodeIds(["ada"]);
  const bar = await mount();
  expect(bar.count()!.textContent).toBe("1");
  expect(bar.count()!.getAttribute("aria-label")).toBe("1 agent working");
  await agent("bob", "working");
  await act(async () => canvasStore.getState().setNodeIds(["ada", "bob"]));
  expect(bar.count()!.textContent).toBe("2");
  expect(bar.count()!.getAttribute("aria-label")).toBe("2 agents working");
  // The word on screen is the number alone: the accessible name starts with it (WCAG 2.5.3).
  expect(bar.count()!.getAttribute("aria-label")!.startsWith(bar.count()!.textContent!)).toBe(true);
  await bar.unmount();
});

it("counts the agents of the canvas on screen only", async () => {
  await agent("ada", "working");
  await agent("bob", "working");
  canvasStore.getState().setNodeIds(["ada"]);
  const bar = await mount();
  expect(bar.count()!.textContent).toBe("1");
  await bar.unmount();
});

it("opens the agents panel on its Working filter", async () => {
  await agent("ada", "working");
  canvasStore.getState().setNodeIds(["ada"]);
  agentsPanelStore.setState({ open: false, filter: "waiting" });
  const bar = await mount();
  await act(async () => bar.count()!.click());
  expect(agentsPanelStore.getState()).toMatchObject({ open: true, filter: "working" });
  await bar.unmount();
});
