// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { agentsPanelStore } from "@/agents/agentsPanelState";
import { AgentsPanel } from "@/agents/AgentsPanel";
import { waitingAgents } from "@/agents/waitingAgents";
import type { Activity } from "@/ipc/activity";
import type { TerminalPayload } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { getByRole, queryByRole } from "@/lib/a11y";
import { terminalStatusStore, type TerminalStatus } from "@/store/terminalStatus";
import { AgentCounts } from "./AgentCounts";

// Excalidraw does not load under Vitest (roughjs); the panel only reaches it through menu actions.
vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/agents/quickActions", () => ({ newConsole: vi.fn(), placeFleet: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockIPC((cmd) => (cmd.startsWith("list_") ? [] : undefined));
  nodesStore.setState({ nodes: {} });
  terminalStatusStore.setState({ statuses: {} });
  agentActivityStore.setState({ activities: {} });
  agentsPanelStore.setState({ open: true, filter: "all" });
});
afterEach(() => clearMocks());

const payload = (name: string, agent: TerminalPayload["agent"] = "claude"): TerminalPayload => ({
  title: name,
  name,
  agent,
  cwd: "C:/code",
  shell: "default",
  command: "",
});

async function terminal(id: string, status: TerminalStatus, activity?: Activity, extra: { workspaceId?: string; agent?: TerminalPayload["agent"]; left?: boolean } = {}) {
  await nodesStore.getState().create(id, { workspaceId: extra.workspaceId ?? "w1", kind: "terminal", payload: payload(id, extra.agent) });
  terminalStatusStore.getState().set(id, status);
  if (activity) agentActivityStore.getState().apply({ nodeId: id, activity, since: 1, ...(extra.left ? { left: true } : {}) });
}

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("hides a counter at 0 and opens the panel on what it counts", async () => {
  await terminal("t1", { state: "running" }, "waiting");
  await terminal("t2", { state: "running" }, "idle");
  canvasStore.getState().setNodeIds(["t1", "t2"]);
  const { host, unmount } = await render(<AgentCounts />);
  expect(queryByRole(host, "button", /working/)).toBeNull();
  // Each name starts with the number the counter shows (WCAG 2.5.3 label in name).
  const waiting = getByRole(host, "button", "1 agent waiting for your answer");
  expect(waiting.textContent).toBe("1");
  await act(async () => waiting.click());
  expect(agentsPanelStore.getState()).toMatchObject({ open: true, filter: "waiting" });
  // Both agents run: the one waiting and the one ready are active. "N active" opens the Active filter.
  const active = getByRole(host, "button", "2 active agents in this workspace");
  expect(active.textContent).toBe("2 active");
  await act(async () => active.click());
  expect(agentsPanelStore.getState().filter).toBe("active");
  await unmount();
});

it("counts working, waiting and active over the same agents of the workspace on screen, as the panel's filters do", async () => {
  // At work: Ada and the Fleet. Waiting: Bob. Resting: Cy. Not agents, or not live: a busy shell, an agent that exited
  // (its shell busy), a stopped agent whose activity lingers, one that starts. In another tab: Dee, at work, and Eve, waiting.
  await terminal("ada", { state: "running" }, "working");
  await terminal("bob", { state: "running" }, "waiting");
  await terminal("cy", { state: "running" }, "idle");
  await terminal("console", { state: "running" }, "working", { agent: "shell" });
  await terminal("gone", { state: "running" }, "working", { left: true });
  await terminal("old", { state: "stopped" }, "working");
  await terminal("new", { state: "starting" });
  await terminal("dee", { state: "running" }, "working", { workspaceId: "w2" });
  await terminal("eve", { state: "running" }, "waiting", { workspaceId: "w2" });
  await nodesStore.getState().create("fleet", { workspaceId: "w1", kind: "fleet", payload: { name: "Atlas" } });
  terminalStatusStore.getState().set("fleet", { state: "running" });
  agentActivityStore.getState().apply({ nodeId: "fleet", activity: "working", since: 1 });
  canvasStore.getState().setNodeIds(["ada", "bob", "cy", "console", "gone", "old", "new", "fleet"]);
  canvasStore.setState({ frames: [] });

  const bar = await render(<AgentCounts />);
  expect(getByRole(bar.host, "button", "2 agents working").textContent).toBe("2");
  expect(getByRole(bar.host, "button", "1 agent waiting for your answer").textContent).toBe("1");
  expect(getByRole(bar.host, "button", "4 active agents in this workspace").textContent).toBe("4 active");

  // The panel each counter opens shows the same numbers under its filters.
  const panel = await render(<AgentsPanel />);
  const filter = (id: string) => panel.host.querySelector<HTMLElement>(`[data-filter="${id}"]`)!.textContent!.replace(/\D+/g, "");
  expect([filter("active"), filter("working"), filter("waiting")]).toEqual(["4", "2", "1"]);
  // "4 active" opens on as many rows: Ada, Bob and Cy, and the Fleet in its own section.
  await act(async () => getByRole(bar.host, "button", "4 active agents in this workspace").click());
  expect(agentsPanelStore.getState().filter).toBe("active");
  const rows = [...panel.host.querySelectorAll("[data-row-actions]")].map((actions) => actions.closest(".group")!.textContent!);
  expect(rows.map((text) => text.split(" ")[0])).toEqual(["ada", "bob", "cy"]);
  expect(panel.host.textContent).toContain("Atlas");
  // Under All, the busy console's row reads Running, neither Working nor Active: it runs no agent, and the
  // Active filter and "N active" leave it out.
  await act(async () => agentsPanelStore.setState({ filter: "all" }));
  const pill = [...panel.host.querySelectorAll("[data-status]")].find((dot) => dot.closest(".group")?.textContent?.startsWith("console"));
  expect(pill?.parentElement?.textContent).toBe("Running");
  await bar.unmount();
  await panel.unmount();

  // The other tab's question still reaches the user: the waiting notice and its alert cover the whole project.
  const { nodes } = nodesStore.getState();
  const { statuses } = terminalStatusStore.getState();
  const { activities } = agentActivityStore.getState();
  expect(waitingAgents(["w1", "w2"], nodes, statuses, activities).map((a) => a.id)).toEqual(["bob", "eve"]);
});
