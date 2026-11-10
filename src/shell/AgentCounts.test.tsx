// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { agentCounts } from "@/agents/agentCounts";
import { agentsPanelStore } from "@/agents/agentsPanelState";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { AgentCounts } from "./AgentCounts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => mockIPC(() => undefined));
afterEach(() => clearMocks());

it("counts the running agents at work and waiting, never the stopped ones", () => {
  const statuses = { a: { state: "running" }, b: { state: "running" }, c: { state: "stopped" }, d: { state: "running" } };
  const activities = { a: { activity: "working" }, b: { activity: "waiting" }, c: { activity: "working" }, d: { activity: "idle" } };
  expect(agentCounts(["a", "b", "c", "d"], statuses, activities)).toEqual({ working: 1, waiting: 1 });
});

it("hides a counter at 0 and opens the panel on what it counts", async () => {
  for (const id of ["t1", "t2"]) {
    await nodesStore.getState().create(id, {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: id, name: id, agent: "claude", cwd: "C:/code", shell: "default", command: "" },
    });
    terminalStatusStore.getState().set(id, { state: "running" });
  }
  agentActivityStore.getState().apply({ nodeId: "t1", activity: "waiting", since: 0 });
  agentActivityStore.getState().apply({ nodeId: "t2", activity: "idle", since: 0 });
  canvasStore.getState().setNodeIds(["t1", "t2"]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AgentCounts />));
  expect(host.querySelector('[aria-label="Agents en cours"]')).toBeNull();
  const waiting = host.querySelector<HTMLButtonElement>('[aria-label="Agents waiting for your answer"]')!;
  expect(waiting.textContent).toContain("1");
  await act(async () => waiting.click());
  expect(agentsPanelStore.getState()).toMatchObject({ open: true, filter: "waiting" });
  expect(host.querySelector('[aria-label="Active agents in the project"]')).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
});
