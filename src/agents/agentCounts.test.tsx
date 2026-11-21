// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { agentsPanelStore } from "@/agents/agentsPanelState";
import { AgentsPanel } from "@/agents/AgentsPanel";
import { useWorkspaceAgentCounts } from "@/agents/agentCounts";
import { waitingAgents } from "@/agents/waitingAgents";
import type { Activity } from "@/ipc/activity";
import type { TerminalPayload } from "@/nodes/types";
import { getByRole } from "@/lib/a11y";
import { ActivityRail } from "@/shell/ActivityRail";
import { WaitingNotice } from "@/shell/WaitingNotice";
import { agentActivityStore } from "@/store/agentActivity";
import { fleetDecisionsStore } from "@/store/fleetDecisions";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore, type TerminalStatus } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { WorkingCount } from "@/shell/WorkingCount";

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

/** Reads the workspace's counts as text, the way the activity rail and the tab badges read them. */
function CountsProbe() {
  const { working, waiting, active } = useWorkspaceAgentCounts();
  return <p>{`working ${working} waiting ${waiting} active ${active}`}</p>;
}

it("counts working, waiting and active over the same agents of the workspace on screen, as the panel's filters and the title bar's Working count do", async () => {
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

  const probe = await render(<CountsProbe />);
  expect(probe.host.textContent).toBe("working 2 waiting 1 active 4");
  await probe.unmount();

  // The panel's filters show the same numbers, and the title bar's Working count is the Working filter's: Ada and the Fleet.
  const panel = await render(<AgentsPanel />);
  const bar = await render(<WorkingCount />);
  const filter = (id: string) => panel.host.querySelector<HTMLElement>(`[data-filter="${id}"]`)!.textContent!.replace(/\D+/g, "");
  expect([filter("working"), filter("waiting")]).toEqual(["2", "1"]);
  expect(bar.host.querySelector("[data-working-count]")!.textContent).toBe(filter("working"));
  // It follows the agents: Cy goes to work, and the bar and the Working filter both say 3.
  await act(async () => agentActivityStore.getState().apply({ nodeId: "cy", activity: "working", since: 2 }));
  expect(filter("working")).toBe("3");
  expect(bar.host.querySelector("[data-working-count]")!.textContent).toBe("3");
  await act(async () => agentActivityStore.getState().apply({ nodeId: "cy", activity: "idle", since: 3 }));
  expect(bar.host.querySelector("[data-working-count]")!.textContent).toBe(filter("working"));
  await bar.unmount();
  // Under All, the busy console's row reads Running, neither Working nor Waiting: it runs no agent.
  expect(agentsPanelStore.getState().filter).toBe("all");
  const pill = [...panel.host.querySelectorAll("[data-status]")].find((dot) => dot.closest(".group")?.textContent?.startsWith("console"));
  expect(pill?.parentElement?.textContent).toBe("Running");
  await panel.unmount();

  // The other tab's question still reaches the user: the waiting notice and its alert cover the whole project.
  const { nodes } = nodesStore.getState();
  const { statuses } = terminalStatusStore.getState();
  const { activities } = agentActivityStore.getState();
  expect(waitingAgents(["w1", "w2"], nodes, statuses, activities).map((a) => a.id)).toEqual(["bob", "eve"]);
});

it("counts a Fleet that waits on the user's decision as waiting everywhere: the counts, the panel's filter and row, the rail's badge, the notice", async () => {
  // Atlas proposed a plan and its turn is over: its terminal rests on its last report, which every count read as Done.
  await nodesStore.getState().create("atlas", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Atlas", session: { ...payload("Atlas"), lastReport: { status: "done", summary: "Planned" } } },
  });
  terminalStatusStore.getState().set("atlas", { state: "running" });
  agentActivityStore.getState().apply({ nodeId: "atlas", activity: "idle", since: 1 });
  canvasStore.getState().setNodeIds(["atlas"]);
  canvasStore.setState({ frames: [] });
  workspacesStore.setState({ activeId: "w1", workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder: null }] });
  fleetDecisionsStore.setState({ decisions: { atlas: { kind: "plan", since: 5, message: "Checkout coupons · 4 sub-tasks" } } });
  try {
    const probe = await render(<CountsProbe />);
    expect(probe.host.textContent).toBe("working 0 waiting 1 active 1");
    // The panel's Waiting filter counts it and lists it, under its Fleets, its row reading Waiting.
    agentsPanelStore.setState({ open: true, filter: "waiting" });
    const panel = await render(<AgentsPanel />);
    expect(panel.host.querySelector<HTMLElement>('[data-filter="waiting"]')!.textContent!.replace(/\D+/g, "")).toBe("1");
    const fleetRow = () => [...panel.host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Atlas"));
    const listed = () => fleetRow() !== undefined;
    expect(fleetRow()?.textContent).toBe("AtlasWaiting");
    const rail = await render(<ActivityRail />);
    expect(getByRole(rail.host, "button", "Agents, 1 waiting").querySelector("[data-pip]")?.textContent).toBe("1");
    const notice = await render(<WaitingNotice />);
    expect([...notice.host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Atlas has a plan for youCheckout coupons · 4 sub-tasks"]);
    // The go-ahead: the Fleet is back to Done, and the wait goes from all of them at once.
    await act(async () => fleetDecisionsStore.setState({ decisions: {} }));
    expect(probe.host.textContent).toBe("working 0 waiting 0 active 0");
    expect(listed()).toBe(false);
    expect(getByRole(rail.host, "button", "Agents").querySelector("[data-pip]")).toBeNull();
    expect(notice.host.querySelector("[data-waiting-notice]")).toBeNull();
    for (const view of [probe, panel, rail, notice]) await view.unmount();
  } finally {
    fleetDecisionsStore.setState({ decisions: {} });
  }
});
