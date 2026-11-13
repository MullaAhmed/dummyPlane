// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { AgentRow } from "./AgentRow";

vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const robin: TerminalPayload = { title: "Release", name: "Robin", agent: "claude", cwd: "C:/code", shell: "default", command: "", spawnedBy: "batman", task: "Run the release" };

beforeEach(() => {
  mockIPC(() => undefined);
  nodesStore.setState({ nodes: {} });
});

afterEach(() => {
  clearMocks();
  document.body.innerHTML = "";
});

async function row(payload: TerminalPayload) {
  await nodesStore.getState().create("robin", { workspaceId: "w1", kind: "terminal", payload });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AgentRow id="robin" />));
  return { host, unmount: () => act(async () => root.unmount()) };
}

it("says Manager on the row of a sub-agent its spawner opened as a manager, as its header does", async () => {
  const view = await row({ ...robin, coordinator: true });
  expect(view.host.querySelector("[data-coordinator]")?.textContent).toBe("Manager");
  expect(view.host.textContent).toContain("Robin");
  await view.unmount();
});

it("shows no badge on the row of a sub-agent that does the work, nor of a mission's Manager", async () => {
  const plain = await row(robin);
  expect(plain.host.querySelector("[data-coordinator]")).toBeNull();
  await plain.unmount();
  nodesStore.setState({ nodes: {} });
  const mission = await row({ ...robin, name: "Manager", title: "Manager · Auth", role: "manager", fleet: "chef", spawnedBy: undefined });
  expect(mission.host.querySelector("[data-coordinator]")).toBeNull();
  await mission.unmount();
});
